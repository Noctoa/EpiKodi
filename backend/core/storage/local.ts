import { createReadStream } from 'node:fs'
import { opendir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative as relativePath } from 'node:path'
import type { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import type { ByteRange, StorageEntry, StorageProvider, StorageStat } from './types'
import { StorageUnavailable } from './types'

/**
 * Dossier du système de fichiers. Couvre aussi les partages réseau déjà montés par le système
 * (fstab, autofs, gvfs) : ils se présentent comme un chemin ordinaire.
 */
export class LocalProvider implements StorageProvider {
  readonly kind = 'local' as const

  constructor(private root: string) {}

  get label(): string {
    return this.root
  }

  private full(path: string): string {
    return path ? join(this.root, path) : this.root
  }

  async list(path: string): Promise<StorageEntry[]> {
    const entries: StorageEntry[] = []
    let dir
    try {
      dir = await opendir(this.full(path))
    } catch (err) {
      throw new StorageUnavailable(`dossier illisible : ${this.full(path)}`, { cause: err })
    }
    for await (const entry of dir) {
      const isDirectory = entry.isDirectory()
      if (!isDirectory && !entry.isFile() && !entry.isSymbolicLink()) continue
      try {
        const s = await stat(join(this.full(path), entry.name))
        entries.push({
          name: entry.name,
          isDirectory: s.isDirectory(),
          size: s.size,
          mtime: Math.floor(s.mtimeMs)
        })
      } catch {
        /* lien mort ou fichier disparu pendant le parcours */
      }
    }
    return entries
  }

  async stat(path: string): Promise<StorageStat> {
    const s = await stat(this.full(path))
    return { size: s.size, mtime: Math.floor(s.mtimeMs) }
  }

  read(path: string, range?: ByteRange): Promise<Readable> {
    return Promise.resolve(createReadStream(this.full(path), range))
  }

  async available(): Promise<boolean> {
    if (!isAbsolute(this.root)) return false
    try {
      return (await stat(this.root)).isDirectory()
    } catch {
      return false
    }
  }

  locate(path: string): string {
    return this.full(path)
  }

  relative(locator: string): string | null {
    const rel = relativePath(this.root, locator)
    // « .. » signifie que le chemin sort de la source : on refuse de le servir
    return rel.startsWith('..') ? null : rel
  }

  ffmpegUrl(path: string): string {
    return this.full(path)
  }

  /** Utile pour les tests : chemin absolu exposé tel quel. */
  fileUrl(path: string): string {
    return pathToFileURL(this.full(path)).href
  }

  close(): void {}
}
