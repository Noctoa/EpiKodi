import type { PlaybackState } from '@shared/models'
import { all, one, run, type Database } from '../database'

/** Reprise de lecture et favoris : toujours ceux d'un profil, jamais ceux du voisin. */

interface Row {
  media_id: number
  position: number
  completed: number
  favorite: number
  play_count: number
  last_played_at: number | null
}

const toState = (r: Row): PlaybackState => ({
  mediaId: r.media_id,
  position: r.position,
  completed: r.completed === 1,
  favorite: r.favorite === 1,
  playCount: r.play_count,
  lastPlayedAt: r.last_played_at
})

export function get(db: Database, profileId: number, mediaId: number): PlaybackState | null {
  const row = one<Row>(
    db,
    'SELECT * FROM playback_state WHERE profile_id = ? AND media_id = ?',
    profileId,
    mediaId
  )
  return row ? toState(row) : null
}

/** Sauvegarde la position de lecture (appelé régulièrement pendant la lecture). */
export function savePosition(
  db: Database,
  profileId: number,
  mediaId: number,
  position: number,
  completed = false
): void {
  run(
    db,
    `INSERT INTO playback_state (profile_id, media_id, position, completed, last_played_at)
     VALUES (?, ?, ?, ?, unixepoch())
     ON CONFLICT (profile_id, media_id) DO UPDATE SET
       position = excluded.position,
       completed = excluded.completed,
       last_played_at = excluded.last_played_at`,
    profileId,
    mediaId,
    position,
    completed ? 1 : 0
  )
}

export function incrementPlayCount(db: Database, profileId: number, mediaId: number): void {
  run(
    db,
    `INSERT INTO playback_state (profile_id, media_id, play_count, last_played_at)
     VALUES (?, ?, 1, unixepoch())
     ON CONFLICT (profile_id, media_id) DO UPDATE SET
       play_count = play_count + 1, last_played_at = unixepoch()`,
    profileId,
    mediaId
  )
}

export function setFavorite(
  db: Database,
  profileId: number,
  mediaId: number,
  favorite: boolean
): void {
  run(
    db,
    `INSERT INTO playback_state (profile_id, media_id, favorite) VALUES (?, ?, ?)
     ON CONFLICT (profile_id, media_id) DO UPDATE SET favorite = excluded.favorite`,
    profileId,
    mediaId,
    favorite ? 1 : 0
  )
}

/** Médias commencés mais pas finis, du plus récent au plus ancien ("Continuer à regarder"). */
export function inProgress(db: Database, profileId: number, limit = 20): PlaybackState[] {
  return all<Row>(
    db,
    `SELECT * FROM playback_state
      WHERE profile_id = ? AND position > 0 AND completed = 0
      ORDER BY last_played_at DESC LIMIT ?`,
    profileId,
    limit
  ).map(toState)
}

export function favorites(db: Database, profileId: number): PlaybackState[] {
  return all<Row>(
    db,
    'SELECT * FROM playback_state WHERE profile_id = ? AND favorite = 1',
    profileId
  ).map(toState)
}
