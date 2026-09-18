import { opendir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/ipc'
import type { MediaType, Source } from '@shared/models'
import { media, transaction, type Database } from './db'

export interface ScanProgress {
  sourceId: number
  /** Fichiers média rencontrés jusqu'ici */
  scanned: number
  added: number
  updated: number
  removed: number
  /** Dernier fichier traité (pour l'affichage) */
  current: string
  done: boolean
}

export interface ScanOptions {
  onProgress?: (p: ScanProgress) => void
  signal?: AbortSignal
  /** Nombre de fichiers par transaction */
  batchSize?: number
}

const VIDEO = new Set(VIDEO_EXTENSIONS)
const AUDIO = new Set(AUDIO_EXTENSIONS)
/** Dossiers ignorés partout (caches, corbeilles, VCS) */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.Trash',
  '.Trash-1000',
  '@eaDir',
  '.thumbnails'
])

export function mediaTypeOf(file: string): MediaType | null {
  const ext = extname(file).slice(1).toLowerCase()
  if (VIDEO.has(ext)) return 'video'
  if (AUDIO.has(ext)) return 'audio'
  return null
}

/** "Mon.Film.2019.mkv" → "Mon Film 2019" : titre par défaut avant enrichissement (ffprobe / TMDB). */
export function titleFromFilename(file: string): string {
  const base = basename(file, extname(file))
  return base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim() || base
}

interface FoundFile {
  path: string
  type: MediaType
  size: number
  mtime: number
}

/** Parcours récursif asynchrone ; les dossiers illisibles sont ignorés, pas fatals. */
async function* walk(dir: string, signal?: AbortSignal): AsyncGenerator<FoundFile> {
  let handle
  try {
    handle = await opendir(dir)
  } catch {
    return
  }
  for await (const entry of handle) {
    if (signal?.aborted) return
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      yield* walk(full, signal)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const type = mediaTypeOf(entry.name)
      if (!type) continue
      try {
        const s = await stat(full)
        if (!s.isFile()) continue
        yield { path: full, type, size: s.size, mtime: Math.floor(s.mtimeMs) }
      } catch {
        /* lien mort ou fichier disparu entre-temps */
      }
    }
  }
}

/**
 * Indexe une source : ajoute les nouveaux fichiers, met à jour ceux qui ont changé
 * (mtime ou taille), supprime ceux qui ont disparu. Idempotent : relancer ne change rien.
 */
export async function scanSource(
  db: Database,
  source: Source,
  opts: ScanOptions = {}
): Promise<ScanProgress> {
  const batchSize = opts.batchSize ?? 200
  const progress: ScanProgress = {
    sourceId: source.id,
    scanned: 0,
    added: 0,
    updated: 0,
    removed: 0,
    current: '',
    done: false
  }
  const report = (): void => opts.onProgress?.({ ...progress })

  // Ce que la BDD connaît déjà : permet de ne rien réécrire pour un fichier inchangé
  const known = new Map<string, { mtime: number; size: number }>()
  for (const m of media.list(db, { sourceId: source.id, limit: Number.MAX_SAFE_INTEGER })) {
    known.set(m.path, { mtime: m.mtime, size: m.size })
  }

  const seen: string[] = []
  let batch: FoundFile[] = []
  const flush = (): void => {
    if (batch.length === 0) return
    transaction(db, () => {
      for (const f of batch) {
        media.upsert(db, {
          sourceId: source.id,
          path: f.path,
          type: f.type,
          title: titleFromFilename(f.path),
          size: f.size,
          mtime: f.mtime
        })
      }
    })
    batch = []
    report()
  }

  for await (const file of walk(source.path, opts.signal)) {
    progress.scanned++
    progress.current = file.path
    seen.push(file.path)
    const prev = known.get(file.path)
    if (!prev) {
      progress.added++
      batch.push(file)
    } else if (prev.mtime !== file.mtime || prev.size !== file.size) {
      progress.updated++
      batch.push(file)
    }
    if (batch.length >= batchSize) flush()
  }
  flush()

  if (!opts.signal?.aborted) {
    // Un scan interrompu ne doit pas supprimer ce qu'il n'a pas eu le temps de voir
    progress.removed = media.removeMissing(db, source.id, seen)
  }
  progress.done = true
  report()
  return progress
}
