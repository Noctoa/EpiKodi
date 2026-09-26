import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'
import { app, BrowserWindow, safeStorage } from 'electron'
import { media, openDatabase, sources, type Database } from './core/db'
import { Enricher } from './core/enricher'
import { checkFfmpeg } from './core/ffmpeg'
import { scanSource } from './core/scanner'
import { startBridge, type Bridge } from './core/storage/bridge'
import {
  createProvider,
  LocalProvider,
  parseLocation,
  suggestName,
  type ByteRange,
  type StorageProvider,
  type StorageStat
} from './core/storage'
import {
  IPC,
  type FfmpegStatus,
  type LibraryChanged,
  type LibraryStats,
  type MediaListQuery,
  type ScanProgress
} from '../shared/ipc'
import type { Facets, MediaWithMetadata, Source } from '../shared/models'

/**
 * Façade de la bibliothèque : cycle de vie de la base SQLite + opérations exposées à l'IPC.
 * Un seul fichier SQLite par utilisateur, dans le dossier de données de l'app.
 */
let db: Database | null = null
let enricher: Enricher | null = null
let ffmpegStatus: FfmpegStatus | null = null

export function databasePath(): string {
  return join(app.getPath('userData'), 'epikodi.db')
}

export function thumbnailDir(): string {
  return join(app.getPath('userData'), 'thumbnails')
}

export function openLibrary(): Database {
  if (!db) {
    db = openDatabase(databasePath())
    console.log(`[library] base ouverte : ${databasePath()}`)
    enricher = new Enricher(db, {
      thumbnailDir: thumbnailDir(),
      resolveUrl: ffmpegUrlFor,
      onDone: () => notifyChanged(),
      onIdle: () => notifyChanged()
    })
  }
  return db
}

// ---- accès au stockage ----

/** Un provider par source, gardé ouvert : une connexion SMB coûte cher à rétablir. */
const providers = new Map<number, StorageProvider>()
let bridge: Bridge | null = null

/**
 * Repli quand le trousseau du système est indisponible (session sans keyring) : le mot de passe
 * vit alors en mémoire, le temps de la session, plutôt que d'être écrit en clair sur le disque.
 */
const sessionPasswords = new Map<number, string>()

/** Mot de passe déchiffré à la demande ; jamais conservé en clair au-delà du provider. */
function passwordOf(source: Source): string | null {
  const inMemory = sessionPasswords.get(source.id)
  if (inMemory) return inMemory
  const encrypted = sources.credentials(openLibrary(), source.id)
  if (!encrypted) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted))
  } catch (err) {
    console.warn(`[library] identifiants illisibles pour ${source.name} :`, err)
    return null
  }
}

export function providerFor(source: Source): StorageProvider {
  let provider = providers.get(source.id)
  if (!provider) {
    provider = createProvider(source, passwordOf(source))
    providers.set(source.id, provider)
  }
  return provider
}

/** Miniatures et affiches : fichiers de l'application, hors de toute source déclarée. */
let thumbnails: LocalProvider | null = null
function thumbnailProvider(): LocalProvider {
  thumbnails ??= new LocalProvider(thumbnailDir())
  return thumbnails
}

/**
 * Retrouve la source à laquelle appartient un fichier, et son chemin relatif. Seuls les fichiers
 * d'une source déclarée — ou les miniatures produites par l'application — sont servis.
 */
function resolve(locator: string): { provider: StorageProvider; path: string } | null {
  for (const source of sources.list(openLibrary())) {
    const provider = providerFor(source)
    const path = provider.relative(locator)
    if (path !== null) return { provider, path }
  }
  const thumb = thumbnailProvider().relative(locator)
  return thumb === null ? null : { provider: thumbnailProvider(), path: thumb }
}

export async function readMedia(locator: string, range?: ByteRange): Promise<Readable> {
  const found = resolve(locator)
  if (!found) throw new Error(`aucune source ne contient ${locator}`)
  return found.provider.read(found.path, range)
}

export async function statMedia(locator: string): Promise<StorageStat> {
  const found = resolve(locator)
  if (!found) throw new Error(`aucune source ne contient ${locator}`)
  return found.provider.stat(found.path)
}

/**
 * URL lisible par ffmpeg / ffprobe. Un fichier local garde son chemin, un fichier HTTP son URL ;
 * un fichier SMB passe par le pont local, faute de protocole smb:// dans ffmpeg.
 */
