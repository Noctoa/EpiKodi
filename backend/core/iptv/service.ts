import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IptvSource } from '@shared/models'
import { iptv, type Database } from '../db'
import { fetchWithTimeout } from '../net'
import { parseM3uChannels, type M3uChannel } from '../playlists/m3u'

/**
 * Listes de chaînes en direct. Une source est une playlist M3U — une URL ou un fichier — dont
 * l'application garde une copie en base, rafraîchie à la demande.
 *
 * Le direct n'est pas téléchargeable : seule la liste l'est. C'est pourquoi rien ici ne
 * ressemble au scanner de la bibliothèque, qui parcourt des fichiers et mesure leur taille.
 */

/** L'index complet d'iptv-org pèse une quinzaine de mégaoctets ; on laisse de la marge. */
const MAX_PLAYLIST_BYTES = 64 * 1024 * 1024

/** Charger la liste peut être long sur un gros fournisseur : plus patient qu'un flux RSS. */
const FETCH_TIMEOUT_MS = 60_000

/**
 * Logos mis en cache au premier import. Une playlist publique en compte des milliers : les
 * télécharger tous bloquerait l'import plusieurs minutes pour des images que personne ne verra.
 * On en prend une première tranche — favorites d'abord, puis l'ordre de la liste — et le reste
 * suit à la demande, quand l'interface en a besoin.
 */
const LOGO_BATCH = 120
const LOGO_CONCURRENCY = 6
const LOGO_TIMEOUT_MS = 10_000
/** Un logo est une petite image ; un fichier plus gros n'en est pas un. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024

export interface ImportResult {
  sourceId: number
  name: string
  /** Chaînes qui n'étaient pas encore connues */
  added: number
  /** Chaînes connues absentes de cette version de la liste */
  missing: number
  total: number
  error: string | null
}

const isUrl = (location: string): boolean => /^https?:\/\//i.test(location)

/** Lit la playlist, qu'elle vienne du réseau ou du disque. */
async function load(location: string): Promise<string> {
  if (!isUrl(location)) {
    const content = await readFile(location, 'utf8')
    if (content.length > MAX_PLAYLIST_BYTES) throw new Error('playlist trop volumineuse')
    return content
  }

  const res = await fetchWithTimeout(location, {}, FETCH_TIMEOUT_MS)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_PLAYLIST_BYTES) throw new Error('playlist trop volumineuse')
  const text = await res.text()
  if (text.length > MAX_PLAYLIST_BYTES) throw new Error('playlist trop volumineuse')
  return text
}

/** « https://iptv-org.github.io/iptv/index.m3u » → « index ». Faute de mieux, le domaine. */
export function suggestName(location: string): string {
  if (!isUrl(location)) return basename(location, extname(location)) || 'Chaînes'
  try {
    const url = new URL(location)
    const file = basename(url.pathname, extname(url.pathname))
    return file || url.hostname
  } catch {
    return 'Chaînes'
  }
}

/**
 * Traduit une entrée de playlist en chaîne. Le nom privilégie `tvg-name`, plus propre que le
 * titre affiché — souvent encombré de mentions de qualité — mais ce dernier reste le repli,
 * car `tvg-name` manque dans beaucoup de listes.
 *
 * L'identité est l'URL du flux : voir la migration 9 pour la raison.
 */
function toChannel(entry: M3uChannel): iptv.ChannelInput | null {
  const streamUrl = entry.path.trim()
  if (!streamUrl) return null
  const name = entry.attributes.tvgName ?? entry.title ?? streamUrl
  return {
    key: streamUrl,
    name,
    streamUrl,
    logoUrl: entry.attributes.tvgLogo,
    group: entry.attributes.groupTitle,
    epgId: entry.attributes.tvgId
  }
}

export function parseChannels(content: string): iptv.ChannelInput[] {
  const seen = new Set<string>()
  const channels: iptv.ChannelInput[] = []
  for (const entry of parseM3uChannels(content)) {
    const channel = toChannel(entry)
    // Une même URL listée deux fois est une seule chaîne : la laisser passer ferait échouer
    // l'insertion sur la contrainte d'unicité au milieu du rafraîchissement.
    if (!channel || seen.has(channel.key)) continue
    seen.add(channel.key)
    channels.push(channel)
  }
  return channels
}

