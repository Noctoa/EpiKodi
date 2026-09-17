import { join } from 'node:path'
import { app } from 'electron'
import { media, openDatabase, sources, type Database } from './core/db'
import type { LibraryStats } from '../shared/ipc'

/**
 * Cycle de vie de la base de données de la bibliothèque.
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
