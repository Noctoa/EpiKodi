import { XMLParser } from 'fast-xml-parser'

/**
 * Guide des programmes au format XMLTV. Pur et testé : aucun accès réseau ni disque ici.
 *
 * Un guide réel pèse vite plus de cent mégaoctets (xmltvfr.fr : 144 Mo, 213 000 programmes) :
 * le construire en un seul arbre XML figerait le process principal plusieurs secondes et
 * consommerait des gigaoctets. Le document est donc lu au fil de l'eau (`XmltvReader`), un
 * élément `<channel>` ou `<programme>` à la fois — la structure de XMLTV est plate, chaque
 * élément se suffit à lui-même.
 */

export interface XmltvChannel {
  id: string
  displayName: string | null
  iconUrl: string | null
}

export interface XmltvProgramme {
  /** Identifiant de chaîne du guide, à rapprocher du `tvg-id` des playlists */
  channel: string
  /** Timestamps Unix, en secondes */
  start: number
  stop: number | null
  title: string
  subtitle: string | null
  description: string | null
  category: string | null
  iconUrl: string | null
  /** « S2 E5 », ou ce que le guide écrit lui-même */
  episode: string | null
}

/** Abréviations de fuseau rencontrées dans les guides, en minutes. La DTD cite `BST`. */
const ZONES: Record<string, number> = {
  Z: 0,
  UTC: 0,
  GMT: 0,
  BST: 60,
  CET: 60,
  CEST: 120,
  EST: -300,
  EDT: -240
}

const TIME =
  /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2})|([A-Z]{1,4}))?$/

/**
 * `20261028001500 +0100` → timestamp Unix. La DTD autorise une date tronquée (`200209`), un
 * décalage numérique ou une abréviation (`BST`), et dit : sans fuseau explicite, c'est de l'UTC.
 * Pure, testée.
 */
export function parseXmltvTime(value: string | null | undefined): number | null {
  const m = TIME.exec((value ?? '').trim())
  if (!m) return null
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh, om, zone] = m
  let offset = 0
  if (sign) offset = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om))
  else if (zone) {
    if (!(zone in ZONES)) return null
    offset = ZONES[zone]
  }
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return Number.isFinite(utc) ? Math.floor(utc / 1000) - offset * 60 : null
}

/**
 * Numéro d'épisode. `onscreen` est déjà lisible ; `xmltv_ns` compte à partir de zéro, sous la
 * forme `saison.épisode.partie` (`1.4.` = saison 2, épisode 5), chaque partie pouvant manquer.
 */
export function formatEpisode(system: string | null, value: string | null): string | null {
  const raw = value?.trim()
  if (!raw) return null
  if (system !== 'xmltv_ns') return raw
  const [season, episode] = raw.split('.').map((p) => {
    const n = Number(p.split('/')[0].trim())
    return p.trim() && Number.isFinite(n) ? n + 1 : null
  })
  const parts = [season ? `S${season}` : null, episode ? `E${episode}` : null].filter(Boolean)
  return parts.join(' ') || null
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // Une balise répétée (titres en plusieurs langues, catégories) donne un tableau ; une seule,
  // un objet. On force le tableau pour ne traiter qu'un cas.
  isArray: (name) =>
    ['title', 'sub-title', 'desc', 'category', 'display-name', 'episode-num', 'icon'].includes(name)
})

type Node = Record<string, unknown>

const asNode = (value: unknown): Node | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : null

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  const inner = asNode(value)?.['#text']
  return typeof inner === 'string' || typeof inner === 'number'
    ? String(inner).trim() || null
    : null
}

const attr = (value: unknown, name: string): string | null => {
  const raw = asNode(value)?.[`@_${name}`]
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() || null : null
}

/**
 * Première valeur d'une balise répétée, en préférant la langue demandée : un guide peut donner le
 * titre en plusieurs langues, l'ordre n'y est pas garanti.
 */
function pick(values: unknown, lang: string): string | null {
  const list = Array.isArray(values) ? values : []
  const preferred = list.find((v) => attr(v, 'lang')?.toLowerCase().startsWith(lang))
  return text(preferred) ?? list.map(text).find(Boolean) ?? null
}

function toChannel(node: Node): XmltvChannel | null {
  const id = attr(node, 'id')
  if (!id) return null
  const icons = Array.isArray(node['icon']) ? node['icon'] : []
  return {
    id,
    displayName: pick(node['display-name'], 'fr'),
    iconUrl: attr(icons[0], 'src')
  }
}

function toProgramme(node: Node, lang: string): XmltvProgramme | null {
  const channel = attr(node, 'channel')
  const start = parseXmltvTime(attr(node, 'start'))
  const title = pick(node['title'], lang)
  // Sans chaîne, sans début ou sans titre, une entrée ne peut ni se placer ni s'afficher
  if (!channel || start === null || !title) return null
  const stop = parseXmltvTime(attr(node, 'stop'))
  const episodes = Array.isArray(node['episode-num']) ? node['episode-num'] : []
  const onscreen = episodes.find((e) => attr(e, 'system') === 'onscreen')
  const episode = onscreen ?? episodes[0]
  const icons = Array.isArray(node['icon']) ? node['icon'] : []
  return {
    channel,
    start,
    // Un arrêt absent ou incohérent vaut une absence : le début du suivant en tiendra lieu
    stop: stop !== null && stop > start ? stop : null,
    title,
    subtitle: pick(node['sub-title'], lang),
    description: pick(node['desc'], lang),
    category: pick(node['category'], lang),
    iconUrl: attr(icons[0], 'src'),
    episode: episode ? formatEpisode(attr(episode, 'system'), text(episode)) : null
  }
}

