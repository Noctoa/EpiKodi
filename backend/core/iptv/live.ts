import { PassThrough, type Readable } from 'node:stream'
import {
  detectHwEncoder,
  FRAGMENTED_MP4,
  MP4_VIDEO,
  spawnFfmpeg,
  videoEncodeArgs,
  type HwEncoder
} from '../transcode'

/**
 * Lecture des chaînes en direct. ffmpeg lit le flux — HLS ou MPEG-TS sur HTTP — et le remuxe en
 * MP4 fragmenté, le format que `<video>` lit déjà pour les fichiers transcodés. La mesure qui a
 * fait préférer cette voie à hls.js est dans docs/iptv.md.
 */

/** Passé ce délai sans une image, la chaîne est déclarée muette : un message vaut mieux qu'un écran noir. */
const STARTUP_TIMEOUT_MS = 15_000

/** Le bilan d'ouverture d'ffmpeg tient en quelques kilo-octets ; du reste, on ne garde que la fin. */
const MAX_STDERR = 32 * 1024

/**
 * Protocoles qu'ffmpeg a le droit d'ouvrir. Une playlist HLS désigne elle-même ses segments :
 * sans liste blanche, elle pourrait y glisser un `file:` et faire lire un fichier local.
 */
const PROTOCOLS = 'http,https,tcp,tls,crypto,httpproxy'

export interface LiveSource {
  url: string
  /** En-têtes exigés par le serveur (`#EXTVLCOPT` dans la playlist) */
  userAgent: string | null
  referrer: string | null
  /** Variante HLS choisie à la main (son rang dans la playlist maître) ; null = la meilleure */
  variant: number | null
}

/** La vidéo passe telle quelle, ou est ré-encodée — sur l'encodeur matériel s'il y en a un. */
export type LiveVideo = { copy: true } | { copy: false; hw: HwEncoder | null }

/** Pure, testée. */
export function buildLiveArgs(source: LiveSource, video: LiveVideo): string[] {
  // `info` et non `error` : le bilan d'ouverture dit quels codecs ffmpeg a trouvés (parseStreams)
  const args = ['-hide_banner', '-nostats', '-loglevel', 'info']
  if (!video.copy && video.hw) args.push(...video.hw.init)
  args.push('-protocol_whitelist', PROTOCOLS)
  // Un direct sur HTTP finit toujours par couper : on se reconnecte plutôt que de figer l'image
  args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1')
  args.push('-reconnect_delay_max', '4')
  if (source.userAgent) args.push('-user_agent', source.userAgent)
  if (source.referrer) args.push('-referer', source.referrer)
  args.push('-i', source.url)
  // ffmpeg expose chaque variante HLS comme un programme, dans l'ordre de la playlist maître.
  // Sans `-map`, il retient la meilleure image et le meilleur son : la variante HD.
  if (source.variant !== null) {
    args.push('-map', `0:p:${source.variant}:v:0?`, '-map', `0:p:${source.variant}:a:0?`)
  }
  args.push('-sn', '-dn')
  args.push(...(video.copy ? ['-c:v', 'copy'] : videoEncodeArgs(video.hw)))
  // Le son est toujours ré-encodé : l'eac3 et le mp2, courants en direct, sont illisibles par
  // Chromium, et ré-encoder une piste stéréo ne coûte presque rien.
  args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2')
  args.push(...FRAGMENTED_MP4)
  return args
}

export interface LiveStreams {
  video: string | null
  audio: string | null
}

const INPUT_STREAM = /Stream #0:(\d+)[^:\n]*: (Video|Audio): ([\w-]+)/g
const MAPPED_STREAM = /^\s*Stream #0:(\d+) -> #0:\d+/

/**
 * Codecs des flux d'entrée retenus par ffmpeg, lus dans son bilan d'ouverture :
 *
 *     Stream #0:1[0x0]: Video: h264 (Main) …
 *     Stream mapping:
 *       Stream #0:1 -> #0:0 (copy)
 *
 * Les flux de sortie sont numérotés `#0:n` eux aussi : seul ce qui précède « Stream mapping »
 * décrit l'entrée. Pure, testée.
 */
export function parseStreams(stderr: string): LiveStreams {
  const found: LiveStreams = { video: null, audio: null }
  const at = stderr.indexOf('Stream mapping:')
  if (at < 0) return found

  const inputs = new Map<string, { type: string; codec: string }>()
  for (const [, id, type, codec] of stderr.slice(0, at).matchAll(INPUT_STREAM)) {
    inputs.set(id, { type, codec })
  }
  for (const line of stderr.slice(at).split('\n').slice(1)) {
    const mapped = MAPPED_STREAM.exec(line)
    if (!mapped) break
    const input = inputs.get(mapped[1])
    if (input?.type === 'Video') found.video ??= input.codec
    if (input?.type === 'Audio') found.audio ??= input.codec
  }
  return found
}

