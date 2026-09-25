import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { PlaybackPlan } from './compat'
import { bin } from './ffmpeg'

const exec = promisify(execFile)

/**
 * Codecs qu'un MP4 fragmenté peut transporter tels quels. Un flux lisible par Chromium mais
 * inacceptable en MP4 (vorbis, pcm…) doit être ré-encodé même si le plan autorisait la recopie.
 */
const MP4_VIDEO = new Set(['h264', 'hevc', 'av1', 'vp9'])
const MP4_AUDIO = new Set(['aac', 'mp3', 'opus'])

export interface HwEncoder {
  /** Nom affichable : « nvenc », « vaapi (/dev/dri/renderD129) »… */
  label: string
  /** Arguments placés avant `-i` (initialisation du périphérique) */
  init: string[]
  encoder: string
  /** Filtre imposé par l'API matérielle */
  filter?: string
}

export interface StreamOptions {
  input: string
  plan: PlaybackPlan
  videoCodec: string | null
  audioCodec: string | null
  /** Position de départ en secondes ; le seek en mode transcodé relance ffmpeg ici */
  seek: number
  hw: HwEncoder | null
}

/**
 * Arguments ffmpeg produisant un MP4 fragmenté sur la sortie standard : le seul format que
 * `<video>` accepte en flux continu, sans connaître la taille à l'avance. Pure, testée.
 */
export function buildArgs(o: StreamOptions): string[] {
  const copyVideo = o.plan.videoCopy && MP4_VIDEO.has(o.videoCodec ?? '')
  const copyAudio = o.plan.audioCopy && MP4_AUDIO.has(o.audioCodec ?? '')
  const useHw = !copyVideo && o.hw !== null

  const args = ['-hide_banner', '-loglevel', 'error']
  if (useHw) args.push(...o.hw!.init)
  // `-ss` avant `-i` : ffmpeg saute directement à l'image clé, sans décoder ce qui précède
  if (o.seek > 0) args.push('-ss', o.seek.toFixed(3))
  args.push('-i', o.input, '-map', '0:v:0?', '-map', '0:a:0?')

  if (copyVideo) {
    args.push('-c:v', 'copy')
  } else if (useHw) {
    if (o.hw!.filter) args.push('-vf', o.hw!.filter)
    args.push('-c:v', o.hw!.encoder, '-b:v', '4M')
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')
  }

  args.push(...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']))

  // `empty_moov` permet de commencer à écrire sans connaître la durée ; `frag_keyframe` découpe
  // en fragments lisibles au fil de l'eau.
  args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1')
  return args
}

/** Candidats matériels, du plus rapide au plus universel. */
async function candidates(): Promise<HwEncoder[]> {
  const list: HwEncoder[] = [
    { label: 'nvenc', init: [], encoder: 'h264_nvenc' },
    { label: 'qsv', init: [], encoder: 'h264_qsv' }
  ]
  let devices: string[] = []
  try {
    devices = (await readdir('/dev/dri')).filter((d) => d.startsWith('renderD'))
  } catch {
    /* pas de GPU exposé */
  }
  for (const d of devices) {
    list.push({
      label: `vaapi (/dev/dri/${d})`,
      init: ['-vaapi_device', `/dev/dri/${d}`],
      encoder: 'h264_vaapi',
      filter: 'format=nv12,hwupload'
    })
  }
  return list
}

let detected: Promise<HwEncoder | null> | null = null

/**
 * L'encodeur matériel se teste, il ne se déduit pas : `ffmpeg -encoders` liste h264_vaapi même
 * quand le pilote refuse d'encoder. On lance donc un encodage d'une seconde sur chaque candidat
 * et on retient le premier qui aboutit. Le repli logiciel (libx264) marche toujours.
 */
export function detectHwEncoder(): Promise<HwEncoder | null> {
  detected ??= (async () => {
    for (const hw of await candidates()) {
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        ...hw.init,
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x180:rate=25',
        '-t',
        '1',
        ...(hw.filter ? ['-vf', hw.filter] : []),
        '-c:v',
        hw.encoder,
        '-f',
        'null',
        '-'
      ]
      try {
        await exec(bin.ffmpeg, args, { timeout: 15_000 })
        console.log(`[transcode] encodeur matériel : ${hw.label}`)
        return hw
      } catch {
        /* candidat suivant */
      }
    }
    console.log('[transcode] aucun encodeur matériel utilisable, repli sur libx264')
    return null
  })()
  return detected
}

/** Process ffmpeg en cours, pour pouvoir tout arrêter à la fermeture de l'application. */
type FfmpegProcess = ChildProcessByStdio<null, Readable, Readable>

const running = new Set<FfmpegProcess>()

export interface Stream {
  stdout: NodeJS.ReadableStream
  stop: () => void
}

export function startStream(options: StreamOptions): Stream {
  const args = buildArgs(options)
  const child = spawn(bin.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  running.add(child)

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.on('close', (code) => {
    running.delete(child)
    // 255 = arrêt demandé par nous (seek, fenêtre fermée), ce n'est pas une erreur
    if (code !== 0 && code !== null && code !== 255 && stderr.trim()) {
      console.warn(`[transcode] ffmpeg (${code}) : ${stderr.trim().split('\n')[0]}`)
    }
  })

  const stop = (): void => {
    if (!child.killed) child.kill('SIGKILL')
    running.delete(child)
  }
  return { stdout: child.stdout, stop }
}

export function stopAllStreams(): void {
  for (const child of running) child.kill('SIGKILL')
  running.clear()
}
