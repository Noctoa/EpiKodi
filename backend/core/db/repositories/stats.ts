import type { PlayKind, ProfileStats, StatBucket } from '@shared/models'
import { all, one, run, type Database } from '../database'

/**
 * Journal de lecture et statistiques d'un profil. Le lecteur mesure le temps réellement passé à
 * lire et l'envoie par tranches, rattachées à une séance ; tout se calcule ensuite ici.
 */

/** En deçà, une séance compte dans le temps total mais pas comme une lecture. */
export const MIN_PLAY_SECONDS = 30

export interface PlayInput {
  kind: PlayKind
  mediaId: number | null
  title: string
  artist: string | null
  genre: string | null
}

/**
 * Ajoute `seconds` à la séance, créée au premier appel. Une séance appartient au profil qui l'a
 * ouverte : un identifiant réutilisé depuis un autre profil n'y ajoute rien.
 */
export function record(
  db: Database,
  profileId: number,
  session: string,
  play: PlayInput,
  seconds: number
): void {
  run(
    db,
    `INSERT INTO play_log (session, profile_id, kind, media_id, title, artist, genre, seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session) DO UPDATE SET
       seconds = play_log.seconds + excluded.seconds,
       updated_at = unixepoch()
     WHERE play_log.profile_id = excluded.profile_id`,
    session,
    profileId,
    play.kind,
    play.mediaId,
    play.title,
    play.artist,
    play.genre,
    seconds
  )
}

export function reset(db: Database, profileId: number): number {
  return run(db, 'DELETE FROM play_log WHERE profile_id = ?', profileId).changes
}

/** Les douze mois qui finissent par celui de `now`, au format `AAAA-MM` (heure locale). */
export function lastMonths(now: Date, count = 12): string[] {
  const months: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

export function forProfile(db: Database, profileId: number, now = new Date()): ProfileStats {
  const totals = one<{ seconds: number | null; plays: number; since: number | null }>(
    db,
    `SELECT SUM(seconds) AS seconds, COUNT(*) FILTER (WHERE seconds >= ?) AS plays,
            MIN(started_at) AS since
       FROM play_log WHERE profile_id = ?`,
    MIN_PLAY_SECONDS,
    profileId
  )!

  const buckets = (column: string, extra = '', limit = 1000): StatBucket[] =>
    all<{ key: string; seconds: number }>(
      db,
      `SELECT ${column} AS key, SUM(seconds) AS seconds FROM play_log
        WHERE profile_id = ? ${extra}
        GROUP BY key HAVING seconds > 0 ORDER BY seconds DESC LIMIT ?`,
      profileId,
      limit
    )

  // Les mois sans lecture comptent aussi : un graphique troué mentirait sur le rythme
  const perMonth = new Map(
    buckets("strftime('%Y-%m', started_at, 'unixepoch', 'localtime')").map((b) => [
      b.key,
      b.seconds
    ])
  )

  return {
    profileId,
    totalSeconds: totals.seconds ?? 0,
    plays: totals.plays,
    since: totals.since,
    byKind: buckets('kind'),
    byGenre: buckets('genre', 'AND genre IS NOT NULL', 8),
    byMonth: lastMonths(now).map((key) => ({ key, seconds: perMonth.get(key) ?? 0 })),
    topMedia: all<{
      title: string
      artist: string | null
      kind: PlayKind
      seconds: number
      plays: number
    }>(
      db,
      `SELECT title, artist, kind, SUM(seconds) AS seconds,
              COUNT(*) FILTER (WHERE seconds >= ?) AS plays
         FROM play_log WHERE profile_id = ?
        GROUP BY kind, COALESCE(media_id, title), artist
        HAVING plays > 0 ORDER BY seconds DESC LIMIT 10`,
      MIN_PLAY_SECONDS,
      profileId
    ),
    topArtists: all<{ artist: string; seconds: number; plays: number }>(
      db,
      `SELECT artist, SUM(seconds) AS seconds, COUNT(*) FILTER (WHERE seconds >= ?) AS plays
         FROM play_log
        WHERE profile_id = ? AND kind = 'audio' AND artist IS NOT NULL
        GROUP BY artist COLLATE NOCASE
        HAVING plays > 0 ORDER BY seconds DESC LIMIT 10`,
      MIN_PLAY_SECONDS,
      profileId
    ),
    household: all<{ profileId: number; seconds: number; plays: number }>(
      db,
      `SELECT p.id AS profileId, COALESCE(SUM(l.seconds), 0) AS seconds,
              COUNT(l.id) FILTER (WHERE l.seconds >= ?) AS plays
         FROM profiles p LEFT JOIN play_log l ON l.profile_id = p.id
        GROUP BY p.id ORDER BY seconds DESC, p.id`,
      MIN_PLAY_SECONDS
    )
  }
}
