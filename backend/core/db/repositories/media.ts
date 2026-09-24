import type {
  Media,
  MediaInput,
  MediaMetadata,
  MediaMetadataInput,
  Facets,
  MediaQuery,
  MediaSort,
  MediaType,
  MediaWithMetadata
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
  probed_at: number | null
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
  probedAt: r.probed_at,
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

export type ListOptions = MediaQuery

/**
 * Convertit une saisie libre en requête FTS5 : chaque mot devient une phrase entre guillemets
 * (les opérateurs saisis sont donc inertes) et le dernier mot accepte un préfixe, pour la
 * recherche au fil de la frappe. Retourne null si la saisie ne contient aucun mot utile.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = input
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 12)
  if (tokens.length === 0) return null
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' AND ')
}

const SORT_COLUMNS: Record<Exclude<MediaSort, 'relevance'>, string> = {
  title: 'm.title COLLATE NOCASE',
  addedAt: 'm.added_at',
  duration: 'm.duration',
  year: 'md.year'
}

interface Query {
  where: string
  params: SqlParam[]
  orderBy: string
  /** La recherche FTS impose une jointure supplémentaire */
  join: string
}

function buildQuery(opts: ListOptions): Query {
  const where: string[] = []
  const params: SqlParam[] = []
  let join = ''
  let relevance = false

  const fts = opts.search ? toFtsQuery(opts.search) : null
  if (fts) {
    join = ' JOIN media_fts f ON f.rowid = m.id'
    where.push('media_fts MATCH ?')
    params.push(fts)
    relevance = true
  } else if (opts.search) {
    // Saisie sans aucun mot indexable (que de la ponctuation) : aucun résultat
    where.push('0')
  }
  if (opts.type) {
    where.push('m.type = ?')
    params.push(opts.type)
  }
  if (opts.sourceId !== undefined) {
    where.push('m.source_id = ?')
    params.push(opts.sourceId)
  }
  if (opts.genre) {
    where.push('md.genre = ?')
    params.push(opts.genre)
  }
  if (opts.year !== undefined) {
    where.push('md.year = ?')
    params.push(opts.year)
  }
  if (opts.unwatched) {
    where.push('COALESCE(ps.completed, 0) = 0')
  }

  const sort = opts.sort ?? (relevance ? 'relevance' : 'title')
  const dir = opts.order ?? (sort === 'addedAt' || sort === 'year' ? 'desc' : 'asc')
  const orderBy =
    sort === 'relevance' && relevance
      ? 'f.rank, m.title COLLATE NOCASE'
      : `${SORT_COLUMNS[sort === 'relevance' ? 'title' : sort]} ${dir.toUpperCase()} NULLS LAST, m.title COLLATE NOCASE`

  return { where: where.length ? ` WHERE ${where.join(' AND ')}` : '', params, orderBy, join }
}

/** Jointures communes : métadonnées (filtres genre/année) et état de lecture (« non vus »). */
const BASE_FROM =
  ' FROM media m LEFT JOIN media_metadata md ON md.media_id = m.id' +
  ' LEFT JOIN playback_state ps ON ps.media_id = m.id'

function select(columns: string, opts: ListOptions): { sql: string; params: SqlParam[] } {
  const q = buildQuery(opts)
  const sql = `SELECT ${columns}${BASE_FROM}${q.join}${q.where} ORDER BY ${q.orderBy} LIMIT ? OFFSET ?`
  return { sql, params: [...q.params, opts.limit ?? 500, opts.offset ?? 0] }
}

export function list(db: Database, opts: ListOptions = {}): Media[] {
  const { sql, params } = select('m.*', opts)
  return all<Row>(db, sql, ...params).map(toMedia)
}

/** Liste avec métadonnées jointes, mêmes filtres que `list`. */
export function listWithMetadata(db: Database, opts: ListOptions = {}): MediaWithMetadata[] {
  const { sql, params } = select(
    `m.*, md.media_id AS md_media_id, md.container, md.video_codec, md.audio_codec, md.width, md.height,
     md.bitrate, md.artist, md.album, md.album_artist, md.year, md.track, md.genre, md.overview,
     md.rating, md.external_id, md.thumbnail_path, md.poster_path, md.updated_at AS md_updated_at`,
    opts
  )
  return all<Row & JoinedMetaRow>(db, sql, ...params).map((r) => ({
    ...toMedia(r),
    metadata:
      r.md_media_id === null
        ? null
        : toMetadata({ ...r, media_id: r.md_media_id, updated_at: r.md_updated_at })
  }))
}

type JoinedMetaRow = Omit<MetaRow, 'media_id' | 'updated_at'> & {
  md_media_id: number | null
  md_updated_at: number
}

export function facets(db: Database): Facets {
  return {
    genres: all<{ genre: string }>(
      db,
      "SELECT DISTINCT genre FROM media_metadata WHERE genre IS NOT NULL AND genre != '' ORDER BY genre COLLATE NOCASE"
    ).map((r) => r.genre),
    years: all<{ year: number }>(
      db,
      'SELECT DISTINCT year FROM media_metadata WHERE year IS NOT NULL ORDER BY year DESC'
    ).map((r) => r.year)
  }
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
       probed_at = CASE
         WHEN excluded.mtime != media.mtime OR excluded.size != media.size THEN NULL
         ELSE media.probed_at
       END,
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

/** Médias jamais analysés par ffprobe (ou invalidés par le scanner). */
export function listUnprobed(db: Database, sourceId?: number, limit = 10_000): number[] {
  const rows =
    sourceId === undefined
      ? all<{ id: number }>(db, 'SELECT id FROM media WHERE probed_at IS NULL LIMIT ?', limit)
      : all<{ id: number }>(
          db,
          'SELECT id FROM media WHERE probed_at IS NULL AND source_id = ? LIMIT ?',
          sourceId,
          limit
        )
  return rows.map((r) => r.id)
}

/** Résultat de l'analyse : durée, titre corrigé éventuel, et marquage "analysé" (même en cas d'échec). */
export function markProbed(
  db: Database,
  id: number,
  patch: { duration?: number | null; title?: string } = {}
): void {
  run(
    db,
    `UPDATE media SET
       probed_at = unixepoch(),
       duration = COALESCE(?, duration),
       title = COALESCE(?, title),
       updated_at = unixepoch()
     WHERE id = ?`,
    patch.duration ?? null,
    patch.title ?? null,
    id
  )
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

export function count(db: Database, opts: ListOptions | MediaType = {}): number {
  const o: ListOptions = typeof opts === 'string' ? { type: opts } : opts
  const q = buildQuery(o)
  return one<{ n: number }>(db, `SELECT COUNT(*) AS n${BASE_FROM}${q.join}${q.where}`, ...q.params)!
    .n
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
