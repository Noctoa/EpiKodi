/** Contrat IPC partagé entre main, preload et renderer. */

export const IPC = {
  openMediaDialog: 'dialog:open-media',
  mediaOpened: 'media:opened'
} as const

export interface OpenedMedia {
  /** Chemin absolu sur le disque */
  path: string
  /** Nom de fichier affichable */
  name: string
  /** URL `media://` consommable par <video> / <audio> */
  url: string
}

export interface EpiKodiApi {
  openMediaDialog(): Promise<OpenedMedia | null>
  /** Média ouvert depuis l'extérieur (ligne de commande, "ouvrir avec"). Retourne un désabonnement. */
  onMediaOpened(cb: (media: OpenedMedia) => void): () => void
}

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ogv']
export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'ogg', 'oga', 'm4a', 'wav', 'aac', 'opus']
