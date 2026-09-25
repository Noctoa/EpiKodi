import type { ProbeResult } from './ffmpeg'

/**
 * Ce que Chromium (embarqué dans Electron) sait réellement lire, établi en testant une matrice
 * conteneur × codec dans l'application : voir docs/transcoding.md. Les absents notables sont
 * l'AVI (rejeté au démultiplexage), le MPEG-4 part 2 (mpeg4/xvid) et l'AC3/DTS.
 */
const CONTAINERS = new Set(['mp4', 'matroska', 'webm', 'ogg', 'mp3', 'flac', 'wav'])
const VIDEO_CODECS = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1'])
const AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])

const isPcm = (codec: string): boolean => codec.startsWith('pcm_')

export type PlaybackMode = 'direct' | 'remux' | 'transcode'

export interface PlaybackPlan {
  mode: PlaybackMode
  /** Flux vidéo recopié tel quel plutôt que ré-encodé */
  videoCopy: boolean
  audioCopy: boolean
  /** Explication affichable et journalisable */
  reason: string
  duration: number | null
}

export const supportsContainer = (c: string | null): boolean => CONTAINERS.has(c ?? '')
export const supportsVideo = (c: string | null): boolean => VIDEO_CODECS.has(c ?? '')
export const supportsAudio = (c: string | null): boolean =>
  AUDIO_CODECS.has(c ?? '') || isPcm(c ?? '')

/**
 * Décide comment servir un média au lecteur :
 * - `direct` : le fichier est envoyé tel quel (seek natif, coût nul) ;
 * - `remux` : les flux sont recopiés dans un MP4 fragmenté, sans ré-encodage (coût quasi nul) ;
 * - `transcode` : seuls les flux illisibles sont ré-encodés, les autres sont recopiés.
 */
export function planPlayback(probe: ProbeResult): PlaybackPlan {
  const { container, videoCodec, audioCodec } = probe.metadata
  const hasVideo = probe.hasVideo
  const hasAudio = Boolean(audioCodec)

  const containerOk = supportsContainer(container ?? null)
  const videoOk = !hasVideo || supportsVideo(videoCodec ?? null)
  const audioOk = !hasAudio || supportsAudio(audioCodec ?? null)

  const plan = (mode: PlaybackMode, reason: string): PlaybackPlan => ({
    mode,
    videoCopy: videoOk,
    audioCopy: audioOk,
    reason,
    duration: probe.duration
  })

  if (containerOk && videoOk && audioOk) return plan('direct', 'lecture native')
  if (videoOk && audioOk) return plan('remux', `conteneur ${container} non supporté → remux`)

  const broken = [
    !videoOk ? `vidéo ${videoCodec}` : null,
    !audioOk ? `audio ${audioCodec}` : null
  ].filter(Boolean)
  return plan('transcode', `${broken.join(' et ')} non supporté(s) → ré-encodage`)
}
