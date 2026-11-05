import type { Podcast, PodcastEpisode } from '@shared/models'
import { all, one, run, transaction, type Database } from '../database'

interface PodcastRow {
  id: number
  feed_url: string
  title: string
  description: string | null
  author: string | null
  website: string | null
  image_path: string | null
  image_url: string | null
  added_at: number
  last_fetch_at: number | null
  last_error: string | null
}

interface EpisodeRow {
  id: number
  podcast_id: number
  guid: string
  title: string
  description: string | null
  audio_url: string
  mime: string | null
  size: number | null
  duration: number | null
  published_at: number | null
  image_path: string | null
  local_path: string | null
  position: number
  completed: number
}

const toPodcast = (r: PodcastRow): Podcast => ({
  id: r.id,
  feedUrl: r.feed_url,
  title: r.title,
  description: r.description,
  author: r.author,
  website: r.website,
  imagePath: r.image_path,
  imageUrl: r.image_url,
  addedAt: r.added_at,
  lastFetchAt: r.last_fetch_at,
  lastError: r.last_error
})

const toEpisode = (r: EpisodeRow): PodcastEpisode => ({
  id: r.id,
  podcastId: r.podcast_id,
  guid: r.guid,
  title: r.title,
  description: r.description,
  audioUrl: r.audio_url,
  mime: r.mime,
  size: r.size,
  duration: r.duration,
  publishedAt: r.published_at,
  imagePath: r.image_path,
  localPath: r.local_path,
  position: r.position,
  completed: r.completed === 1
})

/**
 * Tous les flux connus, quel que soit le profil abonné : c'est ce que l'on rafraîchit. Le flux
 * et ses épisodes sont communs ; l'abonnement et l'écoute sont propres à chaque profil.
 */
export function list(db: Database): Podcast[] {
  return all<PodcastRow>(db, 'SELECT * FROM podcasts ORDER BY title COLLATE NOCASE').map(toPodcast)
}

/** Les abonnements d'un profil. */
export function subscribed(db: Database, profileId: number): Podcast[] {
  return all<PodcastRow>(
    db,
    `SELECT p.* FROM podcasts p
       JOIN podcast_subscriptions s ON s.podcast_id = p.id AND s.profile_id = ?
      ORDER BY p.title COLLATE NOCASE`,
    profileId
  ).map(toPodcast)
}

export function isSubscribed(db: Database, profileId: number, podcastId: number): boolean {
  return (
    one(
      db,
      'SELECT 1 FROM podcast_subscriptions WHERE profile_id = ? AND podcast_id = ?',
      profileId,
      podcastId
    ) !== null
  )
}

export function subscribe(db: Database, profileId: number, podcastId: number): void {
  run(
    db,
    'INSERT OR IGNORE INTO podcast_subscriptions (profile_id, podcast_id) VALUES (?, ?)',
    profileId,
    podcastId
  )
}

export function unsubscribe(db: Database, profileId: number, podcastId: number): void {
  run(
    db,
    'DELETE FROM podcast_subscriptions WHERE profile_id = ? AND podcast_id = ?',
    profileId,
    podcastId
  )
}

/** Flux que plus personne ne suit : à supprimer, avec leurs épisodes et téléchargements. */
export function orphans(db: Database): Podcast[] {
  return all<PodcastRow>(
    db,
    `SELECT * FROM podcasts p
      WHERE NOT EXISTS (SELECT 1 FROM podcast_subscriptions s WHERE s.podcast_id = p.id)`
  ).map(toPodcast)
}

export function get(db: Database, id: number): Podcast | null {
  const row = one<PodcastRow>(db, 'SELECT * FROM podcasts WHERE id = ?', id)
  return row ? toPodcast(row) : null
}

export function byFeedUrl(db: Database, feedUrl: string): Podcast | null {
  const row = one<PodcastRow>(db, 'SELECT * FROM podcasts WHERE feed_url = ?', feedUrl)
  return row ? toPodcast(row) : null
}

/** Crée l'abonnement s'il n'existe pas, sinon rafraîchit ses informations. */
export function upsert(
  db: Database,
  feedUrl: string,
  info: Pick<Podcast, 'title' | 'description' | 'author' | 'website' | 'imageUrl'>
): Podcast {
  const row = one<{ id: number }>(
    db,
    `INSERT INTO podcasts (feed_url, title, description, author, website, image_url)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (feed_url) DO UPDATE SET
       title = excluded.title,
       description = COALESCE(excluded.description, podcasts.description),
       author = COALESCE(excluded.author, podcasts.author),
       website = COALESCE(excluded.website, podcasts.website),
       image_url = COALESCE(excluded.image_url, podcasts.image_url)
     RETURNING id`,
    feedUrl,
    info.title,
    info.description,
    info.author,
    info.website,
    info.imageUrl
  )!
  return get(db, row.id)!
}

export function remove(db: Database, id: number): boolean {
  return run(db, 'DELETE FROM podcasts WHERE id = ?', id).changes > 0
}

export function markFetched(db: Database, id: number, error: string | null = null): void {
  run(db, 'UPDATE podcasts SET last_fetch_at = unixepoch(), last_error = ? WHERE id = ?', error, id)
}

