import { basename, extname } from 'node:path'
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/ipc'
import type { MediaType, Source } from '@shared/models'
import { media, transaction, type Database } from './db'
import { createProvider, type StorageProvider } from './storage'

export interface ScanProgress {
  sourceId: number
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
  /** Accès au stockage ; par défaut déduit de la source (local, SMB, HTTP). */
  provider?: StorageProvider
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

/**
 * Parcours récursif. Le listing d'un dossier ramène déjà taille et date de chaque entrée :
 * sur un partage réseau, cela évite un aller-retour par fichier. Un dossier illisible est
 * ignoré, il ne fait pas échouer le scan.
 */
async function* walk(
  provider: StorageProvider,
  dir: string,
  signal?: AbortSignal
): AsyncGenerator<FoundFile> {
  let entries
  try {
    entries = await provider.list(dir)
  } catch (err) {
    // Un sous-dossier illisible est ignoré, mais si la racine échoue la source est injoignable :
    // le scan doit le dire plutôt que de rapporter « 0 fichier ».
    if (dir === '') throw err
    return
  }
  for (const entry of entries) {
    if (signal?.aborted) return
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      yield* walk(provider, path, signal)
    } else {
      const type = mediaTypeOf(entry.name)
      if (type) yield { path, type, size: entry.size, mtime: entry.mtime }
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
  const provider = opts.provider ?? createProvider(source)
  const ownsProvider = opts.provider === undefined
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
          path: provider.locate(f.path),
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

  for await (const file of walk(provider, '', opts.signal)) {
    progress.scanned++
    const locator = provider.locate(file.path)
    progress.current = locator
    seen.push(locator)
    const prev = known.get(locator)
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
  if (ownsProvider) provider.close()
  return progress
}