// Les codes HTTP ne se lisent qu'à côté de « HTTP error » ou « returned » : l'URL citée dans la
// même ligne peut contenir un `/403/` qui ne dit rien.
const ERRORS: [RegExp, string][] = [
  [/(HTTP error|returned) 404/i, 'flux introuvable : la chaîne a sans doute changé d’adresse'],
  [
    /(HTTP error|returned) 4(01|03|51|52)/i,
    'accès refusé par le serveur, souvent une restriction géographique'
  ],
  [/(HTTP error|returned) 5(\d\d|XX)/i, 'le serveur de la chaîne est en panne'],
  [/Failed to resolve hostname|Name or service not known/i, 'adresse du serveur inconnue'],
  [
    /Connection refused|No route to host|Network is unreachable/i,
    'serveur de la chaîne injoignable'
  ],
  [/timed out/i, 'le serveur de la chaîne ne répond pas'],
  [/Invalid data found when processing input/i, 'le serveur ne renvoie pas une vidéo lisible']
]

/**
 * Traduit le récit d'ffmpeg en une phrase affichable. On cherche d'abord les causes connues,
 * puis on retombe sur la dernière ligne d'erreur telle quelle. Pure, testée.
 */
export function describeLiveError(stderr: string, fallback = 'le flux s’est interrompu'): string {
  const errors = stderr
    .split('\n')
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim())
    .filter((l) => /error|fail|refused|denied|timed out|not found/i.test(l))
  for (const [pattern, message] of ERRORS) {
    if (errors.some((l) => pattern.test(l))) return message
  }
  return errors.at(-1) ?? fallback
}

/** Dernière erreur par chaîne : `<video>` ne sait dire que « échec », l'interface vient lire ici pourquoi. */
const lastErrors = new Map<string, string>()

export function liveError(url: string): string | null {
  return lastErrors.get(url) ?? null
}

export class LiveError extends Error {}

export interface LiveStream {
  body: Readable
  streams: LiveStreams
  /** La vidéo a dû être ré-encodée (codec illisible par Chromium) */
  transcoded: boolean
}

interface Started {
  head: Buffer
  stdout: Readable
  streams: LiveStreams
  stop: () => void
}

/**
 * Lance ffmpeg et attend qu'il ait à la fois décrit ses flux et produit un premier octet. Tant
 * que rien n'est parti vers le lecteur, on peut encore changer d'avis sur la vidéo.
 */
function launch(source: LiveSource, video: LiveVideo, signal: AbortSignal): Promise<Started> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new LiveError('annulé'))
    const ffmpeg = spawnFfmpeg(buildLiveArgs(source, video))
    const { child } = ffmpeg
    // Un arrêt voulu — relance en ré-encodage, changement de chaîne — n'est pas une panne
    let stopped = false
    const stop = (): void => {
      stopped = true
      ffmpeg.stop()
    }
    let stderr = ''
    let head: Buffer | null = null
    let described = false
    let settled = false

    const finish = (error: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (error === null) {
        child.stdout.pause()
        resolve({ head: head!, stdout: child.stdout, streams: parseStreams(stderr), stop })
        return
      }
      stop()
      reject(new LiveError(error))
    }
    const ready = (): void => {
      if (head && described) finish(null)
    }
    const onAbort = (): void => finish('annulé')
    const timer = setTimeout(() => {
      const cause = describeLiveError(stderr, 'le serveur de la chaîne ne répond pas')
      finish(`aucune image reçue en ${STARTUP_TIMEOUT_MS / 1000} s : ${cause}`)
    }, STARTUP_TIMEOUT_MS)
    signal.addEventListener('abort', onAbort, { once: true })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_STDERR)
      // Le bilan de sortie suit la table de correspondance : quand il commence, elle est complète
      if (!described && stderr.includes('Output #0')) {
        described = true
        ready()
      }
    })
    child.stdout.once('data', (chunk: Buffer) => {
      head = chunk
      child.stdout.pause()
      ready()
    })
    child.on('close', () => {
      if (!settled) finish(describeLiveError(stderr))
      else if (!stopped) {
        // Le direct a démarré puis s'est arrêté : le lecteur verra la fin du flux et viendra
        // demander pourquoi.
        lastErrors.set(source.url, describeLiveError(stderr))
      }
    })
  })
}

/**
 * Ouvre une chaîne. La vidéo est d'abord recopiée telle quelle — h264 dans l'immense majorité
 * des cas — et, si le bilan d'ouverture annonce un codec que Chromium ne lit pas (le mpeg2 de
 * certains flux satellite), ffmpeg est relancé en ré-encodage avant que le moindre octet soit
 * parti. Le flux renvoyé s'arrête avec `signal` : changer de chaîne libère l'ancienne.
 */
export async function startLive(source: LiveSource, signal: AbortSignal): Promise<LiveStream> {
  lastErrors.delete(source.url)
  try {
    let started = await launch(source, { copy: true }, signal)
    let transcoded = false
    const video = started.streams.video
    if (video && !MP4_VIDEO.has(video)) {
      started.stop()
      console.log(`[iptv] vidéo ${video} illisible par Chromium : ré-encodage`)
      started = await launch(source, { copy: false, hw: await detectHwEncoder() }, signal)
      transcoded = true
    }

    const { head, stdout, stop } = started
    signal.addEventListener('abort', stop, { once: true })
    // Le premier morceau, déjà lu pour savoir que le flux démarre, repasse devant le reste
    const body = new PassThrough()
    body.write(head)
    stdout.pipe(body)
    body.on('close', stop)
    return { body, streams: started.streams, transcoded }
  } catch (err) {
    if (err instanceof LiveError && !signal.aborted) lastErrors.set(source.url, err.message)
    throw err
  }
}
