import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mediaFixtures } from './__fixtures__/media'
import { checkFfmpeg, parseProbe, probe, type ProbeJson } from './ffmpeg'

const fixture = (name: string): ProbeJson =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as ProbeJson

describe('parseProbe', () => {
  it('extrait codecs, résolution et durée d’une vidéo mp4', () => {
    const r = parseProbe(fixture('ffprobe-mp4.json'))
    expect(r.hasVideo).toBe(true)
    expect(r.hasCover).toBe(false)
    expect(r.duration).toBeCloseTo(6, 0)
    expect(r.metadata).toMatchObject({
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 640,
      height: 360
    })
    expect(r.metadata.bitrate).toBeGreaterThan(0)
  })

  it('extrait les tags ID3 et détecte la pochette d’un mp3', () => {
    const r = parseProbe(fixture('ffprobe-mp3.json'))
    expect(r.hasVideo).toBe(false) // le flux mjpeg "attached_pic" n'est pas une vidéo
    expect(r.hasCover).toBe(true)
    expect(r.title).toBe('Around the World')
    expect(r.metadata).toMatchObject({
      audioCodec: 'mp3',
      videoCodec: null,
      artist: 'Daft Punk',
      album: 'Homework',
      year: 1997,
      track: 7,
      genre: 'House'
    })
  })

  it('tolère les tags en majuscules et les formats de date/piste variés', () => {
    const r = parseProbe({
      format: {
        format_name: 'flac',
        duration: '10.5',
        tags: { TITLE: 'x', ARTIST: 'y', DATE: '2020-03-01', TRACKNUMBER: '3/12' }
      },
      streams: [{ codec_type: 'audio', codec_name: 'flac' }]
    })
    expect(r.title).toBe('x')
    expect(r.metadata.artist).toBe('y')
    expect(r.metadata.year).toBe(2020)
    expect(r.metadata.track).toBe(3)
  })

  it('lit l’année quel que soit le format de date', () => {
    const year = (date: string): number | null =>
      parseProbe({ format: { tags: { date } }, streams: [] }).metadata.year ?? null
    expect(year('1997')).toBe(1997)
    expect(year('2019-05-01')).toBe(2019)
    expect(year('20260920')).toBe(2026) // date d'upload YouTube
    expect(year('01/02/2019')).toBe(2019)
    expect(year('inconnu')).toBeNull()
    expect(year('0000')).toBeNull()
  })

  it('ne plante pas sur un JSON vide', () => {
    const r = parseProbe({})
    expect(r.duration).toBeNull()
    expect(r.metadata.videoCodec).toBeNull()
  })
})

describe('ffprobe réel', async () => {
  const status = await checkFfmpeg()
  const fixtures = status.ffmpeg ? await mediaFixtures() : null

  it.skipIf(!status.ffprobe || !fixtures)('analyse un vrai fichier', async () => {
    const r = await probe(fixtures!.taggedMp3)
    expect(r.metadata.artist).toBe('Daft Punk')
    expect(r.duration).toBeCloseTo(3, 0)
  })

  it.skipIf(!status.ffprobe)('rejette un fichier corrompu', async () => {
    await expect(probe(join(__dirname, '__fixtures__', 'ffprobe-mp3.json'))).rejects.toThrow()
  })
})
