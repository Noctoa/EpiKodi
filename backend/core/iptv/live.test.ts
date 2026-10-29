import { describe, expect, it } from 'vitest'
import type { HwEncoder } from '../transcode'
import { buildLiveArgs, describeLiveError, parseStreams, type LiveSource } from './live'

const source: LiveSource = { url: 'https://flux.example/tf1.m3u8', userAgent: null, referrer: null }

/** Valeur de l'option `flag` dans la ligne de commande produite. */
const valueOf = (args: string[], flag: string): string | undefined =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined

const vaapi: HwEncoder = {
  label: 'vaapi',
  init: ['-vaapi_device', '/dev/dri/renderD129'],
  encoder: 'h264_vaapi',
  filter: 'format=nv12,hwupload'
}

/** Bilans d'ouverture relevés sur de vraies chaînes de la liste iptv-org (voir docs/iptv.md). */
const HLS_EAC3 = `Input #0, hls, from 'http://149.62.177.107:9999/6ter/index.m3u8':
  Duration: N/A, start: 71072.334156, bitrate: N/A
  Program 0
    Stream #0:0[0x0]: Video: h264 (High) ([27][0][0][0] / 0x001B), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 50 fps
    Stream #0:1[0x0](fra): Audio: eac3 ([135][0][0][0] / 0x0087), 48000 Hz, stereo, fltp, 192 kb/s
Stream mapping:
  Stream #0:0 -> #0:0 (copy)
  Stream #0:1 -> #0:1 (eac3 (native) -> aac (native))
Output #0, mp4, to 'pipe:1':
    Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080
    Stream #0:1(fra): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 160 kb/s
`

const HLS_VARIANTS = `Input #0, hls, from 'https://jmp2.uk/plu-5f8ed168f72fcd0007e56269.m3u8':
    Stream #0:0[0x0]: Data: timed_id3 (ID3  / 0x20334449)
    Stream #0:1: Video: h264 (Main), yuv420p, 640x360
    Stream #0:2: Audio: aac (LC), 48000 Hz, stereo, fltp
    Stream #0:7: Video: h264 (High), yuv420p, 1920x1080
Stream mapping:
  Stream #0:7 -> #0:0 (copy)
  Stream #0:2 -> #0:1 (aac (native) -> aac (native))
Output #0, mp4, to 'pipe:1':
    Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080
`

describe('buildLiveArgs', () => {
  it('recopie la vidéo, ré-encode le son et produit un MP4 fragmenté', () => {
    const args = buildLiveArgs(source, { copy: true })
    expect(valueOf(args, '-i')).toBe(source.url)
    expect(valueOf(args, '-c:v')).toBe('copy')
    expect(valueOf(args, '-c:a')).toBe('aac')
    expect(args.slice(-3)).toEqual(['-f', 'mp4', 'pipe:1'])
  })

  it('n’autorise que les protocoles réseau', () => {
    const allowed = valueOf(buildLiveArgs(source, { copy: true }), '-protocol_whitelist')
    expect(allowed?.split(',')).not.toContain('file')
    expect(allowed?.split(',')).toContain('https')
  })

  it('place les options d’entrée avant -i', () => {
    const args = buildLiveArgs(
      { ...source, userAgent: 'Mozilla/5.0', referrer: 'https://site.example/' },
      { copy: true }
    )
    const input = args.indexOf('-i')
    for (const flag of ['-user_agent', '-referer', '-reconnect', '-protocol_whitelist']) {
      expect(args.indexOf(flag)).toBeGreaterThan(-1)
      expect(args.indexOf(flag)).toBeLessThan(input)
    }
    expect(valueOf(args, '-user_agent')).toBe('Mozilla/5.0')
  })

  it('n’envoie pas d’en-tête que la playlist ne demande pas', () => {
    const args = buildLiveArgs(source, { copy: true })
    expect(args).not.toContain('-user_agent')
    expect(args).not.toContain('-referer')
  })

  it('ré-encode sur l’encodeur matériel, initialisé avant -i', () => {
    const args = buildLiveArgs(source, { copy: false, hw: vaapi })
    expect(valueOf(args, '-c:v')).toBe('h264_vaapi')
    expect(args.indexOf('-vaapi_device')).toBeLessThan(args.indexOf('-i'))
  })

  it('ré-encode en logiciel faute de mieux', () => {
    expect(valueOf(buildLiveArgs(source, { copy: false, hw: null }), '-c:v')).toBe('libx264')
  })
})

