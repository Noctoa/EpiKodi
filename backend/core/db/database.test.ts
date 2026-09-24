import { beforeEach, describe, expect, it } from 'vitest'
import { currentVersion, media, openDatabase, playback, playlists, sources, type Database } from '.'
import { migrations } from './migrations'

let db: Database
beforeEach(() => {
  db = openDatabase(':memory:')
})

const addSource = (path = '/videos') => sources.create(db, { type: 'local', path, name: 'Vidéos' })
const addMedia = (sourceId: number, path: string, title = 'Film') =>
  media.upsert(db, { sourceId, path, type: 'video', title, size: 100, mtime: 1 })

describe('migrations', () => {
  it('amène une base vide à la dernière version', () => {
    expect(currentVersion(db)).toBe(migrations.at(-1)!.version)
  })

  it('crée toutes les tables', () => {
    // On ignore les tables internes de FTS5 (media_fts_data, _idx, _docsize…)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name as string)
      .filter((n) => !n.startsWith('media_fts_'))
    expect(tables).toEqual([
      'media',
      'media_fts',
      'media_metadata',
      'playback_state',
      'playlist_items',
      'playlists',
      'sources'
    ])
  })

  it('active les clés étrangères', () => {
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })
})

describe('sources', () => {
  it('crée, liste et supprime', () => {
    const s = addSource()
    expect(s.id).toBeGreaterThan(0)
    expect(s.lastScanAt).toBeNull()
    expect(sources.list(db)).toHaveLength(1)
    expect(sources.remove(db, s.id)).toBe(true)
    expect(sources.list(db)).toHaveLength(0)
  })

  it('refuse deux fois le même chemin', () => {
    addSource('/x')
    expect(() => addSource('/x')).toThrow(/UNIQUE/)
  })

  it('supprimer une source supprime ses médias (cascade)', () => {
    const s = addSource()
    addMedia(s.id, '/videos/a.mp4')
    addMedia(s.id, '/videos/b.mp4')
    sources.remove(db, s.id)
    expect(media.count(db)).toBe(0)
  })
})

describe('media', () => {
  it('upsert ne crée pas de doublon pour (source, chemin)', () => {
    const s = addSource()
    const first = addMedia(s.id, '/videos/a.mp4', 'v1')
    const second = media.upsert(db, {
      sourceId: s.id,
      path: '/videos/a.mp4',
      type: 'video',
      title: 'v2',
      size: 200,
      mtime: 2
    })
    expect(second.id).toBe(first.id)
    expect(second.title).toBe('v2')
    expect(second.size).toBe(200)
    expect(media.count(db)).toBe(1)
  })

  it('upsert conserve la durée si le nouveau scan ne la fournit pas', () => {
    const s = addSource()
    media.upsert(db, {
      sourceId: s.id,
      path: '/a',
      type: 'video',
      title: 'a',
      size: 1,
      mtime: 1,
      duration: 42
    })
    const m = media.upsert(db, {
      sourceId: s.id,
      path: '/a',
      type: 'video',
      title: 'a',
      size: 1,
      mtime: 1
    })
    expect(m.duration).toBe(42)
  })

  it('liste avec filtre de type et recherche insensible à la casse', () => {
    const s = addSource()
    addMedia(s.id, '/a', 'Inception')
    media.upsert(db, {
      sourceId: s.id,
      path: '/b',
      type: 'audio',
      title: 'Daft Punk',
      size: 1,
      mtime: 1
    })
    expect(media.list(db, { type: 'audio' }).map((m) => m.title)).toEqual(['Daft Punk'])
    expect(media.list(db, { search: 'incep' }).map((m) => m.title)).toEqual(['Inception'])
  })

  it('removeMissing supprime les fichiers disparus du disque', () => {
    const s = addSource()
    addMedia(s.id, '/a')
    addMedia(s.id, '/b')
    addMedia(s.id, '/c')
    expect(media.removeMissing(db, s.id, ['/a', '/c'])).toBe(1)
    expect(media.list(db).map((m) => m.path)).toEqual(['/a', '/c'])
  })

  it('setMetadata fusionne sans écraser les champs non fournis', () => {
    const s = addSource()
    const m = addMedia(s.id, '/a')
    media.setMetadata(db, m.id, { videoCodec: 'h264', width: 1920, height: 1080 })
    const meta = media.setMetadata(db, m.id, { overview: 'Un film', rating: 8.5 })
    expect(meta.videoCodec).toBe('h264')
    expect(meta.width).toBe(1920)
    expect(meta.overview).toBe('Un film')
    expect(meta.artist).toBeNull()
  })
})

describe('playlists', () => {
  it('ajoute en ordre, ignore les doublons, réordonne', () => {
    const s = addSource()
    const a = addMedia(s.id, '/a')
    const b = addMedia(s.id, '/b')
    const p = playlists.create(db, 'Soirée')
    playlists.addItem(db, p.id, a.id)
    playlists.addItem(db, p.id, b.id)
    playlists.addItem(db, p.id, a.id)
    expect(playlists.items(db, p.id).map((m) => m.id)).toEqual([a.id, b.id])
    playlists.reorder(db, p.id, [b.id, a.id])
    expect(playlists.items(db, p.id).map((m) => m.id)).toEqual([b.id, a.id])
  })

  it('supprimer un média le retire des playlists', () => {
    const s = addSource()
    const a = addMedia(s.id, '/a')
    const p = playlists.create(db, 'P')
    playlists.addItem(db, p.id, a.id)
    media.remove(db, a.id)
    expect(playlists.items(db, p.id)).toEqual([])
  })
})

describe('playback', () => {
  it('sauvegarde la position et remonte les lectures en cours', () => {
    const s = addSource()
    const a = addMedia(s.id, '/a')
    const b = addMedia(s.id, '/b')
    expect(playback.get(db, a.id)).toBeNull()
    playback.savePosition(db, a.id, 120)
    playback.savePosition(db, b.id, 3000, true)
    expect(playback.get(db, a.id)?.position).toBe(120)
    expect(playback.inProgress(db).map((p) => p.mediaId)).toEqual([a.id])
  })

  it('compte les lectures et gère les favoris', () => {
    const s = addSource()
    const a = addMedia(s.id, '/a')
    playback.incrementPlayCount(db, a.id)
    playback.incrementPlayCount(db, a.id)
    playback.setFavorite(db, a.id, true)
    const st = playback.get(db, a.id)!
    expect(st.playCount).toBe(2)
    expect(st.favorite).toBe(true)
    expect(playback.favorites(db)).toHaveLength(1)
  })
})
