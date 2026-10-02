/** Contrat IPC partagé entre backend (main + preload) et frontend. */
import type {
  Facets,
  MediaQuery,
  MediaWithMetadata,
  Podcast,
  PodcastEpisode,
  Source
} from './models'

export const IPC = {
  openMediaDialog: 'dialog:open-media',
  mediaOpened: 'media:opened',
  libraryStats: 'library:stats',
  sourcesList: 'sources:list',
  sourcesAdd: 'sources:add',
  sourcesAddNetwork: 'sources:add-network',
  sourcesAvailability: 'sources:availability',
  sourcesRemove: 'sources:remove',
  sourcesScan: 'sources:scan',
  sourcesCancelScan: 'sources:cancel-scan',
  scanProgress: 'scan:progress',
  libraryChanged: 'library:changed',
  mediaList: 'media:list',
  mediaFacets: 'media:facets',
  systemFfmpeg: 'system:ffmpeg',
  systemInfo: 'system:info',
  metadataStatus: 'metadata:status',
  metadataSetKey: 'metadata:set-key',
  metadataSuggest: 'metadata:suggest',
  metadataApply: 'metadata:apply',
  pluginsList: 'plugins:list',
  pluginsSetEnabled: 'plugins:set-enabled',
  podcastsList: 'podcasts:list',
  podcastsEpisodes: 'podcasts:episodes',
  podcastsSubscribe: 'podcasts:subscribe',
  podcastsRefresh: 'podcasts:refresh',
  podcastsRefreshAll: 'podcasts:refresh-all',
  podcastsRemove: 'podcasts:remove',
  podcastsSearch: 'podcasts:search',
  episodeDownload: 'episode:download',
  episodeRemoveDownload: 'episode:remove-download',
  episodeProgress: 'episode:progress',
  episodeCompleted: 'episode:completed',
  episodeDownloadProgress: 'episode:download-progress',
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

/** Résultat d'un abonnement ou d'un rafraîchissement de flux. */
export interface PodcastRefresh {
  podcastId: number
  title: string
  added: number
  total: number
  error: string | null
}

export interface PodcastSearchResult {
  title: string
  author: string | null
  feedUrl: string
  imageUrl: string | null
  episodeCount: number | null
}

/** Un abonnement et son nombre d'épisodes non écoutés, pour l'affichage. */
export interface PodcastWithCounts extends Podcast {
  episodeCount: number
  unplayed: number
}

export interface EpisodeDownload {
  episodeId: number
  received: number
  total: number
  done: boolean
  error?: string
}

/** Un candidat proposé par une source de métadonnées externe. */
export interface MetadataMatch {
  /** Identifiant technique : « tmdb », « plugin:tvmaze-provider » */
  provider: string
  /** Nom lisible, affiché à côté du résultat : « TheMovieDB », « TVmaze » */
  providerName: string
  externalId: string
  kind: 'movie' | 'tv'
  title: string
  originalTitle: string | null
  year: number | null
  overview: string | null
  rating: number | null
  posterUrl: string | null
  backdropUrl: string | null
  /** Pertinence estimée, entre 0 et 1 */
  score: number
}

/** Une extension installée, telle qu'affichée dans les Paramètres. */
export interface PluginSummary {
  id: string
  name: string
  version: string
  description: string | null
  author: string | null
  permissions: string[]
  contributes: string[]
  enabled: boolean
  status: 'inactive' | 'active' | 'error'
  /** Message du dernier problème : manifeste invalide, chargement raté, plantage */
  error: string | null
}

/** Dossier contenant un manifeste illisible : signalé, jamais chargé. */
export interface PluginProblem {
  dir: string
  errors: { field: string; message: string }[]
}

export interface PluginList {
  plugins: PluginSummary[]
  broken: PluginProblem[]
  /** Dossier où déposer les extensions */
  directory: string
}

export interface MetadataStatus {
  /** Une clé d'API est enregistrée */
  configured: boolean
  providerName: string
  /** Médias encore en attente d'identification */
  pending: number
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
  /** Déclare un partage réseau : `smb://user@nas/media/Films`, `https://dav.example/media`. */
  sourcesAddNetwork(url: string, password: string | null): Promise<Source>
  /** État de chaque source : false = injoignable pour le moment. */
  sourcesAvailability(): Promise<Record<number, boolean>>
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

  metadataStatus(): Promise<MetadataStatus>
  /** Enregistre (ou efface avec `null`) la clé TheMovieDB, chiffrée par le trousseau système. */
  metadataSetKey(key: string | null): Promise<MetadataStatus>
  /** Candidats pour un média ; `query` remplace le titre deviné lors d'une correction manuelle. */
  metadataSuggest(mediaId: number, query?: string): Promise<MetadataMatch[]>
  metadataApply(mediaId: number, externalId: string): Promise<void>

  pluginsList(): Promise<PluginList>
  /** Active ou désactive une extension ; le changement prend effet immédiatement. */
  pluginsSetEnabled(id: string, enabled: boolean): Promise<PluginList>

  podcastsList(): Promise<PodcastWithCounts[]>
  podcastsEpisodes(podcastId: number): Promise<PodcastEpisode[]>
  /** S'abonne à un flux RSS et récupère ses épisodes. */
  podcastsSubscribe(feedUrl: string): Promise<PodcastRefresh>
  podcastsRefresh(podcastId: number): Promise<PodcastRefresh>
  podcastsRefreshAll(): Promise<PodcastRefresh[]>
  podcastsRemove(podcastId: number): Promise<void>
  /** Recherche dans l'annuaire public d'Apple ; renvoie directement les URL de flux. */
  podcastsSearch(term: string): Promise<PodcastSearchResult[]>

  /** Télécharge un épisode pour l'écoute hors ligne. */
  episodeDownload(episodeId: number): Promise<void>
  episodeRemoveDownload(episodeId: number): Promise<void>
  episodeProgress(episodeId: number, position: number, completed?: boolean): Promise<void>
  episodeCompleted(episodeId: number, completed: boolean): Promise<void>
  onEpisodeDownload(cb: (p: EpisodeDownload) => void): () => void

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

/**
 * Image distante (pochette d'un résultat de recherche, illustration d'un flux) servie par le
 * backend. Passer par `media://` évite d'ouvrir la politique de sécurité à tout le web.
 */
export function toImageUrl(remoteUrl: string): string {
  return `${MEDIA_SCHEME}://image/${encodeURIComponent(remoteUrl)}`
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