/** Ajoute une liste de chaînes, ou met à jour celle qui occupe déjà cet emplacement. */
export async function addSource(
  db: Database,
  location: string,
  name: string | null,
  logoDir: string
): Promise<ImportResult> {
  const trimmed = location.trim()
  if (!trimmed) throw new Error('aucune URL ni fichier')
  const source = iptv.upsertSource(db, trimmed, name?.trim() || suggestName(trimmed))
  return refresh(db, source.id, logoDir)
}

/**
 * Recharge une liste. Comme pour les podcasts, une erreur réseau est mémorisée sur la source et
 * jamais propagée : une liste injoignable ne doit pas empêcher de regarder les autres.
 */
export async function refresh(
  db: Database,
  sourceId: number,
  logoDir: string
): Promise<ImportResult> {
  const source = iptv.source(db, sourceId)
  if (!source) throw new Error(`source IPTV ${sourceId} introuvable`)

  try {
    const channels = parseChannels(await load(source.location))
    const result = iptv.syncChannels(db, sourceId, channels)
    iptv.markFetched(db, sourceId)
    await cacheLogos(db, sourceId, logoDir)
    return { sourceId, name: source.name, error: null, ...result }
  } catch (err) {
    const message = (err as Error).message
    iptv.markFetched(db, sourceId, message)
    console.warn(`[iptv] rafraîchissement de « ${source.name} » : ${message}`)
    return {
      sourceId,
      name: source.name,
      added: 0,
      missing: iptv.missingCount(db, sourceId),
      total: iptv.count(db, sourceId),
      error: message
    }
  }
}

export async function refreshAll(db: Database, logoDir: string): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  // En série : rafraîchir trois listes de dix mille chaînes en parallèle n'apporte rien et
  // ferait trois fois le travail d'écriture en même temps.
  for (const source of iptv.listSources(db)) {
    results.push(await refresh(db, source.id, logoDir))
  }
  return results
}

/** Supprime la liste, ses chaînes (par cascade) et les logos qu'elle avait mis en cache. */
export async function removeSource(db: Database, sourceId: number): Promise<void> {
  for (const channel of iptv.channels(db, { sourceId, includeMissing: true, limit: 100_000 })) {
    if (channel.logoPath) await rm(channel.logoPath, { force: true })
  }
  iptv.removeSource(db, sourceId)
}

/**
 * Met en cache les logos encore manquants, par petits paquets simultanés. Un logo indisponible
 * n'est pas une erreur : la chaîne garde son `logoUrl` et s'affichera sans image.
 */
export async function cacheLogos(
  db: Database,
  sourceId: number,
  logoDir: string,
  limit = LOGO_BATCH
): Promise<number> {
  const pending = iptv.withoutLogo(db, sourceId, limit)
  if (pending.length === 0) return 0

  await mkdir(logoDir, { recursive: true })
  let cached = 0
  // Un simple curseur partagé : autant de téléchargements en vol que de places, pas plus.
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < pending.length) {
      const channel = pending[next++]
      if (await cacheLogo(db, channel.id, channel.logoUrl!, logoDir)) cached++
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(LOGO_CONCURRENCY, pending.length) }, () => worker())
  )
  return cached
}

async function cacheLogo(
  db: Database,
  channelId: number,
  logoUrl: string,
  logoDir: string
): Promise<boolean> {
  const dest = join(logoDir, `${channelId}${imageExtension(logoUrl)}`)
  try {
    const res = await fetchWithTimeout(logoUrl, {}, LOGO_TIMEOUT_MS)
    if (Number(res.headers.get('content-length') ?? 0) > MAX_LOGO_BYTES) {
      throw new Error('logo trop volumineux')
    }
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(dest)
    )
    iptv.setLogoPath(db, channelId, dest)
    return true
  } catch {
    // Laisser le fichier partiel ferait passer un logo tronqué pour un logo en cache
    await rm(dest, { force: true })
    return false
  }
}

/** Les URL de logo portent une extension lisible ; sinon `.png`, le format le plus courant. */
function imageExtension(url: string): string {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase()
    return /^\.(png|jpe?g|webp|gif|svg)$/.test(extension) ? extension : '.png'
  } catch {
    return '.png'
  }
}

export type { IptvSource }
