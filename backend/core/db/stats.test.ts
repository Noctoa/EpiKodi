import { beforeEach, describe, expect, it } from 'vitest'
import { media, openDatabase, profiles, sources, stats, type Database } from '.'

let db: Database
let a: number
let b: number

const song = (title: string, artist: string, genre: string | null = 'Rock'): stats.PlayInput => ({
  kind: 'audio',
  mediaId: null,
  title,
  artist,
  genre
})

/** Date des lignes, pour les répartitions par mois */
const at = (session: string, iso: string): void => {
  db.prepare('UPDATE play_log SET started_at = unixepoch(?) WHERE session = ?').run(iso, session)
}

beforeEach(() => {
  db = openDatabase(':memory:')
  a = 1
  b = profiles.create(db, 'Invité').id
})

describe('journal de lecture', () => {
  it('additionne les tranches d’une même séance', () => {
    stats.record(db, a, 's1', song('Un', 'X'), 15)
    stats.record(db, a, 's1', song('Un', 'X'), 15)
    stats.record(db, a, 's1', song('Un', 'X'), 4.5)
    const s = stats.forProfile(db, a)
    expect(s.totalSeconds).toBe(34.5)
    expect(s.plays).toBe(1)
  })

  it('une ouverture de quelques secondes compte dans le temps, pas comme lecture', () => {
    stats.record(db, a, 's1', song('Un', 'X'), 5)
    const s = stats.forProfile(db, a)
    expect(s.totalSeconds).toBe(5)
    expect(s.plays).toBe(0)
    expect(s.topMedia).toEqual([])
  })

  it('une séance appartient au profil qui l’a ouverte', () => {
    stats.record(db, a, 's1', song('Un', 'X'), 60)
    stats.record(db, b, 's1', song('Un', 'X'), 999)
    expect(stats.forProfile(db, a).totalSeconds).toBe(60)
    expect(stats.forProfile(db, b).totalSeconds).toBe(0)
  })

  it('garde les chiffres quand le média disparaît', () => {
    const source = sources.create(db, { type: 'local', path: '/m', name: 'M' })
    const m = media.upsert(db, {
      sourceId: source.id,
      path: '/m/a.mp3',
      type: 'audio',
      title: 'A',
      size: 1,
      mtime: 1
    })
    stats.record(db, a, 's1', { ...song('A', 'X'), mediaId: m.id }, 120)
    media.remove(db, m.id)
    expect(stats.forProfile(db, a).topMedia[0]).toMatchObject({ title: 'A', seconds: 120 })
  })
})

describe('statistiques', () => {
  it('répartit par type et par genre, du plus au moins regardé', () => {
    stats.record(db, a, 's1', song('Un', 'X', 'Rock'), 100)
    stats.record(db, a, 's2', song('Deux', 'Y', 'Jazz'), 300)
    stats.record(
      db,
      a,
      's3',
      { kind: 'video', mediaId: null, title: 'Film', artist: null, genre: null },
      1000
    )
    const s = stats.forProfile(db, a)
    expect(s.byKind).toEqual([
      { key: 'video', seconds: 1000 },
      { key: 'audio', seconds: 400 }
    ])
    expect(s.byGenre).toEqual([
      { key: 'Jazz', seconds: 300 },
      { key: 'Rock', seconds: 100 }
    ])
  })

  it('donne douze mois, mois vides compris', () => {
    stats.record(db, a, 's1', song('Un', 'X'), 60)
    stats.record(db, a, 's2', song('Deux', 'X'), 90)
    stats.record(db, a, 's3', song('Vieux', 'X'), 500)
    at('s1', '2026-03-10 12:00:00')
    at('s2', '2026-03-20 12:00:00')
    at('s3', '2024-01-01 12:00:00')
    const s = stats.forProfile(db, a, new Date(2026, 4, 15))
    expect(s.byMonth).toHaveLength(12)
    expect(s.byMonth[0].key).toBe('2025-06')
    expect(s.byMonth.at(-1)).toEqual({ key: '2026-05', seconds: 0 })
    expect(s.byMonth.find((m) => m.key === '2026-03')?.seconds).toBe(150)
    // Hors fenêtre, mais toujours dans le total
    expect(s.totalSeconds).toBe(650)
  })

  it('classe médias et artistes, une même œuvre réunie sur plusieurs séances', () => {
    stats.record(db, a, 's1', song('Hit', 'X'), 200)
    stats.record(db, a, 's2', song('Hit', 'X'), 200)
    stats.record(db, a, 's3', song('Autre', 'Y'), 300)
    const s = stats.forProfile(db, a)
    expect(s.topMedia.map((m) => [m.title, m.plays])).toEqual([
      ['Hit', 2],
      ['Autre', 1]
    ])
    expect(s.topArtists.map((x) => x.artist)).toEqual(['X', 'Y'])
  })

  it('compare tous les profils du foyer, y compris ceux qui n’ont rien lu', () => {
    stats.record(db, b, 's1', song('Un', 'X'), 120)
    expect(stats.forProfile(db, a).household).toEqual([
      { profileId: b, seconds: 120, plays: 1 },
      { profileId: a, seconds: 0, plays: 0 }
    ])
  })

  it('un profil vierge a des statistiques vides mais complètes', () => {
    const s = stats.forProfile(db, a, new Date(2026, 0, 1))
    expect(s).toMatchObject({ totalSeconds: 0, plays: 0, since: null, byKind: [], topMedia: [] })
    expect(s.byMonth.every((m) => m.seconds === 0)).toBe(true)
  })

  it('la remise à zéro n’efface que le profil concerné', () => {
    stats.record(db, a, 's1', song('Un', 'X'), 60)
    stats.record(db, b, 's2', song('Un', 'X'), 60)
    expect(stats.reset(db, a)).toBe(1)
    expect(stats.forProfile(db, a).totalSeconds).toBe(0)
    expect(stats.forProfile(db, b).totalSeconds).toBe(60)
  })
})