export async function ffmpegUrlFor(locator: string): Promise<string> {
  const found = resolve(locator)
  if (!found) return locator
  const direct = found.provider.ffmpegUrl(found.path)
  if (direct) return direct
  bridge ??= await startBridge({ read: readMedia, stat: statMedia })
  return bridge.url(locator)
}

export function closeLibrary(): void {
  for (const ctrl of running.values()) ctrl.abort()
  enricher?.stop()
  enricher = null
  for (const provider of providers.values()) provider.close()
  providers.clear()
  bridge?.close()
  bridge = null
  db?.close()
  db = null
}

export async function getFfmpegStatus(): Promise<FfmpegStatus> {
  if (!ffmpegStatus) {
    ffmpegStatus = await checkFfmpeg()
    if (!ffmpegStatus.ffprobe) console.warn('[library] ffprobe introuvable : pas d’enrichissement')
  }
  return ffmpegStatus
}

/** Met en file l'analyse ffprobe des médias en attente (tous, ou ceux d'une source). */
export function enrichPending(sourceId?: number): void {
  void getFfmpegStatus().then((st) => {
    if (st.ffprobe && enricher) enricher.enqueueUnprobed(sourceId)
  })
}

// Prévient toutes les fenêtres que l'affichage doit être rechargé, au plus 2 fois par seconde
let notifyTimer: NodeJS.Timeout | null = null
function notifyChanged(): void {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    const payload: LibraryChanged = { enrichPending: enricher?.pending ?? 0 }
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send(IPC.libraryChanged, payload)
  }, 500)
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

export function listSources(): Source[] {
  return sources.list(openLibrary())
}

export function addSource(path: string): Source {
  const d = openLibrary()
  const existing = sources.list(d).find((s) => s.path === path)
  if (existing) return existing
  return sources.create(d, { type: 'local', path, name: basename(path) || path })
}

/**
 * Déclare une source réseau (`smb://…`, `https://…`). Le mot de passe est chiffré par le
 * trousseau du système avant d'être stocké ; l'URL conservée n'en contient jamais.
 */
export function addNetworkSource(url: string, password: string | null): Source {
  const d = openLibrary()
  const location = parseLocation(url)
  const clean = url.replace(/:\/\/([^@/]*):([^@/]*)@/, '://$1@')
  const existing = sources.list(d).find((s) => s.path === clean)
  const source =
    existing ?? sources.create(d, { type: location.type, path: clean, name: suggestName(location) })

  const secret = password ?? location.password
  if (secret) {
    if (safeStorage.isEncryptionAvailable()) {
      sources.setCredentials(d, source.id, safeStorage.encryptString(secret))
      sessionPasswords.delete(source.id)
    } else {
      console.warn('[library] trousseau indisponible : mot de passe gardé en mémoire seulement')
      sessionPasswords.set(source.id, secret)
    }
  }
  providers.delete(source.id)
  return sources.get(d, source.id)!
}

/** État de toutes les sources, testées en parallèle. */
export async function sourcesAvailability(): Promise<Record<number, boolean>> {
  const list = sources.list(openLibrary())
  const results = await Promise.all(list.map((s) => sourceAvailable(s.id)))
  return Object.fromEntries(list.map((s, i) => [s.id, results[i]]))
}

/** Teste qu'une source répond, sans jamais lever : une source morte ne bloque pas l'application. */
export async function sourceAvailable(id: number): Promise<boolean> {
  const source = sources.get(openLibrary(), id)
  if (!source) return false
  try {
    return await providerFor(source).available()
  } catch {
    return false
  }
}

export function removeSource(id: number): void {
  cancelScan(id)
  providers.get(id)?.close()
  providers.delete(id)
  sessionPasswords.delete(id)
  sources.remove(openLibrary(), id)
}

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

  // Le provider de la source porte ses identifiants : en créer un autre scannerait sans mot de passe
  void scanSource(d, source, { onProgress, signal: ctrl.signal, provider: providerFor(source) })
    .then((p) => {
      if (!ctrl.signal.aborted) sources.markScanned(d, id)
      console.log(`[scan] fin : +${p.added} ~${p.updated} -${p.removed} (${p.scanned} fichiers)`)
      enrichPending(id)
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

export function scanAllSources(onProgress: (p: ScanProgress) => void): void {
  for (const s of listSources()) startScan(s.id, onProgress)
}

export function cancelScan(id: number): void {
  running.get(id)?.abort()
}

export function listMedia(query: MediaListQuery = {}): MediaWithMetadata[] {
  return media.listWithMetadata(openLibrary(), query)
}

export function mediaFacets(): Facets {
  return media.facets(openLibrary())
}