export function setImagePath(db: Database, id: number, path: string): void {
  run(db, 'UPDATE podcasts SET image_path = ? WHERE id = ?', path, id)
}

// ---- épisodes ----

export interface EpisodeInput {
  guid: string
  title: string
  description: string | null
  audioUrl: string
  mime: string | null
  size: number | null
  duration: number | null
  publishedAt: number | null
}

/**
 * Insère les nouveaux épisodes et met à jour les existants, sans jamais écraser l'état de
 * lecture ni la copie téléchargée. Retourne le nombre d'épisodes réellement nouveaux.
 */
export function upsertEpisodes(db: Database, podcastId: number, episodes: EpisodeInput[]): number {
  const before = count(db, podcastId)
  transaction(db, () => {
    for (const e of episodes) {
      run(
        db,
        `INSERT INTO podcast_episodes
           (podcast_id, guid, title, description, audio_url, mime, size, duration, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (podcast_id, guid) DO UPDATE SET
           title = excluded.title,
           description = COALESCE(excluded.description, podcast_episodes.description),
           audio_url = excluded.audio_url,
           duration = COALESCE(excluded.duration, podcast_episodes.duration),
           published_at = COALESCE(excluded.published_at, podcast_episodes.published_at)`,
        podcastId,
        e.guid,
        e.title,
        e.description,
        e.audioUrl,
        e.mime,
        e.size,
        e.duration,
        e.publishedAt
      )
    }
  })
  return count(db, podcastId) - before
}

/**
 * Épisode et écoute du profil : le premier paramètre est l'identifiant du profil. Sans profil
 * (`null`), l'épisode est rendu comme jamais écouté.
 */
const EPISODE_SELECT = `
  SELECT e.*, COALESCE(pp.position, 0) AS position, COALESCE(pp.completed, 0) AS completed
    FROM podcast_episodes e
    LEFT JOIN podcast_progress pp ON pp.episode_id = e.id AND pp.profile_id = ?`

export function episodes(
  db: Database,
  profileId: number,
  podcastId: number,
  limit = 200
): PodcastEpisode[] {
  return all<EpisodeRow>(
    db,
    `${EPISODE_SELECT} WHERE e.podcast_id = ?
     ORDER BY e.published_at DESC NULLS LAST, e.id DESC LIMIT ?`,
    profileId,
    podcastId,
    limit
  ).map(toEpisode)
}

export function episode(
  db: Database,
  id: number,
  profileId: number | null = null
): PodcastEpisode | null {
  const row = one<EpisodeRow>(db, `${EPISODE_SELECT} WHERE e.id = ?`, profileId, id)
  return row ? toEpisode(row) : null
}

/** Sert à retrouver l'épisode derrière une URL jouée, pour la lecture. */
export function episodeByUrl(db: Database, url: string): PodcastEpisode | null {
  const row = one<EpisodeRow>(
    db,
    `${EPISODE_SELECT} WHERE e.audio_url = ? OR e.local_path = ? LIMIT 1`,
    null,
    url,
    url
  )
  return row ? toEpisode(row) : null
}

export function count(db: Database, podcastId: number): number {
  return one<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM podcast_episodes WHERE podcast_id = ?',
    podcastId
  )!.n
}

export function unplayedCount(db: Database, profileId: number, podcastId: number): number {
  return one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM podcast_episodes e
      WHERE e.podcast_id = ?
        AND NOT EXISTS (SELECT 1 FROM podcast_progress pp
                         WHERE pp.episode_id = e.id AND pp.profile_id = ? AND pp.completed = 1)`,
    podcastId,
    profileId
  )!.n
}

export function saveProgress(
  db: Database,
  profileId: number,
  id: number,
  position: number,
  completed?: boolean
): void {
  const flag = completed === undefined ? null : completed ? 1 : 0
  run(
    db,
    `INSERT INTO podcast_progress (profile_id, episode_id, position, completed)
     VALUES (?, ?, ?, COALESCE(?, 0))
     ON CONFLICT (profile_id, episode_id) DO UPDATE SET
       position = excluded.position,
       completed = COALESCE(?, completed),
       updated_at = unixepoch()`,
    profileId,
    id,
    position,
    flag,
    flag
  )
}

export function setCompleted(
  db: Database,
  profileId: number,
  id: number,
  completed: boolean
): void {
  run(
    db,
    `INSERT INTO podcast_progress (profile_id, episode_id, position, completed) VALUES (?, ?, 0, ?)
     ON CONFLICT (profile_id, episode_id) DO UPDATE SET
       completed = excluded.completed,
       position = CASE WHEN excluded.completed = 1 THEN 0 ELSE position END,
       updated_at = unixepoch()`,
    profileId,
    id,
    completed ? 1 : 0
  )
}

export function setLocalPath(db: Database, id: number, path: string | null): void {
  run(db, 'UPDATE podcast_episodes SET local_path = ? WHERE id = ?', path, id)
}

export function setEpisodeImage(db: Database, id: number, path: string): void {
  run(db, 'UPDATE podcast_episodes SET image_path = ? WHERE id = ?', path, id)
}
