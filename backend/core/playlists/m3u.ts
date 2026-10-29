/**
 * Import et export de playlists au format M3U étendu — le format d'échange que lisent VLC,
 * Kodi et la plupart des lecteurs. Pure et testé : aucun accès disque ici.
 */

export interface M3uEntry {
  /** Chemin ou URL du média, tel qu'écrit dans le fichier */
  path: string
  /** Secondes ; -1 quand la durée est inconnue, par convention du format */
  duration: number | null
  title: string | null
}

/**
 * Attributs posés sur la ligne `#EXTINF` par les listes de chaînes en direct. Ils ne font
 * partie d'aucune norme : ce sont ceux que Kodi, VLC et les fournisseurs IPTV se sont mis à
 * écrire, et que tout le monde lit aujourd'hui.
 */
export interface M3uAttributes {
  /** `tvg-id` : identifiant de la chaîne dans un guide des programmes XMLTV */
  tvgId: string | null
  /** `tvg-name` : nom canonique, souvent plus propre que le titre affiché */
  tvgName: string | null
  /** `tvg-logo` : URL du logo */
  tvgLogo: string | null
  /** `group-title` : rubrique sous laquelle ranger la chaîne */
  groupTitle: string | null
}

/**
 * En-têtes HTTP qu'un flux exige, déclarés par des lignes `#EXTVLCOPT:` à côté de son `#EXTINF`.
 * Certains serveurs refusent le flux à qui ne se présente pas comme un navigateur.
 */
export interface M3uHttpOptions {
  userAgent: string | null
  referrer: string | null
}

export interface M3uChannel extends M3uEntry {
  attributes: M3uAttributes
  http: M3uHttpOptions
}

const HEADER = '#EXTM3U'
const EXTINF = '#EXTINF:'
const EXTVLCOPT = '#EXTVLCOPT:'
const ATTRIBUTE = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g

const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim()

export function serializeM3u(entries: M3uEntry[]): string {
  const lines = [HEADER]
  for (const entry of entries) {
    const duration = entry.duration === null ? -1 : Math.round(entry.duration)
    if (entry.title) lines.push(`#EXTINF:${duration},${oneLine(entry.title)}`)
    lines.push(entry.path)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Sépare une ligne `#EXTINF` de ce qui précède la virgule — durée et attributs — et du titre
 * qui la suit. La virgule retenue est la première **hors guillemets** : un attribut comme
 * `group-title="Sport, France"` en contient, et couper à la première venue amputerait le titre
 * d'une chaîne sur deux dans les grosses listes.
 */
function splitExtinf(body: string): { head: string; title: string | null } {
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '"') quoted = !quoted
    else if (c === ',' && !quoted) {
      return { head: body.slice(0, i), title: body.slice(i + 1).trim() || null }
    }
  }
  return { head: body, title: null }
}

/** Un attribut vide (`tvg-logo=""`) vaut une absence : il ne sert à rien de la mémoriser. */
function parseAttributes(head: string): M3uAttributes {
  const found = new Map<string, string>()
  for (const [, key, value] of head.matchAll(ATTRIBUTE)) {
    const trimmed = value.trim()
    if (trimmed) found.set(key.toLowerCase(), trimmed)
  }
  return {
    tvgId: found.get('tvg-id') ?? null,
    tvgName: found.get('tvg-name') ?? null,
    tvgLogo: found.get('tvg-logo') ?? null,
    groupTitle: found.get('group-title') ?? null
  }
}

/** VLC accepte les deux orthographes de l'en-tête, comme HTTP lui-même. */
const VLC_OPTIONS: Record<string, keyof M3uHttpOptions> = {
  'http-user-agent': 'userAgent',
  'http-referrer': 'referrer',
  'http-referer': 'referrer'
}

/**
 * Analyse un fichier M3U, attributs étendus compris. Tolérant : les commentaires inconnus sont
 * ignorés, une ligne `#EXTINF` sans média qui suive est abandonnée, et l'absence d'en-tête
 * n'est pas fatale (beaucoup de fichiers M3U simples n'en ont pas).
 */
export function parseM3uChannels(content: string): M3uChannel[] {
  const channels: M3uChannel[] = []
  let pending: Omit<M3uChannel, 'path' | 'http'> | null = null
  // Les `#EXTVLCOPT` se placent avant ou après le `#EXTINF` : ils valent pour le prochain média
  let http: M3uHttpOptions = { userAgent: null, referrer: null }

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#')) {
      if (line.toUpperCase().startsWith(EXTINF)) {
        const { head, title } = splitExtinf(line.slice(EXTINF.length))
        const seconds = Number(/^\s*(-?\d+(?:\.\d+)?)/.exec(head)?.[1])
        pending = {
          duration: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
          title,
          attributes: parseAttributes(head)
        }
      } else if (line.toUpperCase().startsWith(EXTVLCOPT)) {
        const option = line.slice(EXTVLCOPT.length)
        const eq = option.indexOf('=')
        const key = VLC_OPTIONS[option.slice(0, eq).trim().toLowerCase()]
        const value = option.slice(eq + 1).trim()
        if (eq > 0 && key && value) http = { ...http, [key]: value }
      }
      continue // tout autre commentaire est ignoré
    }

    channels.push({
      path: line,
      duration: pending?.duration ?? null,
      title: pending?.title ?? null,
      attributes: pending?.attributes ?? parseAttributes(''),
      http
    })
    pending = null
    http = { userAgent: null, referrer: null }
  }
  return channels
}

/**
 * Vue « playlist » du même fichier : le chemin, la durée et le titre, sans les attributs des
 * chaînes en direct. C'est ce dont l'import de playlists utilisateur a besoin, et rien de plus.
 */
export function parseM3u(content: string): M3uEntry[] {
  return parseM3uChannels(content).map(({ path, duration, title }) => ({ path, duration, title }))
}

/** Nom de fichier sûr pour l'export : « Ma playlist ! » → « Ma playlist.m3u ». */
export function playlistFileName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base || 'playlist'}.m3u`
}

/**
 * Fait correspondre les lignes d'un fichier M3U aux médias de la bibliothèque, par chemin.
 * Importer une playlist n'indexe rien : une entrée dont le fichier est absent est comptée
 * comme introuvable, pas ajoutée.
 */
export function matchEntries(
  entries: M3uEntry[],
  byPath: Map<string, number>
): { mediaIds: number[]; missing: string[] } {
  const mediaIds: number[] = []
  const missing: string[] = []
  const vus = new Set<number>()

  for (const entry of entries) {
    const id = byPath.get(entry.path)
    if (id === undefined) {
      missing.push(entry.path)
      continue
    }
    // Un même média listé deux fois n'est ajouté qu'une seule fois
    if (vus.has(id)) continue
    vus.add(id)
    mediaIds.push(id)
  }
  return { mediaIds, missing }
}
