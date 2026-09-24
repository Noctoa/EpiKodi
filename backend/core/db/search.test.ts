import { beforeEach, describe, expect, it } from 'vitest'
import { media, openDatabase, playback, sources, type Database } from '.'
import { toFtsQuery } from './repositories/media'
import type { MediaType } from '@shared/models'

let db: Database
let sourceId: number
let otherSourceId: number

beforeEach(() => {
  db = openDatabase(':memory:')
  sourceId = sources.create(db, { type: 'local', path: '/a', name: 'A' }).id
  otherSourceId = sources.create(db, { type: 'local', path: '/b', name: 'B' }).id
})

let seq = 0
function add(
  title: string,
  opts: {
    type?: MediaType
    artist?: string
    album?: string
    genre?: string
    year?: number
    duration?: number
    source?: number
    path?: string
    addedAt?: number
  } = {}
): number {
  const m = media.upsert(db, {
    sourceId: opts.source ?? sourceId,
    path: opts.path ?? `/a/${title}-${++seq}.mp4`,
    type: opts.type ?? 'video',
    title,
    size: 1,
    mtime: 1,
    duration: opts.duration ?? null
  })
  if (opts.artist || opts.album || opts.genre || opts.year) {
    media.setMetadata(db, m.id, {
      artist: opts.artist ?? null,
      album: opts.album ?? null,
      genre: opts.genre ?? null,
      year: opts.year ?? null
    })
  }
  if (opts.addedAt) db.prepare('UPDATE media SET added_at = ? WHERE id = ?').run(opts.addedAt, m.id)
  return m.id
}

const titles = (opts: Parameters<typeof media.list>[1]): string[] =>
  media.list(db, opts).map((m) => m.title)

describe('toFtsQuery', () => {
  it('met chaque mot en phrase et autorise le préfixe sur le dernier', () => {
    expect(toFtsQuery('daft punk')).toBe('"daft" AND "punk"*')
    expect(toFtsQuery('  inception  ')).toBe('"inception"*')
  })

  it('neutralise les opérateurs FTS et la ponctuation', () => {
    expect(toFtsQuery('a OR b')).toBe('"a" AND "OR" AND "b"*')
    expect(toFtsQuery('foo" NEAR/2 *')).toBe('"foo" AND "NEAR" AND "2"*')
    expect(toFtsQuery('***')).toBeNull()
    expect(toFtsQuery('   ')).toBeNull()
  })
})

describe('recherche', () => {
  beforeEach(() => {
    add('Inception', { year: 2010, genre: 'Science-fiction' })
    add('One More Time', {
      type: 'audio',
      artist: 'Daft Punk',
      album: 'Discovery',
      year: 2001,
      genre: 'House'
    })
    add('Da Funk', {
      type: 'audio',
      artist: 'Daft Punk',
      album: 'Homework',
      year: 1997,
      genre: 'House'
    })
    add('Vacances', { path: '/a/Été 2019/clip.mp4' })
  })

  it('trouve par titre, artiste, album et nom de fichier', () => {
    expect(titles({ search: 'inception' })).toEqual(['Inception'])
    expect(titles({ search: 'daft' }).sort()).toEqual(['Da Funk', 'One More Time'])
    expect(titles({ search: 'homework' })).toEqual(['Da Funk'])
    expect(titles({ search: 'clip' })).toEqual(['Vacances'])
  })

  it('ignore les accents et la casse', () => {
    expect(titles({ search: 'ETE' })).toEqual(['Vacances'])
    expect(titles({ search: 'été' })).toEqual(['Vacances'])
  })

  it('cherche au fil de la frappe (préfixe sur le dernier mot)', () => {
    expect(titles({ search: 'incep' })).toEqual(['Inception'])
    expect(titles({ search: 'daft pu' }).sort()).toEqual(['Da Funk', 'One More Time'])
  })

  it('ne renvoie rien pour une saisie sans mot', () => {
    expect(titles({ search: '###' })).toEqual([])
  })

  it('suit les renommages, les suppressions et les métadonnées', () => {
    // chemin neutre : sinon « provisoire » resterait trouvable via le nom de fichier
    const id = add('Provisoire', { type: 'audio', path: '/a/track09.mp3' })
    media.markProbed(db, id, { title: 'Titre Final' })
    expect(titles({ search: 'final' })).toEqual(['Titre Final'])
    expect(titles({ search: 'provisoire' })).toEqual([])

    media.setMetadata(db, id, { artist: 'Justice' })
    expect(titles({ search: 'justice' })).toEqual(['Titre Final'])

    media.remove(db, id)
    expect(titles({ search: 'final' })).toEqual([])
  })
})

