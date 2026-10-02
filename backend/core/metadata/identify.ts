import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { media, type Database } from '../db'
import { guessFromFilename } from './filename'
import { AUTO_MATCH_THRESHOLD } from './score'
import type { MetadataDetails, MetadataMatch, MetadataProvider } from './types'

export interface IdentifyOptions {
  /** Dossier où sont mises en cache affiches et images de fond */
  imageDir: string
  provider: MetadataProvider
  onDone?: (mediaId: number, matched: boolean) => void
  onIdle?: () => void
  concurrency?: number
}

/** Télécharge une image et renvoie son chemin local, ou null si elle est indisponible. */
async function cacheImage(url: string, dir: string, name: string): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true })
    const dest = join(dir, `${name}${extname(new URL(url).pathname) || '.jpg'}`)
    const res = await fetch(url)
    if (!res.ok || !res.body) return null
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(dest)
    )
    return dest
  } catch {
    return null
  }
}

/** Candidats proposés pour un média, du plus probable au moins probable. */
export async function suggestMatches(
  db: Database,
  mediaId: number,
  provider: MetadataProvider,
  query?: string
): Promise<MetadataMatch[]> {
  const item = media.get(db, mediaId)
  if (!item) return []
  const guess = guessFromFilename(basename(item.path), basename(dirname(item.path)))

  // En automatique, on suit ce que dit le nom de fichier. En correction manuelle, c'est
  // justement que la supposition est fausse : on cherche alors films ET séries, sans quoi un
  // fichier mal nommé ne remonterait jamais la série correspondante.
  if (!query) return provider.search(guess)

  const base = { ...guess, title: query, year: null }
  const [films, series] = await Promise.all([
    provider.search({ ...base, kind: 'movie' }).catch(() => [] as MetadataMatch[]),
    provider.search({ ...base, kind: 'tv' }).catch(() => [] as MetadataMatch[])
  ])

  // Une source spécialisée peut renvoyer les mêmes fiches pour les deux requêtes
  const vus = new Set<string>()
  return [...films, ...series]
    .filter((m) => !vus.has(m.externalId) && vus.add(m.externalId))
    .sort((a, b) => b.score - a.score)
}

/** Écrit en base les informations d'une correspondance, et met ses images en cache. */
export async function applyMatch(
  db: Database,
  mediaId: number,
  details: MetadataDetails,
  imageDir: string
): Promise<void> {
  const [poster, backdrop] = await Promise.all([
    details.posterUrl ? cacheImage(details.posterUrl, imageDir, `${mediaId}-poster`) : null,
    details.backdropUrl ? cacheImage(details.backdropUrl, imageDir, `${mediaId}-backdrop`) : null
  ])

  media.setMetadata(db, mediaId, {
    externalId: details.externalId,
    overview: details.overview,
    rating: details.rating,
    year: details.year,
    genre: details.genres[0] ?? null,
    runtime: details.runtime,
    ...(poster && { posterPath: poster }),
    ...(backdrop && { backdropPath: backdrop })
  })
  if (details.cast.length > 0) media.setCast(db, mediaId, details.cast)
  // Le titre officiel vaut mieux que celui tiré du nom de fichier
  media.markProbed(db, mediaId, { title: details.title })
  media.markIdentified(db, mediaId)
}

/**
 * Identifie un média : devine le titre depuis son nom de fichier, interroge la source et ne
 * retient la correspondance que si elle est suffisamment sûre. Dans tous les cas le média est
 * marqué comme traité, pour ne pas réinterroger l'API à chaque démarrage.
 */
export async function identifyOne(
  db: Database,
  mediaId: number,
  provider: MetadataProvider,
  imageDir: string
): Promise<boolean> {
  const item = media.get(db, mediaId)
  if (!item) return false

  const matches = await suggestMatches(db, mediaId, provider)
  const best = matches[0]
  if (!best || best.score < AUTO_MATCH_THRESHOLD) {
    media.markIdentified(db, mediaId)
    return false
  }

  const details = await provider.details(best.externalId)
  if (!details) {
    media.markIdentified(db, mediaId)
    return false
  }
  await applyMatch(db, mediaId, details, imageDir)
  return true
}

/**
 * File d'identification : interroge la source quelques médias à la fois, sans bloquer
 * l'interface ni saturer l'API.
 */
export class Identifier {
  private queue: number[] = []
  private queued = new Set<number>()
  private active = 0
  private stopped = false

  constructor(
    private db: Database,
    private opts: IdentifyOptions
  ) {}

  get pending(): number {
    return this.queue.length + this.active
  }

  enqueue(ids: number[]): void {
    for (const id of ids) {
      if (!this.queued.has(id)) {
        this.queued.add(id)
        this.queue.push(id)
      }
    }
    this.pump()
  }

  enqueueUnidentified(): void {
    if (this.opts.provider.configured()) this.enqueue(media.listUnidentified(this.db))
  }

  stop(): void {
    this.stopped = true
    this.queue = []
    this.queued.clear()
  }

  private pump(): void {
    const max = this.opts.concurrency ?? 3
    while (!this.stopped && this.active < max && this.queue.length > 0) {
      const id = this.queue.shift()!
      this.active++
      void this.process(id).finally(() => {
        this.active--
        this.queued.delete(id)
        if (this.pending === 0) this.opts.onIdle?.()
        else this.pump()
      })
    }
  }

  private async process(id: number): Promise<void> {
    let matched = false
    try {
      matched = await identifyOne(this.db, id, this.opts.provider, this.opts.imageDir)
    } catch (err) {
      const message = (err as Error).message
      console.warn(`[tmdb] identification du média ${id} : ${message}`)
      // Une clé refusée ou un quota atteint touche tous les médias : inutile d'insister
      if (/refus|clé|quota|trop de requêtes/i.test(message)) this.stop()
      else media.markIdentified(this.db, id)
    }
    this.opts.onDone?.(id, matched)
  }
}
