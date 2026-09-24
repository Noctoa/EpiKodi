import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FfmpegStatus } from '@shared/ipc'
import type { MediaMetadataInput } from '@shared/models'

const exec = promisify(execFile)

/** Chemins des binaires ; surchargeables (binaire embarqué dans l'AppImage, tests). */
export const bin = { ffprobe: 'ffprobe', ffmpeg: 'ffmpeg' }

/** Vérifie une fois que ffmpeg/ffprobe sont présents dans le PATH. */
export async function checkFfmpeg(): Promise<FfmpegStatus> {
  const status: FfmpegStatus = { ffprobe: false, ffmpeg: false, version: null }
  try {
    const { stdout } = await exec(bin.ffmpeg, ['-version'])
    status.ffmpeg = true
    status.version = /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? null
  } catch {
    /* absent */
  }
  try {
    await exec(bin.ffprobe, ['-version'])
    status.ffprobe = true
  } catch {
    /* absent */
  }
  return status
}

// ---------- ffprobe ----------

/** Sous-ensemble du JSON de `ffprobe -show_format -show_streams` qui nous intéresse. */
export interface ProbeJson {
  format?: {
    format_name?: string
    duration?: string
    bit_rate?: string
    tags?: Record<string, string>
  }
  streams?: {
    index?: number
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    disposition?: { attached_pic?: number }
    tags?: Record<string, string>
  }[]
}

/** Une piste (audio ou sous-titre) embarquée dans le conteneur. */
export interface StreamTrack {
  /** Index absolu du flux dans le fichier (pour `-map 0:<index>`) */
  index: number
  codec: string
  language: string | null
  title: string | null
}

/** Sous-titres texte que ffmpeg sait convertir en WebVTT (pas les bitmaps PGS / DVD). */
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'])

export interface ProbeResult {
  duration: number | null
  metadata: MediaMetadataInput
  /** Titre embarqué dans les tags (audio surtout) */
  title: string | null
  /** Une pochette est embarquée (flux image "attached_pic") */
  hasCover: boolean
  hasVideo: boolean
  audioTracks: StreamTrack[]
  subtitleTracks: StreamTrack[]
}

/** Les tags ffprobe ne sont pas normalisés (TITLE / title / Title…) : lecture insensible à la casse. */
function tag(tags: Record<string, string> | undefined, ...names: string[]): string | null {
  if (!tags) return null
  const lower = new Map(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]))
  for (const n of names) {
    const v = lower.get(n.toLowerCase())?.trim()
    if (v) return v
  }
  return null
}

const toInt = (v: string | null): number | null => {
  if (!v) return null
  const n = parseInt(v, 10) // "3/12" → 3
  return Number.isFinite(n) ? n : null
}

/**
 * Année de sortie depuis un tag `date` : les formats rencontrés vont de « 1997 » à
 * « 2019-05-01 » en passant par « 20260920 » (date d'upload YouTube, à ne pas lire comme
 * un entier). On retient le premier groupe de 4 chiffres qui ressemble à une année.
 */
export function toYear(v: string | null): number | null {
  if (!v) return null
  const max = new Date().getFullYear() + 1
  for (const [digits] of v.matchAll(/\d{4}/g)) {
    const year = Number(digits)
    if (year >= 1800 && year <= max) return year
  }
  return null
}

/** Transforme le JSON brut de ffprobe en métadonnées exploitables. Pure, testée. */
export function parseProbe(json: ProbeJson): ProbeResult {
  const streams = json.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find((s) => s.codec_type === 'audio')
  const cover = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic === 1)
  const tags = json.format?.tags
  const duration = json.format?.duration ? parseFloat(json.format.duration) : null

  const track = (s: NonNullable<ProbeJson['streams']>[number]): StreamTrack => ({
    index: s.index ?? 0,
    codec: s.codec_name ?? '',
    language: tag(s.tags, 'language'),
    title: tag(s.tags, 'title')
  })

  return {
    duration: duration && Number.isFinite(duration) ? duration : null,
    title: tag(tags, 'title'),
    hasCover: Boolean(cover),
    hasVideo: Boolean(video),
    audioTracks: streams.filter((s) => s.codec_type === 'audio').map(track),
    subtitleTracks: streams
      .filter((s) => s.codec_type === 'subtitle' && TEXT_SUBTITLE_CODECS.has(s.codec_name ?? ''))
      .map(track),
    metadata: {
      // "mov,mp4,m4a,3gp,3g2,mj2" → "mp4" : on garde le nom le plus parlant
      container: json.format?.format_name?.split(',').find((n) => n !== 'mov') ?? null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      bitrate: toInt(json.format?.bit_rate ?? null),
      artist: tag(tags, 'artist', 'ARTIST'),
      album: tag(tags, 'album'),
      albumArtist: tag(tags, 'album_artist', 'albumartist'),
      year: toYear(tag(tags, 'date', 'year', 'TDRC')),
      track: toInt(tag(tags, 'track', 'tracknumber')),
      genre: tag(tags, 'genre')
    }
  }
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await exec(
    bin.ffprobe,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
    { maxBuffer: 4 * 1024 * 1024 }
  )
  return parseProbe(JSON.parse(stdout) as ProbeJson)
}

/** Lance ffmpeg et renvoie sa sortie standard (texte). */
export async function ffmpegToString(args: string[]): Promise<string> {
  const { stdout } = await exec(bin.ffmpeg, ['-v', 'error', ...args], {
    maxBuffer: 16 * 1024 * 1024
  })
  return stdout
}

// ---------- images ----------

const THUMB_WIDTH = 480

/** Miniature d'une vidéo, prise à ~10 % de la durée (évite les génériques noirs). */
export async function videoThumbnail(
  file: string,
  out: string,
  duration: number | null
): Promise<void> {
  const at = duration ? Math.min(duration * 0.1, 300) : 5
  await exec(bin.ffmpeg, [
    '-y',
    '-v',
    'error',
    '-ss',
    at.toFixed(2),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    `scale=${THUMB_WIDTH}:-2`,
    '-q:v',
    '4',
    out
  ])
}

/** Pochette embarquée d'un fichier audio (flux "attached_pic"). */
export async function extractCover(file: string, out: string): Promise<void> {
  await exec(bin.ffmpeg, [
    '-y',
    '-v',
    'error',
    '-i',
    file,
    '-an',
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    '-vf',
    `scale='min(${THUMB_WIDTH},iw)':-2`,
    '-q:v',
    '4',
    out
  ])
}
