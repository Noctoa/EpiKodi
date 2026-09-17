import type {
  Media,
  MediaInput,
  MediaMetadata,
  MediaMetadataInput,
  MediaType
} from '@shared/models'
import { all, one, run, type Database, type SqlParam } from '../database'

interface Row {
  id: number
  source_id: number
  path: string
  type: MediaType
  title: string
  size: number
  mtime: number
  duration: number | null
  added_at: number
  updated_at: number
}

const toMedia = (r: Row): Media => ({
  id: r.id,
  sourceId: r.source_id,
  path: r.path,
  type: r.type,
  title: r.title,
  size: r.size,
  mtime: r.mtime,
  duration: r.duration,
  addedAt: r.added_at,
  updatedAt: r.updated_at
})

export function get(db: Database, id: number): Media | null {
  const row = one<Row>(db, 'SELECT * FROM media WHERE id = ?', id)
  return row ? toMedia(row) : null
}

export function getByPath(db: Database, sourceId: number, path: string): Media | null {
  const row = one<Row>(db, 'SELECT * FROM media WHERE source_id = ? AND path = ?', sourceId, path)
  return row ? toMedia(row) : null
}

export interface ListOptions {
  type?: MediaType
  sourceId?: number
  /** Recherche insensible à la casse sur le titre */
  search?: string
  limit?: number
  offset?: number
}

export function list(db: Database, opts: ListOptions = {}): Media[] {
  const where: string[] = []
  const params: SqlParam[] = []
  if (opts.type) {
    where.push('type = ?')
    params.push(opts.type)
  }
  if (opts.sourceId !== undefined) {
    where.push('source_id = ?')
    params.push(opts.sourceId)
  }
  if (opts.search) {
    where.push('title LIKE ? COLLATE NOCASE')
    params.push(`%${opts.search}%`)
  }
  const sql =
    'SELECT * FROM media' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?'
  params.push(opts.limit ?? 500, opts.offset ?? 0)
  return all<Row>(db, sql, ...params).map(toMedia)
}

/**
 * Insère le média, ou le met à jour s'il existe déjà pour (source, chemin).
 * C'est l'opération du scanner : un rescan ne crée jamais de doublon.
 */
export function upsert(db: Database, input: MediaInput): Media {
  const row = one<{ id: number }>(
    db,
    `INSERT INTO media (source_id, path, type, title, size, mtime, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source_id, path) DO UPDATE SET
       type = excluded.type,
       title = excluded.title,
       size = excluded.size,
       mtime = excluded.mtime,
       duration = COALESCE(excluded.duration, media.duration),
       updated_at = unixepoch()
     RETURNING id`,
    input.sourceId,
    input.path,
    input.type,
    input.title,
    input.size,
    input.mtime,
    input.duration ?? null
  )!
  return get(db, row.id)!
}

export function remove(db: Database, id: number): boolean {
  return run(db, 'DELETE FROM media WHERE id = ?', id).changes > 0
}

/** Supprime les médias d'une source dont le chemin n'est pas dans `keepPaths` (fichiers disparus). */
export function removeMissing(db: Database, sourceId: number, keepPaths: string[]): number {
  const keep = new Set(keepPaths)
  const rows = all<Pick<Row, 'id' | 'path'>>(
    db,
    'SELECT id, path FROM media WHERE source_id = ?',
    sourceId
  )
  let count = 0
  for (const r of rows)
    if (!keep.has(r.path)) count += run(db, 'DELETE FROM media WHERE id = ?', r.id).changes
  return count
}

export function count(db: Database, type?: MediaType): number {
  const row = type
    ? one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM media WHERE type = ?', type)
    : one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM media')
  return row!.n
}

// ---------- métadonnées ----------

interface MetaRow {
  media_id: number
  container: string | null
  video_codec: string | null
  audio_codec: string | null
  width: number | null
  height: number | null
  bitrate: number | null
  artist: string | null
  album: string | null
  album_artist: string | null
  year: number | null
  track: number | null
  genre: string | null
  overview: string | null
  rating: number | null
  external_id: string | null
  thumbnail_path: string | null
  poster_path: string | null
  updated_at: number
}

const toMetadata = (r: MetaRow): MediaMetadata => ({
  mediaId: r.media_id,
  container: r.container,
  videoCodec: r.video_codec,
  audioCodec: r.audio_codec,
  width: r.width,
  height: r.height,
  bitrate: r.bitrate,
  artist: r.artist,
  album: r.album,
  albumArtist: r.album_artist,
  year: r.year,
  track: r.track,
  genre: r.genre,
  overview: r.overview,
  rating: r.rating,
  externalId: r.external_id,
  thumbnailPath: r.thumbnail_path,
  posterPath: r.poster_path,
  updatedAt: r.updated_at
})

/** camelCase (TS) → snake_case (SQL) */
const META_COLUMNS: Record<keyof MediaMetadataInput, string> = {
  container: 'container',
  videoCodec: 'video_codec',
  audioCodec: 'audio_codec',
  width: 'width',
  height: 'height',
  bitrate: 'bitrate',
  artist: 'artist',
  album: 'album',
  albumArtist: 'album_artist',
  year: 'year',
  track: 'track',
  genre: 'genre',
  overview: 'overview',
  rating: 'rating',
  externalId: 'external_id',
  thumbnailPath: 'thumbnail_path',
  posterPath: 'poster_path'
}

export function getMetadata(db: Database, mediaId: number): MediaMetadata | null {
  const row = one<MetaRow>(db, 'SELECT * FROM media_metadata WHERE media_id = ?', mediaId)
  return row ? toMetadata(row) : null
}

/** Crée ou fusionne les métadonnées : seuls les champs fournis sont écrasés. */
export function setMetadata(
  db: Database,
  mediaId: number,
  input: MediaMetadataInput
): MediaMetadata {
  const keys = (Object.keys(input) as (keyof MediaMetadataInput)[]).filter(
    (k) => input[k] !== undefined
  )
  const cols = keys.map((k) => META_COLUMNS[k])
  const values = keys.map((k) => input[k] as string | number | null)
  const sql =
    `INSERT INTO media_metadata (media_id${cols.map((c) => `, ${c}`).join('')})` +
    ` VALUES (?${cols.map(() => ', ?').join('')})` +
    ` ON CONFLICT (media_id) DO UPDATE SET updated_at = unixepoch()` +
    cols.map((c) => `, ${c} = excluded.${c}`).join('')
  run(db, sql, mediaId, ...values)
  return getMetadata(db, mediaId)!
}
