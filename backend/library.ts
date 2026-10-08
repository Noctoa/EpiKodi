import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'
import { app, BrowserWindow, safeStorage } from 'electron'
import {
  media,
  openDatabase,
  playback,
  playlists as playlistRepo,
  podcasts,
  settings,
  sources,
  type Database
} from './core/db'
import { Enricher } from './core/enricher'
import { checkFfmpeg } from './core/ffmpeg'
import { scanSource } from './core/scanner'
import { startBridge, type Bridge } from './core/storage/bridge'
import { applyMatch, Identifier, suggestMatches } from './core/metadata/identify'
import { TmdbProvider } from './core/metadata/tmdb'
import {
  listProviders,
  registerProvider,
  type MetadataDetails,
  type MetadataMatch
} from './core/metadata/types'
import { PluginManager, type BrokenPlugin, type PluginInfo } from './core/plugins/manager'
import { PluginMetadataProvider } from './core/plugins/provider-adapter'
import * as podcastService from './core/podcasts/service'
import { matchEntries, parseM3u, playlistFileName, serializeM3u } from './core/playlists/m3u'
import { discoverThemes, type DiscoveredThemes } from './core/themes/loader'
import {
  createProvider,
  LocalProvider,
  parseLocation,
  RemoteFileProvider,
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
import type {
  Facets,
  MediaWithMetadata,
  Playlist,
  Podcast,
  PodcastEpisode,
  Source
} from '../shared/models'

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

/** Épisodes téléchargés pour l'écoute hors ligne. */
export function podcastDir(): string {
  return join(app.getPath('userData'), 'podcasts')
}

/** Pochettes des podcasts, mises en cache pour s'afficher sans réseau. */
export function podcastImageDir(): string {
  return join(app.getPath('userData'), 'podcast-covers')
}

/** Affiches et images de fond issues des sources externes. */
export function posterDir(): string {
  return join(app.getPath('userData'), 'posters')
}

/** Un sous-dossier par extension installée. */
export function pluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

/** Un sous-dossier par thème personnalisé, chacun avec son `theme.json`. */
export function themesDir(): string {
  return join(app.getPath('userData'), 'themes')
}

export function openLibrary(): Database {
  if (!db) {
    db = openDatabase(databasePath())
    console.log(`[library] base ouverte : ${databasePath()}`)
    tmdb.setApiKey(
      (() => {
        const stored = settings.getRaw(db, TMDB_KEY_SETTING)
        if (!stored) return null
        try {
          return safeStorage.decryptString(Buffer.from(stored))
        } catch {
          return Buffer.from(stored).toString('utf8')
        }
      })()
    )
    enricher = new Enricher(db, {
      thumbnailDir: thumbnailDir(),
      resolveUrl: ffmpegUrlFor,
      onDone: () => notifyChanged(),
      onIdle: () => {
        notifyChanged()
        identifyPending()
      }
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

/** Fichiers produits par l'application elle-même, hors de toute source déclarée. */
let thumbnails: LocalProvider | null = null
let covers: LocalProvider | null = null
let downloads: LocalProvider | null = null
let posters: LocalProvider | null = null

function thumbnailProvider(): LocalProvider {
  thumbnails ??= new LocalProvider(thumbnailDir())
  return thumbnails
}
function coverProvider(): LocalProvider {
  covers ??= new LocalProvider(podcastImageDir())
  return covers
}
function downloadProvider(): LocalProvider {
  downloads ??= new LocalProvider(podcastDir())
  return downloads
}
function posterProvider(): LocalProvider {
  posters ??= new LocalProvider(posterDir())
  return posters
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
  if (thumb !== null) return { provider: thumbnailProvider(), path: thumb }

  const cover = coverProvider().relative(locator)
  if (cover !== null) return { provider: coverProvider(), path: cover }

  const poster = posterProvider().relative(locator)
  if (poster !== null) return { provider: posterProvider(), path: poster }

  // Épisode de podcast : soit sa copie téléchargée, soit le flux distant
  const episode = podcasts.episodeByUrl(openLibrary(), locator)
  if (episode) {
    if (episode.localPath === locator) {
      const local = downloadProvider().relative(locator)
      if (local !== null) return { provider: downloadProvider(), path: local }
    }
    return { provider: new RemoteFileProvider(episode.audioUrl), path: '' }
  }
  return null
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

// ---- métadonnées externes ----

const TMDB_KEY_SETTING = 'tmdb.apiKey'
const tmdb = new TmdbProvider(null)
registerProvider(tmdb)
let identifier: Identifier | null = null

/** La clé est chiffrée par le trousseau du système, jamais écrite en clair. */
export function tmdbApiKey(): string | null {
  const stored = settings.getRaw(openLibrary(), TMDB_KEY_SETTING)
  if (!stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored))
  } catch {
    // Trousseau indisponible au moment de l'écriture : la valeur est alors en clair
    return Buffer.from(stored).toString('utf8')
  }
}

export function setTmdbApiKey(key: string | null): void {
  const d = openLibrary()
  const trimmed = key?.trim() || null
  if (!trimmed) {
    settings.setRaw(d, TMDB_KEY_SETTING, null)
  } else if (safeStorage.isEncryptionAvailable()) {
    settings.setRaw(d, TMDB_KEY_SETTING, safeStorage.encryptString(trimmed))
  } else {
    console.warn('[tmdb] trousseau indisponible : la clé est stockée sans chiffrement')
    settings.setText(d, TMDB_KEY_SETTING, trimmed)
  }
  tmdb.setApiKey(trimmed)
  if (trimmed) identifyPending()
}

export function tmdbConfigured(): boolean {
  return tmdb.configured()
}

/** Met en file l'identification des vidéos pas encore traitées. */
export function identifyPending(): void {
  if (!tmdb.configured()) return
  identifier ??= new Identifier(openLibrary(), {
    imageDir: posterDir(),
    provider: tmdb,
    onDone: () => notifyChanged(),
    onIdle: () => notifyChanged()
  })
  identifier.enqueueUnidentified()
}

export function identifyingCount(): number {
  return identifier?.pending ?? 0
}

/**
 * Candidats proposés pour « Corriger l'identification ». Toutes les sources configurées sont
 * interrogées — TheMovieDB et celles apportées par des extensions — et leurs résultats fusionnés.
 */
export async function matchesFor(mediaId: number, query?: string): Promise<MetadataMatch[]> {
  const configured = listProviders().filter((p) => p.configured())
  const results = await Promise.all(
    configured.map((provider) =>
      suggestMatches(openLibrary(), mediaId, provider, query).catch((err: Error) => {
        console.warn(`[metadata] ${provider.name} : ${err.message}`)
        return [] as MetadataMatch[]
      })
    )
  )
  return results.flat().sort((a, b) => b.score - a.score)
}

/** Applique un choix manuel de l'utilisateur. */
export async function applyMatchTo(mediaId: number, externalId: string): Promise<void> {
  const provider = listProviders().find((p) => externalId.startsWith(`${p.id}:`)) ?? tmdb
  const details: MetadataDetails | null = await provider.details(externalId)
  if (details) await applyMatch(openLibrary(), mediaId, details, posterDir())
}

// ---- thèmes ----

const THEME_SETTING = 'ui.theme'

/** Identifiant du thème choisi ; « system » par défaut. */
export function selectedTheme(): string {
  return settings.getText(openLibrary(), THEME_SETTING) ?? 'system'
}

export function setSelectedTheme(id: string): void {
  settings.setText(openLibrary(), THEME_SETTING, id)
}

/**
 * Thèmes disponibles : les intégrés, ceux du dossier `themes/`, et ceux livrés par une
 * extension. Le dossier est créé s'il manque, pour que l'utilisateur puisse y déposer un thème.
 */
export async function listThemes(): Promise<
  DiscoveredThemes & { selected: string; directory: string }
> {
  await mkdir(themesDir(), { recursive: true }).catch(() => undefined)
  const pluginDirs = plugins ? plugins.list().map((p) => p.dir) : []
  const { themes, broken } = await discoverThemes(themesDir(), pluginDirs)
  return { themes, broken, selected: selectedTheme(), directory: themesDir() }
}

// ---- extensions ----

const PLUGIN_ENABLED_PREFIX = 'plugin.enabled.'
let plugins: PluginManager | null = null

export function pluginManager(): PluginManager {
  plugins ??= new PluginManager({
    pluginsDir: pluginsDir(),
    // Compilé à côté de l'application : c'est lui qui est lancé dans chaque process isolé
    hostScript: join(__dirname, 'plugin-host.js'),
    isEnabled: (id) => settings.getText(openLibrary(), `${PLUGIN_ENABLED_PREFIX}${id}`) === '1',
    setEnabled: (id, enabled) =>
      settings.setText(openLibrary(), `${PLUGIN_ENABLED_PREFIX}${id}`, enabled ? '1' : null),
    onChanged: () => {
      syncPluginProviders()
      notifyChanged()
    }
  })
  return plugins
}

/**
 * Déclare auprès du registre de métadonnées les fournisseurs apportés par les plugins actifs.
 * Le cœur de l'application ne les distingue pas de TheMovieDB.
 */
function syncPluginProviders(): void {
  for (const info of pluginManager().metadataPlugins()) {
    registerProvider(new PluginMetadataProvider(pluginManager(), info))
  }
}

/** Découvre les extensions et démarre celles qui sont activées. */
export async function startPlugins(): Promise<void> {
  // Les dossiers doivent exister avant que l'utilisateur n'y copie quoi que ce soit : sinon
  // `cp -r mon-plugin plugins/` renomme le plugin en « plugins » au lieu de l'y déposer.
  await Promise.all([
    mkdir(pluginsDir(), { recursive: true }).catch(() => undefined),
    mkdir(themesDir(), { recursive: true }).catch(() => undefined)
  ])
  const manager = pluginManager()
  await manager.discover()
  await manager.activateEnabled()
  syncPluginProviders()
}

export function listPlugins(): { plugins: PluginInfo[]; broken: BrokenPlugin[] } {
  const manager = pluginManager()
  return { plugins: manager.list(), broken: manager.brokenPlugins() }
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  await pluginManager().setEnabled(id, enabled)
  syncPluginProviders()
}

/** Prévient les extensions qu'un événement de la bibliothèque a eu lieu. */
export function emitToPlugins(name: string, payload: unknown): void {
  plugins?.emit(name, payload)
}

export function closeLibrary(): void {
  for (const ctrl of running.values()) ctrl.abort()
  enricher?.stop()
  enricher = null
  identifier?.stop()
  identifier = null
  plugins?.stopAll()
  plugins = null
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

// ---- podcasts ----

export function listPodcasts(): Podcast[] {
  return podcasts.list(openLibrary())
}

export function podcastEpisodes(podcastId: number): PodcastEpisode[] {
  return podcasts.episodes(openLibrary(), podcastId)
}

export function podcastUnplayed(podcastId: number): number {
  return podcasts.unplayedCount(openLibrary(), podcastId)
}

export function subscribePodcast(feedUrl: string): Promise<podcastService.RefreshResult> {
  return podcastService.subscribe(openLibrary(), feedUrl.trim(), podcastImageDir())
}

export function refreshPodcast(id: number): Promise<podcastService.RefreshResult> {
  return podcastService.refresh(openLibrary(), id, podcastImageDir())
}

/** Au démarrage : met les abonnements à jour en tâche de fond, sans bloquer l'interface. */
export function refreshPodcasts(): Promise<podcastService.RefreshResult[]> {
  return podcastService.refreshAll(openLibrary(), podcastImageDir())
}

export function removePodcast(id: number): void {
  podcasts.remove(openLibrary(), id)
}

export function downloadEpisode(
  id: number,
  onProgress?: (p: podcastService.DownloadProgress) => void
): Promise<string> {
  return podcastService.downloadEpisode(openLibrary(), id, podcastDir(), onProgress)
}

export function removeEpisodeDownload(id: number): Promise<void> {
  return podcastService.removeDownload(openLibrary(), id)
}

export function saveEpisodeProgress(id: number, position: number, completed?: boolean): void {
  podcasts.saveProgress(openLibrary(), id, position, completed)
}

export function setEpisodeCompleted(id: number, completed: boolean): void {
  podcasts.setCompleted(openLibrary(), id, completed)
}

export function searchPodcasts(term: string): Promise<podcastService.PodcastSearchResult[]> {
  return podcastService.search(term)
}

// ---- playlists, favoris et reprise de lecture ----

export interface PlaylistSummary extends Playlist {
  count: number
  /** Durée cumulée, en secondes */
  duration: number
}

export function listPlaylists(): PlaylistSummary[] {
  const d = openLibrary()
  return playlistRepo.list(d).map((p) => {
    const items = playlistRepo.items(d, p.id)
    return {
      ...p,
      count: items.length,
      duration: items.reduce((total, m) => total + (m.duration ?? 0), 0)
    }
  })
}

export function createPlaylist(name: string): Playlist {
  return playlistRepo.create(openLibrary(), name.trim() || 'Nouvelle playlist')
}

export function renamePlaylist(id: number, name: string): void {
  playlistRepo.rename(openLibrary(), id, name.trim() || 'Sans titre')
}

export function removePlaylist(id: number): void {
  playlistRepo.remove(openLibrary(), id)
}

/** Contenu d'une playlist, avec métadonnées, dans l'ordre choisi par l'utilisateur. */
export function playlistItems(id: number): MediaWithMetadata[] {
  const d = openLibrary()
  const ordered = playlistRepo.items(d, id)
  const detailed = new Map(
    media.listWithMetadata(d, { limit: Number.MAX_SAFE_INTEGER }).map((m) => [m.id, m])
  )
  return ordered.map((m) => detailed.get(m.id) ?? { ...m, metadata: null })
}

export function addToPlaylist(playlistId: number, mediaId: number): void {
  playlistRepo.addItem(openLibrary(), playlistId, mediaId)
}

export function removeFromPlaylist(playlistId: number, mediaId: number): void {
  playlistRepo.removeItem(openLibrary(), playlistId, mediaId)
}

export function reorderPlaylist(playlistId: number, mediaIds: number[]): void {
  playlistRepo.reorder(openLibrary(), playlistId, mediaIds)
}

/** Écrit la playlist au format M3U, lisible par VLC, Kodi et les autres. */
export async function exportPlaylist(id: number, filePath: string): Promise<void> {
  const items = playlistItems(id)
  await writeFile(
    filePath,
    serializeM3u(items.map((m) => ({ path: m.path, duration: m.duration, title: m.title }))),
    'utf8'
  )
}

export function suggestPlaylistFileName(id: number): string {
  return playlistFileName(playlistRepo.get(openLibrary(), id)?.name ?? 'playlist')
}

export interface ImportResult {
  playlistId: number
  name: string
  /** Médias retrouvés en bibliothèque */
  imported: number
  /** Lignes dont le fichier n'est pas (ou plus) dans la bibliothèque */
  missing: number
}

/**
 * Crée une playlist depuis un fichier M3U. Seules les entrées déjà présentes en bibliothèque
 * sont ajoutées : importer un fichier n'indexe pas de nouveaux médias.
 */
export async function importPlaylist(filePath: string, name: string): Promise<ImportResult> {
  const d = openLibrary()
  const entries = parseM3u(await readFile(filePath, 'utf8'))
  const byPath = new Map(
    media.list(d, { limit: Number.MAX_SAFE_INTEGER }).map((m) => [m.path, m.id])
  )

  const { mediaIds, missing } = matchEntries(entries, byPath)
  const playlist = playlistRepo.create(d, name)
  for (const mediaId of mediaIds) playlistRepo.addItem(d, playlist.id, mediaId)
  return {
    playlistId: playlist.id,
    name: playlist.name,
    imported: mediaIds.length,
    missing: missing.length
  }
}

// ---- favoris et position de lecture ----

export function toggleFavorite(mediaId: number): boolean {
  const d = openLibrary()
  const favorite = !(playback.get(d, mediaId)?.favorite ?? false)
  playback.setFavorite(d, mediaId, favorite)
  return favorite
}

export function favoriteMedia(): MediaWithMetadata[] {
  const d = openLibrary()
  const ids = new Set(playback.favorites(d).map((s) => s.mediaId))
  return media.listWithMetadata(d, { limit: Number.MAX_SAFE_INTEGER }).filter((m) => ids.has(m.id))
}

/** Position de lecture et favori d'un média, pour l'affichage. */
export function playbackStateOf(mediaId: number): {
  position: number
  completed: boolean
  favorite: boolean
} {
  const state = playback.get(openLibrary(), mediaId)
  return {
    position: state?.position ?? 0,
    completed: state?.completed ?? false,
    favorite: state?.favorite ?? false
  }
}

export function savePlaybackPosition(mediaId: number, position: number, completed = false): void {
  playback.savePosition(openLibrary(), mediaId, position, completed)
}

export function startedPlayback(mediaId: number): void {
  playback.incrementPlayCount(openLibrary(), mediaId)
}

/** « Continuer à regarder » : médias entamés mais pas terminés, du plus récent au plus ancien. */
export function continueWatching(limit = 12): (MediaWithMetadata & { position: number })[] {
  const d = openLibrary()
  const states = playback.inProgress(d, limit)
  const detailed = new Map(
    media.listWithMetadata(d, { limit: Number.MAX_SAFE_INTEGER }).map((m) => [m.id, m])
  )
  return states
    .map((s) => {
      const item = detailed.get(s.mediaId)
      return item ? { ...item, position: s.position } : null
    })
    .filter((m): m is MediaWithMetadata & { position: number } => m !== null)
}
