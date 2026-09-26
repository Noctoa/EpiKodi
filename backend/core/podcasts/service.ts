import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { podcasts, type Database } from '../db'
import { parseFeed, type ParsedFeed } from './rss'

const FETCH_TIMEOUT_MS = 20_000
/** Un flux de podcast dépasse rarement quelques mégaoctets ; au-delà on refuse. */
const MAX_FEED_BYTES = 20 * 1024 * 1024
const USER_AGENT = 'EpiKodi/0.1 (+https://github.com/Noctoa/EpiKodi)'

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...init.headers }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

/** Télécharge et analyse un flux RSS. */
export async function fetchFeed(url: string): Promise<ParsedFeed> {
  const res = await fetchWithTimeout(url)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_FEED_BYTES) throw new Error('flux trop volumineux')
  const xml = await res.text()
  if (xml.length > MAX_FEED_BYTES) throw new Error('flux trop volumineux')
  return parseFeed(xml)
}

export interface RefreshResult {
  podcastId: number
  title: string
  /** Épisodes qui n'étaient pas encore connus */
  added: number
  total: number
  error: string | null
}

/** S'abonne à un flux, ou met à jour l'abonnement existant. */
export async function subscribe(
  db: Database,
  feedUrl: string,
  imageDir: string
): Promise<RefreshResult> {
  const { feed, episodes } = await fetchFeed(feedUrl)
  const podcast = podcasts.upsert(db, feedUrl, feed)
  const added = podcasts.upsertEpisodes(db, podcast.id, episodes)
  podcasts.markFetched(db, podcast.id)
  await cacheCover(db, podcast.id, feed.imageUrl, imageDir)
  return {
    podcastId: podcast.id,
    title: feed.title,
    added,
    total: podcasts.count(db, podcast.id),
    error: null
  }
}

/** Rafraîchit un abonnement ; une erreur réseau est mémorisée, jamais propagée. */
export async function refresh(db: Database, id: number, imageDir: string): Promise<RefreshResult> {
  const podcast = podcasts.get(db, id)
  if (!podcast) throw new Error(`podcast ${id} introuvable`)
  try {
    const { feed, episodes } = await fetchFeed(podcast.feedUrl)
    podcasts.upsert(db, podcast.feedUrl, feed)
    const added = podcasts.upsertEpisodes(db, id, episodes)
    podcasts.markFetched(db, id)
    if (!podcast.imagePath) await cacheCover(db, id, feed.imageUrl, imageDir)
    return { podcastId: id, title: feed.title, added, total: podcasts.count(db, id), error: null }
  } catch (err) {
    const message = (err as Error).message
    podcasts.markFetched(db, id, message)
    console.warn(`[podcasts] rafraîchissement de « ${podcast.title} » : ${message}`)
    return {
      podcastId: id,
      title: podcast.title,
      added: 0,
      total: podcasts.count(db, id),
      error: message
    }
  }
}

export async function refreshAll(db: Database, imageDir: string): Promise<RefreshResult[]> {
  return Promise.all(podcasts.list(db).map((p) => refresh(db, p.id, imageDir)))
}

/** Met la pochette en cache sur disque pour l'afficher sans dépendre du réseau. */
async function cacheCover(
  db: Database,
  podcastId: number,
  imageUrl: string | null,
  imageDir: string
): Promise<void> {
  if (!imageUrl) return
  try {
    await mkdir(imageDir, { recursive: true })
    const dest = join(imageDir, `${podcastId}${extname(new URL(imageUrl).pathname) || '.jpg'}`)
    const res = await fetchWithTimeout(imageUrl)
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(dest)
    )
    podcasts.setImagePath(db, podcastId, dest)
  } catch (err) {
    console.warn(`[podcasts] pochette indisponible :`, (err as Error).message)
  }
}

export interface DownloadProgress {
  episodeId: number
  received: number
  total: number
  done: boolean
  error?: string
}

/**
 * Télécharge un épisode pour l'écoute hors ligne. Le fichier est écrit sous un nom temporaire
 * puis renommé : une coupure réseau ne laisse jamais un fichier tronqué passer pour valide.
 */
export async function downloadEpisode(
  db: Database,
  episodeId: number,
  downloadDir: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const episode = podcasts.episode(db, episodeId)
  if (!episode) throw new Error(`épisode ${episodeId} introuvable`)
  if (episode.localPath) return episode.localPath

  await mkdir(downloadDir, { recursive: true })
  const extension = extname(new URL(episode.audioUrl).pathname) || '.mp3'
  const final = join(downloadDir, `${episodeId}${extension}`)
  const partial = `${final}.part`

  const res = await fetchWithTimeout(episode.audioUrl, { signal })
  const total = Number(res.headers.get('content-length') ?? episode.size ?? 0)
  let received = 0

  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress?.({ episodeId, received, total, done: false })
  })

  try {
    await pipeline(body, createWriteStream(partial), { signal })
    await rename(partial, final)
  } catch (err) {
    await rm(partial, { force: true })
    onProgress?.({ episodeId, received, total, done: true, error: (err as Error).message })
    throw err
  }

  podcasts.setLocalPath(db, episodeId, final)
  onProgress?.({ episodeId, received, total: total || received, done: true })
  return final
}

/** Supprime la copie hors ligne ; l'épisode reste écoutable en streaming. */
export async function removeDownload(db: Database, episodeId: number): Promise<void> {
  const episode = podcasts.episode(db, episodeId)
  if (!episode?.localPath) return
  await rm(episode.localPath, { force: true })
  podcasts.setLocalPath(db, episodeId, null)
}

export async function downloadedSize(db: Database, episodeId: number): Promise<number> {
  const episode = podcasts.episode(db, episodeId)
  if (!episode?.localPath) return 0
  try {
    return (await stat(episode.localPath)).size
  } catch {
    return 0
  }
}

export interface PodcastSearchResult {
  title: string
  author: string | null
  feedUrl: string
  imageUrl: string | null
  episodeCount: number | null
}

/**
 * Recherche dans l'annuaire public d'Apple, qui ne demande ni clé ni inscription et renvoie
 * directement l'URL du flux RSS.
 */
export async function search(term: string, limit = 15): Promise<PodcastSearchResult[]> {
  if (!term.trim()) return []
  const url = `https://itunes.apple.com/search?media=podcast&limit=${limit}&term=${encodeURIComponent(term)}`
  const res = await fetchWithTimeout(url)
  const data = (await res.json()) as {
    results?: {
      collectionName?: string
      artistName?: string
      feedUrl?: string
      artworkUrl600?: string
      artworkUrl100?: string
      trackCount?: number
    }[]
  }
  return (data.results ?? [])
    .filter((r) => r.feedUrl)
    .map((r) => ({
      title: r.collectionName ?? 'Sans titre',
      author: r.artistName ?? null,
      feedUrl: r.feedUrl!,
      imageUrl: r.artworkUrl600 ?? r.artworkUrl100 ?? null,
      episodeCount: r.trackCount ?? null
    }))
}
