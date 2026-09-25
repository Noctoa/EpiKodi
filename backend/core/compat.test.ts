import { describe, expect, it } from 'vitest'
import { planPlayback } from './compat'
import type { ProbeResult } from './ffmpeg'

const probe = (
  container: string | null,
  videoCodec: string | null,
  audioCodec: string | null
): ProbeResult => ({
  duration: 120,
  title: null,
  hasCover: false,
  hasVideo: videoCodec !== null,
  audioTracks: [],
  subtitleTracks: [],
  metadata: { container, videoCodec, audioCodec }
})

describe('planPlayback', () => {
  it('laisse passer ce que Chromium lit nativement', () => {
    for (const p of [
      probe('mp4', 'h264', 'aac'),
      probe('matroska', 'h264', 'aac'),
      probe('matroska', 'hevc', 'aac'),
      probe('webm', 'vp9', 'opus'),
      probe('mp4', 'av1', 'opus'),
      probe('mp3', null, 'mp3'),
      probe('wav', null, 'pcm_s16le')
    ]) {
      expect(planPlayback(p)).toMatchObject({ mode: 'direct', videoCopy: true, audioCopy: true })
    }
  })

  it('remuxe quand seul le conteneur pose problème (aucun ré-encodage)', () => {
    const plan = planPlayback(probe('avi', 'h264', 'aac'))
    expect(plan).toMatchObject({ mode: 'remux', videoCopy: true, audioCopy: true })
    expect(plan.reason).toContain('avi')
  })

  it('ré-encode la vidéo seule quand le codec vidéo est illisible', () => {
    const plan = planPlayback(probe('matroska', 'mpeg4', 'mp3'))
    expect(plan).toMatchObject({ mode: 'transcode', videoCopy: false, audioCopy: true })
    expect(plan.reason).toContain('mpeg4')
  })

  it('ré-encode l’audio seul quand le codec audio est illisible', () => {
    const plan = planPlayback(probe('matroska', 'h264', 'ac3'))
    expect(plan).toMatchObject({ mode: 'transcode', videoCopy: true, audioCopy: false })
    expect(plan.reason).toContain('ac3')
  })

  it('ré-encode les deux flux d’un vieux avi', () => {
    const plan = planPlayback(probe('avi', 'mpeg4', 'ac3'))
    expect(plan).toMatchObject({ mode: 'transcode', videoCopy: false, audioCopy: false })
    expect(plan.reason).toContain('mpeg4')
    expect(plan.reason).toContain('ac3')
  })

  it('ignore le flux absent plutôt que de le déclarer illisible', () => {
    expect(planPlayback(probe('matroska', 'h264', null)).mode).toBe('direct')
    expect(planPlayback(probe('mp4', null, 'aac')).mode).toBe('direct')
  })

  it('conserve la durée pour le lecteur (indispensable en mode transcodé)', () => {
    expect(planPlayback(probe('avi', 'mpeg4', 'mp3')).duration).toBe(120)
  })
})
