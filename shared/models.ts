/** Modèles de la bibliothèque, partagés backend ↔ frontend. Miroir des tables SQLite. */

export type SourceType = 'local' | 'smb' | 'nfs' | 'http'
export type MediaType = 'video' | 'audio' | 'podcast'

export interface Source {
  id: number
  type: SourceType
  path: string
  name: string
  createdAt: number
  lastScanAt: number | null
}

export interface Media {
  id: number
  sourceId: number
  path: string
  type: MediaType
  title: string
  size: number
  mtime: number
  duration: number | null
  /** Date d'analyse ffprobe ; null = en attente d'enrichissement */
  probedAt: number | null
  addedAt: number
  updatedAt: number
}

/** Média + ses métadonnées enrichies (null tant que ffprobe n'est pas passé) */
export interface MediaWithMetadata extends Media {
  metadata: MediaMetadata | null
}

export interface MediaMetadata {
  mediaId: number
  container: string | null
  videoCodec: string | null
  audioCodec: string | null
  width: number | null
  height: number | null
  bitrate: number | null
  artist: string | null
  album: string | null
  albumArtist: string | null
  year: number | null
  track: number | null
  genre: string | null
  overview: string | null
  rating: number | null
  externalId: string | null
  thumbnailPath: string | null
  posterPath: string | null
  updatedAt: number
}

export interface Playlist {
  id: number
  name: string
  createdAt: number
}

export interface PlaybackState {
  mediaId: number
  position: number
  completed: boolean
  favorite: boolean
  playCount: number
  lastPlayedAt: number | null
}

export type MediaSort = 'relevance' | 'title' | 'addedAt' | 'duration' | 'year'

/** Filtres, recherche et tri de la bibliothèque (partagés backend ↔ frontend). */
export interface MediaQuery {
  type?: MediaType
  sourceId?: number
  /** Recherche plein texte : titre, artiste, album, chemin */
  search?: string
  genre?: string
  year?: number
  /** Exclut les médias marqués comme terminés */
  unwatched?: boolean
  sort?: MediaSort
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/** Valeurs disponibles pour alimenter les menus de filtres. */
export interface Facets {
  genres: string[]
  years: number[]
}

/** Ce que le scanner fournit pour créer ou mettre à jour un média. */
export type MediaInput = Pick<Media, 'sourceId' | 'path' | 'type' | 'title' | 'size' | 'mtime'> &
  Partial<Pick<Media, 'duration'>>

export type MediaMetadataInput = Partial<Omit<MediaMetadata, 'mediaId' | 'updatedAt'>>
