import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { media, openDatabase, sources, type Database } from './db'
import { Enricher, enrichOne } from './enricher'
import { checkFfmpeg } from './ffmpeg'
import { scanSource } from './scanner'

const status = await checkFfmpeg()
const FIX = join(__dirname, '__fixtures__')

let db: Database
let dir: string
beforeEach(async () => {
  db = openDatabase(':memory:')
  dir = await mkdtemp(join(tmpdir(), 'epikodi-enrich-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe.skipIf(!status.ffmpeg || !status.ffprobe)('enrichissement', () => {
  it('remplit métadonnées, durée, titre et pochette d’un mp3 taggé', async () => {
    await copyFile(join(FIX, 'tagged.mp3'), join(dir, '07_track.mp3'))
    const s = sources.create(db, { type: 'local', path: dir, name: 't' })
    await scanSource(db, s)
    const [m] = media.list(db)
    expect(m.title).toBe('07 track')
    expect(m.probedAt).toBeNull()

    await enrichOne(db, m.id, join(dir, 'thumbs'))

    const after = media.get(db, m.id)!
    expect(after.title).toBe('Around the World')
    expect(after.duration).toBeCloseTo(3, 0)
    expect(after.probedAt).not.toBeNull()
    const meta = media.getMetadata(db, m.id)!
    expect(meta.artist).toBe('Daft Punk')
    expect(meta.thumbnailPath).toBe(join(dir, 'thumbs', `${m.id}.jpg`))
    expect((await stat(meta.thumbnailPath!)).size).toBeGreaterThan(0)
  })

  it('génère une miniature vidéo et garde le titre du fichier', async () => {
    await copyFile(join(FIX, 'tiny.mp4'), join(dir, 'Mon.Film.mp4'))
    const s = sources.create(db, { type: 'local', path: dir, name: 't' })
    await scanSource(db, s)
    const [m] = media.list(db)
    await enrichOne(db, m.id, join(dir, 'thumbs'))
    expect(media.get(db, m.id)!.title).toBe('Mon Film')
    const meta = media.getMetadata(db, m.id)!
    expect(meta).toMatchObject({ videoCodec: 'h264', width: 160, height: 90 })
    expect((await stat(meta.thumbnailPath!)).size).toBeGreaterThan(0)
  })

  it('la file traite tout, marque les fichiers corrompus sans les réessayer', async () => {
    await copyFile(join(FIX, 'tagged.mp3'), join(dir, 'ok.mp3'))
    await writeFile(join(dir, 'broken.mp4'), 'pas une vidéo')
    const s = sources.create(db, { type: 'local', path: dir, name: 't' })
    await scanSource(db, s)

    const done: [number, boolean][] = []
    const idle = new Promise<void>((resolve) => {
      const e = new Enricher(db, {
        thumbnailDir: join(dir, 'thumbs'),
        concurrency: 2,
        onDone: (id, ok) => done.push([id, ok]),
        onIdle: resolve
      })
      e.enqueueUnprobed()
    })
    await idle

    expect(done).toHaveLength(2)
    expect(media.listUnprobed(db)).toEqual([])
    const broken = media.list(db).find((m) => m.path.endsWith('broken.mp4'))!
    expect(broken.probedAt).not.toBeNull()
    expect(media.getMetadata(db, broken.id)).toBeNull()
  })

  it('un fichier modifié est remis en file par le scanner', async () => {
    await copyFile(join(FIX, 'tagged.mp3'), join(dir, 'a.mp3'))
    const s = sources.create(db, { type: 'local', path: dir, name: 't' })
    await scanSource(db, s)
    const [m] = media.list(db)
    await enrichOne(db, m.id, join(dir, 'thumbs'))
    expect(media.listUnprobed(db)).toEqual([])

    await writeFile(join(dir, 'a.mp3'), 'modifié')
    await scanSource(db, s)
    expect(media.listUnprobed(db)).toEqual([m.id])
  })
})
