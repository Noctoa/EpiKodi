/** Contrat IPC partagé entre backend (main + preload) et frontend. */
import type { Facets, MediaQuery, MediaWithMetadata, Source } from './models'

export const IPC = {
  openMediaDialog: 'dialog:open-media',
  mediaOpened: 'media:opened',
  libraryStats: 'library:stats',
  sourcesList: 'sources:list',
  sourcesAdd: 'sources:add',
  sourcesRemove: 'sources:remove',
  sourcesScan: 'sources:scan',
  sourcesCancelScan: 'sources:cancel-scan',
  scanProgress: 'scan:progress',
  libraryChanged: 'library:changed',
  mediaList: 'media:list',
  mediaFacets: 'media:facets',
  systemFfmpeg: 'system:ffmpeg',
  systemInfo: 'system:info',
  playerPlan: 'player:plan',
  playerSubtitles: 'player:subtitles',
  playerSubtitleVtt: 'player:subtitle-vtt'
} as const

/** Une piste de sous-titres proposée par le lecteur. */
export interface SubtitleTrack {
  id: string
  label: string
  language: string | null
  source: 'internal' | 'external'
  /** interne : index du flux ffmpeg */
  streamIndex?: number
  /** externe : fichier à côté de la vidéo */
  path?: string
}

export interface SystemInfo {
  version: string
  databasePath: string
  thumbnailDir: string
  ffmpeg: FfmpegStatus
}

export interface FfmpegStatus {
  ffprobe: boolean
  ffmpeg: boolean
  version: string | null
}

/** Événement : la bibliothèque a changé (scan, enrichissement) → recharger l'affichage. */
export interface LibraryChanged {
  /** Médias encore en attente d'analyse ffprobe */
  enrichPending: number
}

export interface LibraryStats {
  sources: number
  media: number
  videos: number
  audio: number
  podcasts: number
}

export interface OpenedMedia {
  /** Chemin absolu sur le disque */
  path: string
  /** Nom de fichier affichable */
  name: string
  /** URL `media://` consommable par <video> / <audio> */
  url: string
}

export interface ScanProgress {
  sourceId: number
  scanned: number
  added: number
  updated: number
  removed: number
  current: string
  done: boolean
  error?: string
}

/** Alias historique : la requête de bibliothèque est définie dans `models.ts`. */
export type MediaListQuery = MediaQuery

export interface EpiKodiApi {
  openMediaDialog(): Promise<OpenedMedia | null>
  /** Média ouvert depuis l'extérieur (ligne de commande, "ouvrir avec"). Retourne un désabonnement. */
  onMediaOpened(cb: (media: OpenedMedia) => void): () => void
  libraryStats(): Promise<LibraryStats>

  sourcesList(): Promise<Source[]>
  /** Ouvre le sélecteur de dossier ; null si annulé. Lance un premier scan automatiquement. */
  sourcesAdd(): Promise<Source | null>
  sourcesRemove(id: number): Promise<void>
  sourcesScan(id: number): Promise<void>
  sourcesCancelScan(id: number): Promise<void>
  onScanProgress(cb: (p: ScanProgress) => void): () => void
  onLibraryChanged(cb: (e: LibraryChanged) => void): () => void

  mediaList(query?: MediaListQuery): Promise<MediaWithMetadata[]>
  /** Genres et années présents en bibliothèque, pour les menus de filtres. */
  mediaFacets(): Promise<Facets>
  systemFfmpeg(): Promise<FfmpegStatus>
  systemInfo(): Promise<SystemInfo>

  /** Indique si le fichier est lisible tel quel, ou doit être remuxé / ré-encodé. */
  playerPlan(path: string): Promise<PlaybackPlanInfo>
  /** Pistes de sous-titres disponibles pour un fichier (internes + .srt/.vtt à côté). */
  playerSubtitles(path: string): Promise<SubtitleTrack[]>
  playerSubtitleVtt(path: string, track: SubtitleTrack): Promise<string>
}

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ogv']
export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'ogg', 'oga', 'm4a', 'wav', 'aac', 'opus']

/** Protocole custom servi par le backend (voir backend/media-protocol.ts). */
export const MEDIA_SCHEME = 'media'

export function toMediaUrl(absolutePath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(absolutePath)}`
}

/** Flux transcodé à la volée, repris à `seek` secondes. */
export function toStreamUrl(absolutePath: string, seek = 0): string {
  return `${MEDIA_SCHEME}://stream/${encodeURIComponent(absolutePath)}?t=${seek.toFixed(3)}`
}

export type PlaybackMode = 'direct' | 'remux' | 'transcode'

/** Comment le backend compte servir un fichier au lecteur. */
export interface PlaybackPlanInfo {
  mode: PlaybackMode
  /** Explication affichable : « audio ac3 non supporté → ré-encodage » */
  reason: string
  /** Durée connue par ffprobe : le lecteur ne peut pas la déduire d'un flux transcodé */
  duration: number | null
}
