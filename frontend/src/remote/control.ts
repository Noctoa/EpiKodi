import type { RemoteSource } from '@shared/remote'

/**
 * Vue uniforme d'un lecteur pour la télécommande. Deux lecteurs coexistent dans l'application —
 * la vidéo plein cadre et la file audio — et la télécommande ne veut pas le savoir.
 */
export interface MediaSnapshot {
  playing: boolean
  title: string | null
  subtitle: string | null
  position: number
  duration: number
  volume: number
  muted: boolean
}

export interface MediaControl {
  source: Exclude<RemoteSource, 'none'>
  /** Lu à la demande (une fois par seconde) : la position ne déclenche pas de rendu React */
  snapshot(): MediaSnapshot
  toggle(): void
  play(): void
  pause(): void
  /** Quitte la lecture : ferme le lecteur vidéo, vide la file audio */
  stop(): void
  seekTo(position: number): void
  seekBy(delta: number): void
  setVolume(value: number): void
  toggleMute(): void
  /** Absent quand il n'y a pas de file : une vidéo seule n'a pas de piste suivante */
  next?(): void
  prev?(): void
}

/**
 * Le lecteur vidéo s'enregistre ici à son montage, et a la priorité sur l'audio : c'est lui qui
 * occupe l'écran. Volontairement hors de React — la télécommande interroge l'état par scrutation,
 * sans abonner quoi que ce soit au temps de lecture.
 */
let video: MediaControl | null = null

export function setVideoControl(control: MediaControl | null): void {
  video = control
}

export function videoControl(): MediaControl | null {
  return video
}
