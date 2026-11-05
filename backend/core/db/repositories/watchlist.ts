import type { WatchlistEntry } from '@shared/models'
import { all, one, run, transaction, type Database } from '../database'

/**
 * Watchlist du foyer : la seule donnée que tous les profils partagent. Chacun voit les mêmes
 * entrées, qui les a ajoutées, et qui a déjà vu quoi.
 */

interface Row {
  media_id: number
  added_by: number | null
  added_at: number
  seen: string | null
}

export function list(db: Database): WatchlistEntry[] {
  return all<Row>(
    db,
    `SELECT w.*,
            (SELECT json_group_array(json_object('profileId', s.profile_id, 'seenAt', s.seen_at))
               FROM shared_watchlist_seen s WHERE s.media_id = w.media_id) AS seen
       FROM shared_watchlist w
      ORDER BY w.added_at DESC, w.media_id DESC`
  ).map((r) => ({
    mediaId: r.media_id,
    addedBy: r.added_by,
    addedAt: r.added_at,
    seenBy: r.seen ? (JSON.parse(r.seen) as WatchlistEntry['seenBy']) : []
  }))
}

export function has(db: Database, mediaId: number): boolean {
  return one(db, 'SELECT 1 FROM shared_watchlist WHERE media_id = ?', mediaId) !== null
}

/**
 * Ajoute un média ; déjà présent, l'entrée garde son auteur d'origine. Les profils qui l'ont
 * déjà terminé sont marqués « vu » d'emblée : la liste dit tout de suite qui peut s'en passer.
 */
export function add(db: Database, profileId: number, mediaId: number): void {
  transaction(db, () => {
    const { changes } = run(
      db,
      'INSERT OR IGNORE INTO shared_watchlist (media_id, added_by) VALUES (?, ?)',
      mediaId,
      profileId
    )
    if (changes === 0) return
    run(
      db,
      `INSERT OR IGNORE INTO shared_watchlist_seen (media_id, profile_id, seen_at)
       SELECT media_id, profile_id, COALESCE(last_played_at, unixepoch())
         FROM playback_state WHERE media_id = ? AND completed = 1`,
      mediaId
    )
  })
}

export function remove(db: Database, mediaId: number): boolean {
  return run(db, 'DELETE FROM shared_watchlist WHERE media_id = ?', mediaId).changes > 0
}

/** Appelé quand un profil termine un média : sans effet s'il n'est pas dans la liste. */
export function markSeen(db: Database, profileId: number, mediaId: number): void {
  run(
    db,
    `INSERT OR IGNORE INTO shared_watchlist_seen (media_id, profile_id)
     SELECT media_id, ? FROM shared_watchlist WHERE media_id = ?`,
    profileId,
    mediaId
  )
}
