import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkFfmpeg, parseProbe } from './ffmpeg'
import {
  findSidecarSubtitles,
  languageName,
  listSubtitles,
  loadSubtitleVtt,
  srtToVtt
} from './subtitles'

const status = await checkFfmpeg()
const FIX = join(__dirname, '__fixtures__')

const SRT = `1\r\n00:00:01,000 --> 00:00:02,500\r\nBonjour <i>le monde</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\nDeux\r\nlignes\r\n`

describe('srtToVtt', () => {
  it('convertit timestamps, fins de ligne et en-tête', () => {
    const vtt = srtToVtt(SRT)
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500\nBonjour <i>le monde</i>')
    expect(vtt).toContain('00:00:03.000 --> 00:00:05.000\nDeux\nlignes')
    expect(vtt).not.toContain('\r')
    expect(vtt).not.toMatch(/^\d+\n/m) // numéros de séquence retirés
  })

  it('retire le BOM', () => {
    expect(srtToVtt('\uFEFF' + SRT).startsWith('WEBVTT')).toBe(true)
  })

  it('nomme les langues courantes', () => {
    expect(languageName('fre')).toBe('Français')
    expect(languageName('xx')).toBe('xx')
    expect(languageName(null)).toBeNull()
  })
})

describe('fichiers à côté de la vidéo', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'epikodi-subs-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('détecte film.srt, film.fr.srt, film.vtt mais pas autre.srt', async () => {
    const video = join(dir, 'Mon.Film.mkv')
    await writeFile(video, '')
    await writeFile(join(dir, 'Mon.Film.srt'), SRT)
    await writeFile(join(dir, 'Mon.Film.fr.srt'), SRT)
    await writeFile(join(dir, 'Mon.Film.en.vtt'), 'WEBVTT\n')
    await writeFile(join(dir, 'Autre.srt'), SRT)
    const tracks = await findSidecarSubtitles(video)
    expect(tracks.map((t) => [t.label, t.language])).toEqual([
      ['English', 'en'],
      ['Externe', null],
      ['Français', 'fr']
    ])
    expect(tracks.every((t) => t.source === 'external')).toBe(true)
  })

  it('charge un .srt externe converti en VTT', async () => {
    const video = join(dir, 'a.mp4')
    await writeFile(join(dir, 'a.srt'), SRT)
    const [track] = await findSidecarSubtitles(video)
    const vtt = await loadSubtitleVtt(video, track)
    expect(vtt).toContain('WEBVTT')
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500')
  })
})

describe('pistes internes (mkv multi-pistes)', () => {
  it('parseProbe expose pistes audio et sous-titres texte', async () => {
    const { probe } = await import('./ffmpeg')
    if (!status.ffprobe) return
    const p = await probe(join(FIX, 'multi.mkv'))
    expect(p.audioTracks.map((t) => [t.language, t.title])).toEqual([
      ['fre', 'Français'],
      ['eng', 'English']
    ])
    expect(p.subtitleTracks).toHaveLength(1)
    expect(p.subtitleTracks[0]).toMatchObject({ codec: 'subrip', language: 'fre' })
  })

  it('ignore les sous-titres bitmap', () => {
    const p = parseProbe({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264' },
        { index: 1, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle' },
        { index: 2, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } }
      ]
    })
    expect(p.subtitleTracks.map((t) => t.index)).toEqual([2])
  })

  it.skipIf(!status.ffmpeg)('liste et extrait une piste interne en VTT', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'epikodi-subs-'))
    const video = join(dir, 'multi.mkv')
    await copyFile(join(FIX, 'multi.mkv'), video)
    await writeFile(join(dir, 'multi.en.srt'), SRT)
    const tracks = await listSubtitles(video)
    expect(tracks.map((t) => [t.source, t.label])).toEqual([
      ['internal', 'Français'],
      ['external', 'English']
    ])
    const vtt = await loadSubtitleVtt(video, tracks[0])
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('Bonjour <i>le monde</i>')
    await rm(dir, { recursive: true, force: true })
  })
})