export interface XmltvBatch {
  channels: XmltvChannel[]
  programmes: XmltvProgramme[]
}

const OPENERS = ['<channel', '<programme'] as const
const CLOSERS: Record<(typeof OPENERS)[number], string> = {
  '<channel': '</channel>',
  '<programme': '</programme>'
}
const CHANNEL_ATTR = /\schannel\s*=\s*"([^"]*)"/

export interface XmltvReaderOptions {
  /**
   * Programmes à garder, d'après l'identifiant de chaîne. Les autres sont écartés avant d'être
   * analysés : un guide national couvre des centaines de chaînes dont on n'a que quelques-unes.
   */
  wantChannel?: (id: string) => boolean
  /** Langue préférée quand un guide donne plusieurs titres (`fr` par défaut) */
  lang?: string
}

/**
 * Lecture incrémentale d'un guide XMLTV : on lui donne le texte morceau par morceau, il rend les
 * éléments complets au fur et à mesure et garde le reste pour le morceau suivant.
 */
export class XmltvReader {
  private buffer = ''
  private sawRoot = false
  private readonly want: (id: string) => boolean
  private readonly lang: string

  constructor(options: XmltvReaderOptions = {}) {
    this.want = options.wantChannel ?? (() => true)
    this.lang = options.lang ?? 'fr'
  }

  /** Position de la prochaine occurrence de chaque balise ouvrante, -1 si aucune dans le tampon */
  private found = new Map<string, number>()

  push(chunk: string): XmltvBatch {
    this.buffer += chunk
    this.found.clear()
    if (!this.sawRoot && /<tv[\s>]/.test(this.buffer)) this.sawRoot = true
    const batch: XmltvBatch = { channels: [], programmes: [] }

    let pos = 0
    for (;;) {
      const next = this.nextElement(pos)
      if (!next) break
      const close = this.buffer.indexOf(CLOSERS[next.opener], next.at)
      const selfClose = this.buffer.indexOf('/>', next.at)
      const tagEnd = this.buffer.indexOf('>', next.at)
      // Élément sans contenu (`<channel id="x"/>`) : il se termine avec sa balise ouvrante
      const end =
        tagEnd >= 0 && selfClose >= 0 && selfClose + 1 === tagEnd
          ? tagEnd + 1
          : close >= 0
            ? close + CLOSERS[next.opener].length
            : -1
      if (end < 0) {
        pos = next.at
        break // élément incomplet : il finira dans un prochain morceau
      }
      this.collect(next.opener, this.buffer.slice(next.at, end), batch)
      pos = end
    }
    // Ce qui précède le prochain élément est consommé ; s'il n'y en a pas, on ne garde qu'une
    // fin de morceau assez longue pour contenir le début d'une balise coupée en deux.
    const keepFrom = this.nextElement(pos)?.at ?? Math.max(pos, this.buffer.length - 16)
    this.buffer = this.buffer.slice(keepFrom)
    this.found.clear()
    return batch
  }

  /** Fin du document : un élément resté incomplet est abandonné. */
  end(): void {
    if (!this.sawRoot) throw new Error('ce document n’est pas un guide XMLTV')
    this.buffer = ''
  }

  private nextElement(from: number): { at: number; opener: (typeof OPENERS)[number] } | null {
    let best: { at: number; opener: (typeof OPENERS)[number] } | null = null
    for (const opener of OPENERS) {
      // Chercher à nouveau à chaque élément rendrait la lecture quadratique : dans la section des
      // programmes, `<channel` n'existe plus et chaque recherche parcourrait tout le tampon.
      let at = this.found.get(opener)
      if (at === undefined || (at >= 0 && at < from)) {
        at = this.buffer.indexOf(opener, from)
        // `<channel` ne doit pas attraper `<channels` ni un autre nom qui commencerait pareil
        while (at >= 0 && /[\w-]/.test(this.buffer[at + opener.length] ?? ' ')) {
          at = this.buffer.indexOf(opener, at + 1)
        }
        this.found.set(opener, at)
      }
      if (at >= 0 && (!best || at < best.at)) best = { at, opener }
    }
    return best
  }

  private collect(opener: (typeof OPENERS)[number], xml: string, batch: XmltvBatch): void {
    if (opener === '<programme') {
      const channel = CHANNEL_ATTR.exec(xml.slice(0, xml.indexOf('>')))?.[1]
      if (!channel || !this.want(channel)) return
    }
    let parsed: Node | null
    try {
      parsed = asNode(parser.parse(xml)[opener.slice(1)])
    } catch {
      return // un élément mal formé n'empêche pas de lire les autres
    }
    if (!parsed) return
    if (opener === '<channel') {
      const channel = toChannel(parsed)
      if (channel) batch.channels.push(channel)
    } else {
      const programme = toProgramme(parsed, this.lang)
      if (programme) batch.programmes.push(programme)
    }
  }
}

/** Analyse un guide entier d'un coup : pour les tests et les petits fichiers. */
export function parseXmltv(xml: string, options: XmltvReaderOptions = {}): XmltvBatch {
  const reader = new XmltvReader(options)
  const batch = reader.push(xml)
  reader.end()
  return batch
}

/**
 * Clé de rapprochement entre une chaîne de playlist et une chaîne du guide. iptv-org suffixe ses
 * `tvg-id` du flux (`6ter.fr@SD`) quand les guides écrivent `6ter.fr` : sur la liste française,
 * aucun identifiant ne correspond tel quel, 54 sur 192 une fois le suffixe ôté. La casse varie
 * elle aussi d'un fournisseur à l'autre.
 */
export function epgKey(id: string | null | undefined): string | null {
  const key = id?.trim().replace(/@.*$/, '').toLowerCase()
  return key || null
}
