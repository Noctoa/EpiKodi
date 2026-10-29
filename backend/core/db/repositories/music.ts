import { all, one, run, type Database } from '../database'

export type ArtworkKind = 'album' | 'artist'

export interface Artwork {
  kind: ArtworkKind
  key: string
  name: string
  /** null : cherché, rien trouvé */
  imagePath: string | null
  source: string | null
  mbid: string | null
  lookedUpAt: number
}

interface ArtworkRow {
  kind: ArtworkKind
  key: string
  name: string
  image_path: string | null
  source: string | null
  mbid: string | null
  looked_up_at: number
}

const toArtwork = (r: ArtworkRow): Artwork => ({
  kind: r.kind,
  key: r.key,
  name: r.name,
  imagePath: r.image_path,
  source: r.source,
  mbid: r.mbid,
  lookedUpAt: r.looked_up_at
})

/** Morceaux analysés par ffprobe dont la reconnaissance n'a pas encore été tentée. */
export function pendingTracks(db: Database, limit = 1000): number[] {
  return all<{ id: number }>(
    db,
    `SELECT id FROM media
      WHERE type = 'audio' AND identified_at IS NULL AND probed_at IS NOT NULL
      ORDER BY id LIMIT ?`,
    limit
  ).map((r) => r.id)
}

export function artwork(db: Database, kind: ArtworkKind, key: string): Artwork | null {
  const row = one<ArtworkRow>(
    db,
    'SELECT * FROM music_artwork WHERE kind = ? AND key = ?',
    kind,
    key
  )
  return row ? toArtwork(row) : null
}

/** Une recherche infructueuse est retentée au bout d'un mois : les bases s'enrichissent. */
export const MISS_TTL_SECONDS = 30 * 86400
/** Une source momentanément indisponible : on retente le lendemain. */
const RETRY_SOON_SECONDS = 86400

export function saveArtwork(
  db: Database,
  input: Omit<Artwork, 'lookedUpAt'> & { retrySoon?: boolean }
): void {
  // Daté dans le passé, pour que `forgetMisses` l'oublie dès demain plutôt que dans un mois
  const age = input.retrySoon ? MISS_TTL_SECONDS - RETRY_SOON_SECONDS : 0
  run(
    db,
    `INSERT INTO music_artwork (kind, key, name, image_path, source, mbid, looked_up_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch() - ?)
     ON CONFLICT (kind, key) DO UPDATE SET
       name = excluded.name, image_path = excluded.image_path, source = excluded.source,
       mbid = excluded.mbid, looked_up_at = excluded.looked_up_at`,
    input.kind,
    input.key,
    input.name,
    input.imagePath,
    input.source,
    input.mbid,
    age
  )
}

/**
 * Oublie les recherches infructueuses anciennes : un album absent des bases aujourd'hui y sera
 * peut-être le mois prochain. Les pistes concernées sont remises en file.
 */
export function forgetMisses(db: Database, olderThan: number): number {
  const forgotten = run(
    db,
    'DELETE FROM music_artwork WHERE image_path IS NULL AND looked_up_at < ?',
    olderThan
  ).changes
  if (forgotten > 0) {
    run(
      db,
      `UPDATE media SET identified_at = NULL
        WHERE type = 'audio' AND identified_at IS NOT NULL
          AND id IN (SELECT media_id FROM media_metadata
                      WHERE poster_path IS NULL OR backdrop_path IS NULL)`
    )
  }
  return forgotten
}

export interface MusicStats {
  /** Morceaux en attente de reconnaissance */
  pending: number
  /** Morceaux identifiés en ligne : par leur empreinte, ou par leur nom sur Deezer */
  recognized: number
  albumsWithCover: number
  artistsWithImage: number
  /** Morceaux sans artiste ou sans album qu'AcoustID n'a pas reconnus */
  unrecognized: number
  /** Albums et artistes qu'aucune source ne connaît, pour que l'utilisateur sache lesquels */
  notFound: string[]
}

export function stats(db: Database): MusicStats {
  const row = one<{
    pending: number
    recognized: number
    albums: number
    artists: number
    unrecognized: number
  }>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM media WHERE type = 'audio' AND identified_at IS NULL) AS pending,
       (SELECT COUNT(*) FROM media_metadata
         WHERE external_id LIKE 'musicbrainz:recording:%' OR external_id LIKE 'deezer:track:%')
         AS recognized,
       (SELECT COUNT(*) FROM music_artwork WHERE kind = 'album' AND image_path IS NOT NULL)
         AS albums,
       (SELECT COUNT(*) FROM music_artwork WHERE kind = 'artist' AND image_path IS NOT NULL)
         AS artists,
       (SELECT COUNT(*) FROM media m LEFT JOIN media_metadata md ON md.media_id = m.id
         WHERE m.type = 'audio' AND m.identified_at IS NOT NULL
           AND (md.artist IS NULL OR md.album IS NULL)
           AND COALESCE(md.external_id, '') NOT LIKE 'musicbrainz:%'
           AND COALESCE(md.external_id, '') NOT LIKE 'deezer:%') AS unrecognized`
  )!
  const notFound = all<{ name: string }>(
    db,
    `SELECT name FROM music_artwork WHERE image_path IS NULL
      ORDER BY kind, name COLLATE NOCASE LIMIT 20`
  ).map((r) => r.name)
  return {
    pending: row.pending,
    recognized: row.recognized,
    albumsWithCover: row.albums,
    artistsWithImage: row.artists,
    unrecognized: row.unrecognized,
    notFound
  }
}

/** Une clé AcoustID vient d'être saisie : les morceaux sans tags ont enfin leur chance. */
export function requeueUntagged(db: Database): number {
  return run(
    db,
    `UPDATE media SET identified_at = NULL
      WHERE type = 'audio' AND identified_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM media_metadata md
                         WHERE md.media_id = media.id AND md.artist IS NOT NULL
                           AND md.album IS NOT NULL)`
  ).changes
}

/** La recherche en ligne vient d'être réactivée : les morceaux sans images sont repris. */
export function requeueWithoutArtwork(db: Database): number {
  return run(
    db,
    `UPDATE media SET identified_at = NULL
      WHERE type = 'audio' AND identified_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM media_metadata md
                         WHERE md.media_id = media.id AND md.poster_path IS NOT NULL
                           AND md.backdrop_path IS NOT NULL)`
  ).changes
}
