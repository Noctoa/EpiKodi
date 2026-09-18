import { basename, join } from 'node:path'
import { app } from 'electron'
import { media, openDatabase, sources, type Database } from './core/db'
import { scanSource } from './core/scanner'
import type { LibraryStats, MediaListQuery, ScanProgress } from '../shared/ipc'
import type { Media, Source } from '../shared/models'

/**
 * Façade de la bibliothèque : cycle de vie de la base SQLite + opérations exposées à l'IPC.
 * Un seul fichier SQLite par utilisateur, dans le dossier de données de l'app.
 */
let db: Database | null = null

export function databasePath(): string {
  return join(app.getPath('userData'), 'epikodi.db')
}

export function openLibrary(): Database {
  if (!db) {
    db = openDatabase(databasePath())
    console.log(`[library] base ouverte : ${databasePath()}`)
  }
  return db
}

export function closeLibrary(): void {
  for (const ctrl of running.values()) ctrl.abort()
  db?.close()
  db = null
}

export function libraryStats(): LibraryStats {
  const d = openLibrary()
  return {
    sources: sources.list(d).length,
    media: media.count(d),
    videos: media.count(d, 'video'),
    audio: media.count(d, 'audio'),
    podcasts: media.count(d, 'podcast')
  }
}

// ---------- sources ----------

export function listSources(): Source[] {
  return sources.list(openLibrary())
}

export function addSource(path: string): Source {
  const d = openLibrary()
  const existing = sources.list(d).find((s) => s.path === path)
  if (existing) return existing
  return sources.create(d, { type: 'local', path, name: basename(path) || path })
}

export function removeSource(id: number): void {
  cancelScan(id)
  sources.remove(openLibrary(), id)
}

// ---------- scan ----------

/** Un scan en cours par source, annulable */
const running = new Map<number, AbortController>()

/**
 * Lance le scan en arrière-plan et retourne tout de suite ; la progression arrive par `onProgress`.
 * Si un scan est déjà en cours pour cette source, on ne le double pas.
 */
export function startScan(id: number, onProgress: (p: ScanProgress) => void): void {
  const d = openLibrary()
  const source = sources.get(d, id)
  if (!source || running.has(id)) return

  const ctrl = new AbortController()
  running.set(id, ctrl)
  console.log(`[scan] début : ${source.path}`)

  void scanSource(d, source, { onProgress, signal: ctrl.signal })
    .then((p) => {
      if (!ctrl.signal.aborted) sources.markScanned(d, id)
      console.log(`[scan] fin : +${p.added} ~${p.updated} -${p.removed} (${p.scanned} fichiers)`)
    })
    .catch((err: Error) => {
      console.error(`[scan] erreur sur ${source.path} :`, err)
      onProgress({
        sourceId: id,
        scanned: 0,
        added: 0,
        updated: 0,
        removed: 0,
        current: '',
        done: true,
        error: err.message
      })
    })
    .finally(() => running.delete(id))
}

/** Au démarrage : remet la bibliothèque à jour sans intervention de l'utilisateur. */
export function scanAllSources(onProgress: (p: ScanProgress) => void): void {
  for (const s of listSources()) startScan(s.id, onProgress)
}

export function cancelScan(id: number): void {
  running.get(id)?.abort()
}

// ---------- media ----------

export function listMedia(query: MediaListQuery = {}): Media[] {
  return media.list(openLibrary(), query)
}
