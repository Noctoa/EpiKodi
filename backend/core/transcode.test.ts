import { describe, expect, it } from 'vitest'
import { planPlayback } from './compat'
import { buildArgs, type HwEncoder, type StreamOptions } from './transcode'
import type { ProbeResult } from './ffmpeg'

const probe = (container: string, video: string | null, audio: string | null): ProbeResult => ({
  duration: 60,
  title: null,
  hasCover: false,
  hasVideo: video !== null,
  audioTracks: [],
  subtitleTracks: [],
  metadata: { container, videoCodec: video, audioCodec: audio }
})

const opts = (
  container: string,
  video: string | null,
  audio: string | null,
  extra: Partial<StreamOptions> = {}
): StreamOptions => ({
  input: '/films/a.mkv',
  plan: planPlayback(probe(container, video, audio)),
  videoCodec: video,
  audioCodec: audio,
  seek: 0,
  hw: null,
  ...extra
})

/** Valeur de l'option `flag` dans la ligne de commande produite. */
const valueOf = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

const vaapi: HwEncoder = {
  label: 'vaapi',
  init: ['-vaapi_device', '/dev/dri/renderD129'],
  encoder: 'h264_vaapi',
  filter: 'format=nv12,hwupload'
}

describe('buildArgs', () => {
  it('produit un MP4 fragmenté sur la sortie standard', () => {
    const args = buildArgs(opts('avi', 'h264', 'aac'))
    expect(args.slice(-5)).toEqual([
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      'pipe:1'
    ])
  })

  it('remux : recopie les deux flux, aucun encodeur', () => {
    const args = buildArgs(opts('avi', 'h264', 'aac'))
    expect(valueOf(args, '-c:v')).toBe('copy')
    expect(valueOf(args, '-c:a')).toBe('copy')
    expect(args).not.toContain('libx264')
  })

  it('ré-encode la vidéo seule et recopie l’audio', () => {
    const args = buildArgs(opts('matroska', 'mpeg4', 'mp3'))
    expect(valueOf(args, '-c:v')).toBe('libx264')
    expect(valueOf(args, '-c:a')).toBe('copy')
  })

  it('ré-encode l’audio seul et recopie la vidéo', () => {
    const args = buildArgs(opts('matroska', 'h264', 'ac3'))
    expect(valueOf(args, '-c:v')).toBe('copy')
    expect(valueOf(args, '-c:a')).toBe('aac')
  })

  it('ré-encode un flux que le MP4 ne peut pas transporter, même lisible par Chromium', () => {
    // vorbis se lit dans un webm mais n'a pas sa place dans un MP4 fragmenté
    const args = buildArgs(opts('avi', 'h264', 'vorbis'))
    expect(valueOf(args, '-c:a')).toBe('aac')
    expect(valueOf(args, '-c:v')).toBe('copy')
  })

  it('utilise l’encodeur matériel quand la vidéo doit être ré-encodée', () => {
    const args = buildArgs(opts('avi', 'mpeg4', 'aac', { hw: vaapi }))
    expect(args.slice(0, 6)).toContain('-vaapi_device')
    expect(valueOf(args, '-c:v')).toBe('h264_vaapi')
    expect(valueOf(args, '-vf')).toBe('format=nv12,hwupload')
  })

  it('n’initialise pas le matériel quand la vidéo est simplement recopiée', () => {
    const args = buildArgs(opts('avi', 'h264', 'aac', { hw: vaapi }))
    expect(args).not.toContain('-vaapi_device')
    expect(args).not.toContain('h264_vaapi')
  })

  it('place -ss avant -i pour un saut rapide sur image clé', () => {
    const args = buildArgs(opts('avi', 'mpeg4', 'ac3', { seek: 42.5 }))
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(valueOf(args, '-ss')).toBe('42.500')
  })

  it('omet -ss au démarrage', () => {
    expect(buildArgs(opts('avi', 'h264', 'aac'))).not.toContain('-ss')
  })

  it('rend les pistes optionnelles : un fichier sans audio ne fait pas échouer ffmpeg', () => {
    const args = buildArgs(opts('avi', 'h264', null))
    expect(args).toContain('0:v:0?')
    expect(args).toContain('0:a:0?')
  })
})
