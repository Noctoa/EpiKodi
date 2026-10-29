import { describe, expect, it } from 'vitest'
import { parseVariants } from './hls'

describe('parseVariants', () => {
  it('lit les variantes d’une playlist maître, dans leur ordre', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=2111272,CODECS="avc1.42001f,mp4a.40.2",RESOLUTION=1280x720',
      'chunklist_720.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=640930,RESOLUTION=426x240',
      'chunklist_240.m3u8'
    ].join('\n')
    expect(parseVariants(master)).toEqual([
      { index: 0, bandwidth: 2111272, height: 720 },
      { index: 1, bandwidth: 640930, height: 240 }
    ])
  })

  it('ne se laisse pas tromper par une virgule entre guillemets', () => {
    // CODECS contient une virgule : un découpage naïf perdrait la résolution qui suit
    const [v] = parseVariants('#EXT-X-STREAM-INF:CODECS="avc1,mp4a",RESOLUTION=1920x1080\nhd.m3u8')
    expect(v.height).toBe(1080)
  })

  it('garde une variante dont la résolution n’est pas annoncée', () => {
    // Pluto TV : débit seul, comme relevé sur une vraie playlist
    const [v] = parseVariants(
      '#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1042180,SUBTITLES="subs"\n1042180/p.m3u8'
    )
    expect(v).toEqual({ index: 0, bandwidth: 1042180, height: null })
  })

  it('ne trouve rien dans une playlist de segments', () => {
    expect(parseVariants('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n')).toEqual([])
  })
})
