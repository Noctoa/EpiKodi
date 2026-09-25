import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME } from '../shared/ipc'
import { planPlayback, type PlaybackPlan } from './core/compat'
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
    cached = probe(filePath).then(planPlayback)
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
  try {
    ;[plan, info] = await Promise.all([playbackPlan(filePath), probe(filePath)])
  } catch {
    return new Response('Unreadable media', { status: 415 })
  }

  const { stdout, stop } = startStream({
    input: filePath,
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

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    // TODO(#4): n'autoriser que les fichiers appartenant à une source de la bibliothèque.
    if (!isAbsolute(filePath)) return new Response('Bad path', { status: 400 })
    if (url.host === 'stream') return handleStream(filePath, request)

    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes'
    }

    const range = request.headers.get('range')
    const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      headers['Content-Length'] = String(end - start + 1)
      const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
      return new Response(stream, { status: 206, headers })
    }

    headers['Content-Length'] = String(size)
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
    return new Response(stream, { status: 200, headers })
  })
}
