import type { Media, Playlist } from '@shared/models'
import { all, one, run, transaction, type Database } from '../database'
import * as media from './media'

interface Row {
  id: number
  name: string
  created_at: number
}

const toPlaylist = (r: Row): Playlist => ({ id: r.id, name: r.name, createdAt: r.created_at })

export function list(db: Database): Playlist[] {
  return all<Row>(db, 'SELECT * FROM playlists ORDER BY name').map(toPlaylist)
}

export function get(db: Database, id: number): Playlist | null {
  const row = one<Row>(db, 'SELECT * FROM playlists WHERE id = ?', id)
  return row ? toPlaylist(row) : null
}

export function create(db: Database, name: string): Playlist {
  const { lastId } = run(db, 'INSERT INTO playlists (name) VALUES (?)', name)
  return get(db, lastId)!
}

export function rename(db: Database, id: number, name: string): void {
  run(db, 'UPDATE playlists SET name = ? WHERE id = ?', name, id)
}

export function remove(db: Database, id: number): boolean {
  return run(db, 'DELETE FROM playlists WHERE id = ?', id).changes > 0
}

export function items(db: Database, playlistId: number): Media[] {
  const ids = all<{ media_id: number }>(
    db,
    'SELECT media_id FROM playlist_items WHERE playlist_id = ? ORDER BY position',
    playlistId
  )
  return ids.map((r) => media.get(db, r.media_id)!).filter(Boolean)
}

/** Ajoute en fin de playlist ; ignore si déjà présent. */
export function addItem(db: Database, playlistId: number, mediaId: number): void {
  const next = one<{ p: number }>(
    db,
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM playlist_items WHERE playlist_id = ?',
    playlistId
  )!
  run(
    db,
    'INSERT OR IGNORE INTO playlist_items (playlist_id, media_id, position) VALUES (?, ?, ?)',
    playlistId,
    mediaId,
    next.p
  )
}

export function removeItem(db: Database, playlistId: number, mediaId: number): void {
  run(db, 'DELETE FROM playlist_items WHERE playlist_id = ? AND media_id = ?', playlistId, mediaId)
}

/** Réordonne : `mediaIds` est le nouvel ordre complet. */
export function reorder(db: Database, playlistId: number, mediaIds: number[]): void {
  transaction(db, () => {
    mediaIds.forEach((mediaId, i) =>
      run(
        db,
        'UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND media_id = ?',
        i,
        playlistId,
        mediaId
      )
    )
  })
}
