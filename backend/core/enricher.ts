import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { media, type Database } from './db'
import { extractCover, probe, videoThumbnail } from './ffmpeg'

export interface EnrichOptions {
  thumbnailDir: string
  concurrency?: number
  /** Appelé après chaque média traité (succès ou échec) */
  onDone?: (mediaId: number, ok: boolean) => void
  onIdle?: () => void
}

/**
 * File d'enrichissement : lance ffprobe / ffmpeg sur les médias en attente, quelques-uns à la
 * fois, sans jamais bloquer le scan ni l'UI. Idempotent : un média déjà `probed_at` est ignoré.
 */
export class Enricher {
  private queue: number[] = []
  private queued = new Set<number>()
  private active = 0
  private stopped = false

  constructor(
    private db: Database,
    private opts: EnrichOptions
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

  /** Met en file tout ce qui n'a pas encore été analysé (au démarrage, après un scan). */
  enqueueUnprobed(sourceId?: number): void {
    this.enqueue(media.listUnprobed(this.db, sourceId))
  }

  stop(): void {
    this.stopped = true
    this.queue = []
    this.queued.clear()
  }

  private pump(): void {
    const max = this.opts.concurrency ?? 4
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
    const m = media.get(this.db, id)
    if (!m || m.probedAt !== null) return
    let ok = false
    try {
      ok = await enrichOne(this.db, id, this.opts.thumbnailDir)
    } catch (err) {
      console.warn(`[enrich] échec sur ${m.path} :`, (err as Error).message)
      // Marqué quand même : on ne réessaie pas un fichier corrompu à chaque démarrage
      media.markProbed(this.db, id)
    }
    this.opts.onDone?.(id, ok)
  }
}

/** Analyse un média et écrit le résultat en base. Retourne false si le fichier a disparu. */
export async function enrichOne(db: Database, id: number, thumbnailDir: string): Promise<boolean> {
  const m = media.get(db, id)
  if (!m) return false

  const result = await probe(m.path)
  media.setMetadata(db, id, result.metadata)

  // Les tags audio sont fiables ("Around the World") ; ceux des vidéos rarement → TMDB (#14)
  const title = m.type === 'audio' && result.title ? result.title : undefined
  media.markProbed(db, id, { duration: result.duration, title })

  await mkdir(thumbnailDir, { recursive: true })
  const out = join(thumbnailDir, `${id}.jpg`)
  try {
    if (m.type === 'video' && result.hasVideo) {
      await videoThumbnail(m.path, out, result.duration)
      media.setMetadata(db, id, { thumbnailPath: out })
    } else if (result.hasCover) {
      await extractCover(m.path, out)
      media.setMetadata(db, id, { thumbnailPath: out })
    }
  } catch (err) {
    // Une miniature ratée n'est pas grave : le média reste exploitable
    console.warn(`[enrich] miniature impossible pour ${m.path} :`, (err as Error).message)
  }
  return true
}