describe('parseStreams', () => {
  it('lit les codecs des flux d’entrée retenus', () => {
    expect(parseStreams(HLS_EAC3)).toEqual({ video: 'h264', audio: 'eac3' })
  })

  it('suit la table de correspondance plutôt que l’ordre des flux', () => {
    // Le premier flux vidéo listé est la variante basse ; ffmpeg a retenu la HD, en #0:7
    const streams = parseStreams(HLS_VARIANTS.replace('#0:7: Video: h264', '#0:7: Video: hevc'))
    expect(streams.video).toBe('hevc')
  })

  it('ne confond pas les flux de sortie avec ceux d’entrée', () => {
    const mpeg2 = HLS_EAC3.replace(
      'Stream #0:0[0x0]: Video: h264 (High)',
      'Stream #0:0[0x0]: Video: mpeg2video (Main)'
    )
    expect(parseStreams(mpeg2).video).toBe('mpeg2video')
  })

  it('reconnaît une radio, sans vidéo', () => {
    const radio = `    Stream #0:0: Audio: mp3, 44100 Hz\nStream mapping:\n  Stream #0:0 -> #0:0 (mp3 (mp3float) -> aac (native))\n`
    expect(parseStreams(radio)).toEqual({ video: null, audio: 'mp3' })
  })

  it('ne devine rien tant que le bilan n’est pas écrit', () => {
    expect(parseStreams('    Stream #0:0: Video: h264')).toEqual({ video: null, audio: null })
  })
})

describe('describeLiveError', () => {
  const opening = (cause: string): string =>
    `[in#0 @ 0x5611] Error opening input: ${cause}\nError opening input files: ${cause}\n`

  it('traduit les refus d’accès, même quand ffmpeg les nomme autrement', () => {
    expect(describeLiveError(opening('Server returned 403 Forbidden (access denied)'))).toMatch(
      /accès refusé/
    )
    expect(
      describeLiveError('[https @ 0x56] HTTP error 452 Unavailable For Legal Reasons')
    ).toMatch(/accès refusé/)
  })

  it('distingue un flux disparu d’un serveur absent', () => {
    expect(describeLiveError(opening('Server returned 404 Not Found'))).toMatch(/introuvable/)
    expect(
      describeLiveError(
        '[tcp @ 0x56] Failed to resolve hostname nexiste.invalid: Name or service not known\n' +
          opening('Input/output error')
      )
    ).toMatch(/adresse du serveur inconnue/)
    expect(describeLiveError(opening('Connection refused'))).toMatch(/injoignable/)
  })

  it('ne lit pas un code HTTP dans l’URL citée', () => {
    const message = describeLiveError(
      'Error opening input file http://145.239.5.177/403/index.m3u8.\n' +
        opening('Invalid data found when processing input')
    )
    expect(message).toMatch(/pas une vidéo lisible/)
  })

  it('reconnaît une panne côté serveur', () => {
    expect(describeLiveError('[https @ 0x56] HTTP error 503 Service Unavailable')).toMatch(/panne/)
  })

  it('retombe sur la dernière ligne d’erreur, sinon sur le message par défaut', () => {
    expect(describeLiveError('[hls @ 0x1] Error when loading first segment')).toBe(
      'Error when loading first segment'
    )
    expect(describeLiveError('Stream mapping:', 'muet')).toBe('muet')
  })
})
