import { extname, isAbsolute } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME } from '../shared/ipc'
import { planPlayback, type PlaybackPlan } from './core/compat'
import { ffmpegUrlFor, readMedia, statMedia } from './library'
import { probe } from './core/ffmpeg'
import { detectHwEncoder, startStream } from './core/transcode'

/**
 * Protocole `media://local/<chemin encodé>` : sert les fichiers du disque au renderer
 * avec support des requêtes Range (indispensable pour le seek dans <video>).
 * Le renderer (http://localhost en dev) ne peut pas charger de `file://` directement.
 */
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

/** Plan de lecture par fichier : ffprobe n'est lancé qu'une fois, pas à chaque saut. */
const plans = new Map<string, Promise<PlaybackPlan>>()

export function playbackPlan(filePath: string): Promise<PlaybackPlan> {
  let cached = plans.get(filePath)
  if (!cached) {
    cached = ffmpegUrlFor(filePath).then(probe).then(planPlayback)
    plans.set(filePath, cached)
  }
  return cached
}

/**
 * `media://stream/<chemin>?t=<secondes>` : ffmpeg remuxe ou ré-encode vers un MP4 fragmenté
 * envoyé au fil de l'eau. La taille est inconnue d'avance, donc pas de requêtes Range : le saut
 * dans la vidéo relance ffmpeg à la position voulue (voir docs/transcoding.md).
 */
async function handleStream(filePath: string, request: Request): Promise<Response> {
  const seek = Number(new URL(request.url).searchParams.get('t') ?? 0)
  let plan: PlaybackPlan
  let info: Awaited<ReturnType<typeof probe>>
  let input: string
  try {
    input = await ffmpegUrlFor(filePath)
    ;[plan, info] = await Promise.all([playbackPlan(filePath), probe(input)])
  } catch {
    return new Response('Unreadable media', { status: 415 })
  }

  const { stdout, stop } = startStream({
    input,
    plan,
    videoCodec: info.metadata.videoCodec ?? null,
    audioCodec: info.metadata.audioCodec ?? null,
    seek: Number.isFinite(seek) && seek > 0 ? seek : 0,
    hw: await detectHwEncoder()
  })
  // Changer de position ou fermer la fenêtre annule la requête : ffmpeg doit s'arrêter avec elle
  request.signal.addEventListener('abort', stop)

  return new Response(Readable.toWeb(stdout as Readable) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-store'
    }
  })
}

const IMAGE_TIMEOUT_MS = 15_000
/** Une pochette de podcast dépasse rarement le mégaoctet ; au-delà on refuse. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * `media://image/<url>` : relaie une image distante. Seules les URL http(s) sont acceptées, la
 * réponse doit être une image, et sa taille est plafonnée — un flux malveillant ne peut donc pas
 * faire télécharger n'importe quoi à l'application.
 */
async function handleImage(remoteUrl: string): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(remoteUrl)
  } catch {
    return new Response('Bad image URL', { status: 400 })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new Response('Unsupported scheme', { status: 400 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
  try {
    const res = await fetch(parsed, { redirect: 'follow', signal: controller.signal })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/')) return new Response('Not an image', { status: 415 })
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) {
      return new Response('Image too large', { status: 413 })
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_IMAGE_BYTES) return new Response('Image too large', { status: 413 })
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' }
    })
  } catch {
    return new Response('Image unavailable', { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const locator = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (url.host === 'image') return handleImage(locator)
    // TODO(#4): n'autoriser que les fichiers appartenant à une source de la bibliothèque.
    if (!isAbsolute(locator) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(locator)) {
      return new Response('Bad path', { status: 400 })
    }
    if (url.host === 'stream') return handleStream(locator, request)

    // Le fichier peut être local ou sur un partage réseau : la source est résolue par la
    // bibliothèque, qui sait lire une plage d'octets dans les deux cas.
    let size: number
    try {
      size = (await statMedia(locator)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const mime = MIME[extname(locator).toLowerCase()] ?? 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes'
    }

    const range = request.headers.get('range')
    // Taille inconnue (hébergeur qui n'annonce rien de fiable) : on sert le fichier d'un bloc
    // plutôt que de répondre 416 sur une arithmétique de plages impossible à faire.
    const match = size > 0 && range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (size > 0) headers['Content-Length'] = String(size)
    else headers['Accept-Ranges'] = 'none'
    try {
      if (match) {
        const start = match[1] ? Number(match[1]) : 0
        const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
        if (start >= size || start > end) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` }
          })
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`
        headers['Content-Length'] = String(end - start + 1)
        const stream = await readMedia(locator, { start, end })
        return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers })
      }

      const stream = await readMedia(locator)
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers })
    } catch (err) {
      console.warn(`[media] lecture impossible de ${locator} :`, (err as Error).message)
      return new Response('Unavailable', { status: 503 })
    }
  })
}
