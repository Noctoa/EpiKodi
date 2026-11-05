import type { Media, Playlist } from '@shared/models'
import { all, one, run, transaction, type Database } from '../database'
import * as media from './media'

/**
 * Playlists d'un profil. Chaque opération vérifie l'appartenance : un identifiant venu d'un
 * autre profil ne permet ni de lire ni de modifier sa playlist.
 */

interface Row {
  id: number
  name: string
  created_at: number
}

const toPlaylist = (r: Row): Playlist => ({ id: r.id, name: r.name, createdAt: r.created_at })

export function list(db: Database, profileId: number): Playlist[] {
  return all<Row>(db, 'SELECT * FROM playlists WHERE profile_id = ? ORDER BY name', profileId).map(
    toPlaylist
  )
}

export function get(db: Database, profileId: number, id: number): Playlist | null {
  const row = one<Row>(db, 'SELECT * FROM playlists WHERE id = ? AND profile_id = ?', id, profileId)
  return row ? toPlaylist(row) : null
}

export function create(db: Database, profileId: number, name: string): Playlist {
  const { lastId } = run(
    db,
    'INSERT INTO playlists (profile_id, name) VALUES (?, ?)',
    profileId,
    name
  )
  return get(db, profileId, lastId)!
}

export function rename(db: Database, profileId: number, id: number, name: string): void {
  run(db, 'UPDATE playlists SET name = ? WHERE id = ? AND profile_id = ?', name, id, profileId)
}

export function remove(db: Database, profileId: number, id: number): boolean {
  return run(db, 'DELETE FROM playlists WHERE id = ? AND profile_id = ?', id, profileId).changes > 0
}

export function items(db: Database, profileId: number, playlistId: number): Media[] {
  const ids = all<{ media_id: number }>(
    db,
    `SELECT pi.media_id FROM playlist_items pi
       JOIN playlists p ON p.id = pi.playlist_id
      WHERE pi.playlist_id = ? AND p.profile_id = ?
      ORDER BY pi.position`,
    playlistId,
    profileId
  )
  return ids.map((r) => media.get(db, r.media_id)!).filter(Boolean)
}

/** Ajoute en fin de playlist ; ignore si déjà présent, ou si la playlist n'est pas au profil. */
export function addItem(
  db: Database,
  profileId: number,
  playlistId: number,
  mediaId: number
): void {
  if (!get(db, profileId, playlistId)) return
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

export function removeItem(
  db: Database,
  profileId: number,
  playlistId: number,
  mediaId: number
): void {
  if (!get(db, profileId, playlistId)) return
  run(db, 'DELETE FROM playlist_items WHERE playlist_id = ? AND media_id = ?', playlistId, mediaId)
}

/** Réordonne : `mediaIds` est le nouvel ordre complet. */
export function reorder(
  db: Database,
  profileId: number,
  playlistId: number,
  mediaIds: number[]
): void {
  if (!get(db, profileId, playlistId)) return
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