describe('filtres', () => {
  beforeEach(() => {
    add('Film A', { genre: 'Action', year: 2019 })
    add('Film B', { genre: 'Action', year: 2021 })
    add('Film C', { genre: 'Comédie', year: 2019 })
    add('Chanson', { type: 'audio', genre: 'House', year: 2001, source: otherSourceId })
  })

  it('filtre par type, genre, année et source', () => {
    expect(titles({ type: 'audio' })).toEqual(['Chanson'])
    expect(titles({ genre: 'Action' })).toEqual(['Film A', 'Film B'])
    expect(titles({ year: 2019 })).toEqual(['Film A', 'Film C'])
    expect(titles({ sourceId: otherSourceId })).toEqual(['Chanson'])
  })

  it('combine filtres et recherche', () => {
    expect(titles({ search: 'film', genre: 'Action', year: 2021 })).toEqual(['Film B'])
    expect(titles({ search: 'film', type: 'audio' })).toEqual([])
  })

  it('« non vus » exclut les médias terminés', () => {
    const watched = media.list(db).find((m) => m.title === 'Film A')!
    playback.savePosition(db, watched.id, 500, true)
    expect(titles({ unwatched: true })).toEqual(['Chanson', 'Film B', 'Film C'])
    expect(media.count(db, { unwatched: true })).toBe(3)
  })
})

describe('tri', () => {
  beforeEach(() => {
    add('Charlie', { duration: 300, year: 2001, addedAt: 300 })
    add('alpha', { duration: 100, year: 2020, addedAt: 100 })
    add('Bravo', { addedAt: 200 })
  })

  it('par titre (insensible à la casse), par ajout, durée et année', () => {
    expect(titles({ sort: 'title' })).toEqual(['alpha', 'Bravo', 'Charlie'])
    expect(titles({ sort: 'title', order: 'desc' })).toEqual(['Charlie', 'Bravo', 'alpha'])
    expect(titles({ sort: 'addedAt' })).toEqual(['Charlie', 'Bravo', 'alpha'])
    expect(titles({ sort: 'duration' })).toEqual(['alpha', 'Charlie', 'Bravo'])
    expect(titles({ sort: 'year' })).toEqual(['alpha', 'Charlie', 'Bravo'])
  })

  it('les valeurs inconnues restent en fin de liste dans les deux sens', () => {
    expect(titles({ sort: 'duration', order: 'desc' }).at(-1)).toBe('Bravo')
    expect(titles({ sort: 'year', order: 'asc' }).at(-1)).toBe('Bravo')
  })
})

describe('facettes', () => {
  it('liste les genres et années disponibles', () => {
    add('X', { genre: 'Action', year: 2019 })
    add('Y', { genre: 'Comédie', year: 2021 })
    add('Z', { genre: 'Action', year: 2019 })
    expect(media.facets(db)).toEqual({ genres: ['Action', 'Comédie'], years: [2021, 2019] })
  })
})

describe('performance', () => {
  it('cherche dans 5000 médias en moins de 100 ms', () => {
    const insert = db.prepare(
      'INSERT INTO media (source_id, path, type, title, size, mtime) VALUES (?, ?, ?, ?, 1, 1)'
    )
    db.exec('BEGIN')
    for (let i = 0; i < 5000; i++) {
      insert.run(sourceId, `/a/f${i}.mp4`, i % 2 ? 'video' : 'audio', `Titre numéro ${i}`)
    }
    db.exec('COMMIT')
    expect(media.count(db)).toBe(5000)

    const t0 = performance.now()
    const found = media.listWithMetadata(db, { search: 'numero 4242' })
    const elapsed = performance.now() - t0
    expect(found.map((m) => m.title)).toEqual(['Titre numéro 4242'])
    expect(elapsed).toBeLessThan(100)

    const t1 = performance.now()
    media.listWithMetadata(db, { search: 'titre', type: 'video', sort: 'addedAt', limit: 100 })
    expect(performance.now() - t1).toBeLessThan(100)
  })
})
