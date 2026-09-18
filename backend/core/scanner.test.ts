import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { media, openDatabase, sources, type Database } from './db'
import { mediaTypeOf, scanSource, titleFromFilename, type ScanProgress } from './scanner'

let db: Database
let dir: string

beforeEach(async () => {
  db = openDatabase(':memory:')
  dir = await mkdtemp(join(tmpdir(), 'epikodi-scan-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const touch = async (rel: string, content = 'x'): Promise<string> => {
  const full = join(dir, rel)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
  return full
}
const source = () => sources.create(db, { type: 'local', path: dir, name: 'test' })

describe('helpers', () => {
  it('reconnaît le type par extension, insensible à la casse', () => {
    expect(mediaTypeOf('a.MP4')).toBe('video')
    expect(mediaTypeOf('b.flac')).toBe('audio')
    expect(mediaTypeOf('c.txt')).toBeNull()
    expect(mediaTypeOf('noext')).toBeNull()
  })

  it('dérive un titre lisible du nom de fichier', () => {
    expect(titleFromFilename('/x/Mon.Film.2019.mkv')).toBe('Mon Film 2019')
    expect(titleFromFilename('/x/01_intro__part.mp3')).toBe('01 intro part')
  })
})

describe('scanSource', () => {
  it('indexe récursivement et ignore les fichiers non média et les dossiers cachés', async () => {
    await touch('a.mp4')
    await touch('sub/deep/b.mkv')
    await touch('sub/c.mp3')
    await touch('sub/readme.txt')
    await touch('.hidden/d.mp4')
    const s = source()
    const p = await scanSource(db, s)
    expect(p.added).toBe(3)
    expect(p.scanned).toBe(3)
    expect(media.count(db)).toBe(3)
    expect(media.list(db, { type: 'audio' }).map((m) => m.title)).toEqual(['c'])
  })

  it('un rescan sans changement ne touche à rien', async () => {
    await touch('a.mp4')
    const s = source()
    await scanSource(db, s)
    const p = await scanSource(db, s)
    expect(p).toMatchObject({ scanned: 1, added: 0, updated: 0, removed: 0 })
    expect(media.count(db)).toBe(1)
  })

  it('détecte modifications et suppressions', async () => {
    const a = await touch('a.mp4')
    await touch('b.mp4')
    const s = source()
    await scanSource(db, s)

    await writeFile(a, 'contenu plus long')
    await utimes(a, new Date(), new Date(Date.now() + 60_000))
    await rm(join(dir, 'b.mp4'))
    await touch('c.mp4')

    const p = await scanSource(db, s)
    expect(p).toMatchObject({ added: 1, updated: 1, removed: 1 })
    expect(media.list(db).map((m) => m.title)).toEqual(['a', 'c'])
    expect(media.getByPath(db, s.id, a)?.size).toBe('contenu plus long'.length)
  })

  it('500 fichiers : aucun doublon après deux scans, progression remontée', async () => {
    await Promise.all(Array.from({ length: 500 }, (_, i) => touch(`d${i % 10}/f${i}.mp4`)))
    const s = source()
    const events: ScanProgress[] = []
    await scanSource(db, s, { onProgress: (p) => events.push(p), batchSize: 100 })
    await scanSource(db, s)
    expect(media.count(db)).toBe(500)
    expect(events.at(-1)?.done).toBe(true)
    expect(events.length).toBeGreaterThan(3)
  })

  it('une annulation ne supprime pas ce qui n’a pas été revu', async () => {
    await touch('a.mp4')
    await touch('b.mp4')
    const s = source()
    await scanSource(db, s)
    const ctrl = new AbortController()
    ctrl.abort()
    const p = await scanSource(db, s, { signal: ctrl.signal })
    expect(p.removed).toBe(0)
    expect(media.count(db)).toBe(2)
  })

  it('un dossier source inexistant donne un scan vide sans erreur', async () => {
    const s = sources.create(db, { type: 'local', path: join(dir, 'nope'), name: 'x' })
    const p = await scanSource(db, s)
    expect(p).toMatchObject({ scanned: 0, done: true })
  })
})
