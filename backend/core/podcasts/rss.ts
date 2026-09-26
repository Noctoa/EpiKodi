import { XMLParser } from 'fast-xml-parser'

export interface FeedInfo {
  title: string
  description: string | null
  author: string | null
  website: string | null
  imageUrl: string | null
}

export interface FeedEpisode {
  /** Identifiant stable dans le flux ; à défaut de `guid`, l'URL du fichier fait office */
  guid: string
  title: string
  description: string | null
  audioUrl: string
  mime: string | null
  size: number | null
  /** Secondes, si le flux l'annonce */
  duration: number | null
  /** Timestamp Unix de publication */
  publishedAt: number | null
  imageUrl: string | null
}

export interface ParsedFeed {
  feed: FeedInfo
  episodes: FeedEpisode[]
}

/** Un flux peut annoncer des centaines d'épisodes ; on garde les plus récents. */
export const MAX_EPISODES = 500

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // `item` et les catégories peuvent apparaître une seule fois : on force le tableau
  isArray: (name) => name === 'item' || name === 'entry'
})

type Node = Record<string, unknown>

const asNode = (value: unknown): Node | null =>
  value && typeof value === 'object' ? (value as Node) : null

/** Valeur texte d'une balise, qu'elle soit simple, en CDATA ou porteuse d'attributs. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  const node = asNode(value)
  const inner = node?.['#text']
  return typeof inner === 'string' || typeof inner === 'number'
    ? String(inner).trim() || null
    : null
}

/** Première valeur non vide parmi plusieurs balises équivalentes. */
const firstText = (node: Node, ...keys: string[]): string | null => {
  for (const key of keys) {
    const value = text(node[key])
    if (value) return value
  }
  return null
}

const attr = (value: unknown, name: string): string | null => {
  const node = asNode(value)
  const raw = node?.[`@_${name}`]
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() || null : null
}

/** Les descriptions contiennent souvent du HTML : on en tire un texte lisible. */
export function stripHtml(html: string | null): string | null {
  if (!html) return null
  const plain = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return plain || null
}

/**
 * `itunes:duration` s'écrit en secondes (« 1590 »), en « MM:SS » ou en « HH:MM:SS ».
 * Retourne des secondes, ou null si la valeur est inexploitable.
 */
export function parseDuration(value: string | null): number | null {
  if (!value) return null
  const parts = value.split(':').map((p) => Number(p.trim()))
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null
  const seconds =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts.length === 3
          ? parts[0] * 3600 + parts[1] * 60 + parts[2]
          : NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

const parseDate = (value: string | null): number | null => {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/** Image d'un canal ou d'un épisode : `itunes:image href` ou `<image><url>`. */
function imageOf(node: Node): string | null {
  const itunes = attr(node['itunes:image'], 'href')
  if (itunes) return itunes
  const image = asNode(node['image'])
  return image ? text(image['url']) : null
}

/**
 * Analyse un flux RSS de podcast. Tolérant : un épisode sans fichier audio est ignoré plutôt
 * que de faire échouer tout le flux, et les balises absentes donnent `null`.
 */
export function parseFeed(xml: string): ParsedFeed {
  const root = asNode(parser.parse(xml))
  const channel = asNode(asNode(root?.['rss'])?.['channel']) ?? asNode(root?.['channel'])
  if (!channel) throw new Error('flux illisible : aucune balise <channel>')

  const feed: FeedInfo = {
    title: firstText(channel, 'title', 'itunes:title') ?? 'Podcast sans titre',
    description: stripHtml(firstText(channel, 'description', 'itunes:summary', 'itunes:subtitle')),
    author: firstText(channel, 'itunes:author', 'managingEditor'),
    website: firstText(channel, 'link'),
    imageUrl: imageOf(channel)
  }

  const items = Array.isArray(channel['item']) ? (channel['item'] as Node[]) : []
  const episodes: FeedEpisode[] = []
  for (const item of items) {
    const enclosure = item['enclosure']
    const audioUrl = attr(enclosure, 'url') ?? attr(item['media:content'], 'url')
    if (!audioUrl) continue // épisode sans fichier : rien à lire

    const guid = firstText(item, 'guid') ?? audioUrl
    const size = Number(attr(enclosure, 'length') ?? NaN)
    episodes.push({
      guid,
      title: firstText(item, 'title') ?? 'Épisode sans titre',
      description: stripHtml(firstText(item, 'description', 'itunes:summary', 'itunes:subtitle')),
      audioUrl,
      mime: attr(enclosure, 'type'),
      size: Number.isFinite(size) && size > 0 ? size : null,
      duration: parseDuration(firstText(item, 'itunes:duration')),
      publishedAt: parseDate(firstText(item, 'pubDate')),
      imageUrl: imageOf(item)
    })
  }

  // Du plus récent au plus ancien, les épisodes sans date à la fin
  episodes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  return { feed, episodes: episodes.slice(0, MAX_EPISODES) }
}
