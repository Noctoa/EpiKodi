/** Contrat IPC partagé entre backend (main + preload) et frontend. */
import type { Media, MediaType, Source } from './models'

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
  mediaList: 'media:list'
} as const

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

export interface MediaListQuery {
  type?: MediaType
  sourceId?: number
  search?: string
  limit?: number
  offset?: number
}

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

  mediaList(query?: MediaListQuery): Promise<Media[]>
}

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ogv']
export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'ogg', 'oga', 'm4a', 'wav', 'aac', 'opus']

/** Protocole custom servi par le backend (voir backend/media-protocol.ts). */
export const MEDIA_SCHEME = 'media'

export function toMediaUrl(absolutePath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(absolutePath)}`
}
