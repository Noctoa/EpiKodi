import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { SubtitleTrack } from '@shared/ipc'
import { ffmpegToString, probe } from './ffmpeg'

/** Noms de langue affichables pour les codes les plus courants (ISO 639-2 / 639-1). */
const LANG_NAMES: Record<string, string> = {
  fre: 'Français',
  fra: 'Français',
  fr: 'Français',
  eng: 'English',
  en: 'English',
  spa: 'Español',
  es: 'Español',
  ger: 'Deutsch',
  deu: 'Deutsch',
  de: 'Deutsch',
  ita: 'Italiano',
  it: 'Italiano',
  jpn: '日本語',
  ja: '日本語',
  por: 'Português',
  pt: 'Português',
  und: 'Inconnu'
}

export const languageName = (code: string | null): string | null =>
  code ? (LANG_NAMES[code.toLowerCase()] ?? code) : null

/**
 * SRT → WebVTT : en-tête, virgules → points dans les timestamps, on garde les balises <i>/<b>
 * que WebVTT comprend. Pure, testée.
 */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    // Les numéros de séquence seuls sur une ligne sont facultatifs en VTT ; on les enlève
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3} -->)/gm, '')
    .trim()
  return `WEBVTT\n\n${body}\n`
}

const EXTERNAL_EXT: Record<string, 'srt' | 'vtt' | 'ffmpeg'> = {
  '.srt': 'srt',
  '.vtt': 'vtt',
  '.ass': 'ffmpeg',
  '.ssa': 'ffmpeg',
  '.sub': 'ffmpeg'
}

/**
 * Fichiers de sous-titres à côté de la vidéo : `film.srt`, `film.fr.srt`, `film.forced.vtt`…
 * Le suffixe entre le nom et l'extension sert de label (souvent la langue).
 */
export async function findSidecarSubtitles(videoPath: string): Promise<SubtitleTrack[]> {
  const dir = dirname(videoPath)
  const stem = basename(videoPath, extname(videoPath))
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const tracks: SubtitleTrack[] = []
  for (const name of entries) {
    const ext = extname(name).toLowerCase()
    if (!(ext in EXTERNAL_EXT) || !name.startsWith(stem)) continue
    const suffix = name.slice(stem.length, name.length - ext.length).replace(/^[._-]/, '')
    const lang = suffix.split(/[._-]/)[0] || null
    tracks.push({
      id: `ext:${name}`,
      label: languageName(lang) ?? (suffix || 'Externe'),
      language: lang,
      source: 'external',
      path: join(dir, name)
    })
  }
  return tracks.sort((a, b) => a.label.localeCompare(b.label))
}

/** Pistes internes (ffprobe) + fichiers externes, pour le menu du lecteur. */
export async function listSubtitles(videoPath: string): Promise<SubtitleTrack[]> {
  const external = await findSidecarSubtitles(videoPath)
  let internal: SubtitleTrack[] = []
  try {
    const p = await probe(videoPath)
    internal = p.subtitleTracks.map((t, i) => ({
      id: `int:${t.index}`,
      label: t.title ?? languageName(t.language) ?? `Piste ${i + 1}`,
      language: t.language,
      source: 'internal',
      streamIndex: t.index
    }))
  } catch {
    /* fichier illisible par ffprobe : on ne propose que les externes */
  }
  return [...internal, ...external]
}

/** Contenu WebVTT d'une piste, prêt pour `<track src>`. */
export async function loadSubtitleVtt(videoPath: string, track: SubtitleTrack): Promise<string> {
  if (track.source === 'internal') {
    return ffmpegToString([
      '-i',
      videoPath,
      '-map',
      `0:${track.streamIndex}`,
      '-f',
      'webvtt',
      'pipe:1'
    ])
  }
  const kind = EXTERNAL_EXT[extname(track.path!).toLowerCase()]
  if (kind === 'vtt') return readFile(track.path!, 'utf8')
  if (kind === 'srt') return srtToVtt(await readFile(track.path!, 'latin1').then(fixEncoding))
  return ffmpegToString(['-i', track.path!, '-f', 'webvtt', 'pipe:1'])
}

/** Les .srt sont souvent en latin-1 ou en UTF-8 sans BOM : on tente UTF-8 d'abord. */
function fixEncoding(latin1: string): string {
  const bytes = Buffer.from(latin1, 'latin1')
  const utf8 = bytes.toString('utf8')
  return utf8.includes('�') ? latin1 : utf8
}
