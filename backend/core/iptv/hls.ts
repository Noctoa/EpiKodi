import type { LiveVariant } from '@shared/ipc'
import { fetchWithTimeout } from '../net'

/**
 * Variantes d'une playlist HLS « maître » : la même chaîne en plusieurs qualités. ffmpeg les
 * expose comme autant de programmes, numérotés dans l'ordre de la playlist — c'est cet ordre qui
 * sert d'identifiant (voir `buildLiveArgs`). Une playlist de segments, ou un flux qui n'est pas
 * du HLS, n'en a aucune : le menu de qualité n'apparaît pas.
 */

const STREAM_INF = '#EXT-X-STREAM-INF:'
/** Une playlist maître tient en quelques kilo-octets ; au-delà, ce n'en est pas une. */
const MAX_PLAYLIST_BYTES = 1024 * 1024
const TIMEOUT_MS = 8000
/**
 * Faute d'en-tête imposé par la playlist, on se présente comme ffmpeg : c'est lui qui lira la
 * variante, et certains serveurs refusent ce qui ne lui ressemble pas — Pluto TV répond 403 à
 * l'agent d'EpiKodi, 200 à « Lavf ».
 */
const FFMPEG_AGENT = 'Lavf'

/** `BANDWIDTH=2111272,CODECS="avc1.42001f,mp4a.40.2",RESOLUTION=1280x720` → attributs. */
function attributes(list: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, key, quoted, bare] of list.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)) {
    found.set(key, quoted ?? bare)
  }
  return found
}

/** Pure, testée. */
export function parseVariants(playlist: string): LiveVariant[] {
  const variants: LiveVariant[] = []
  for (const line of playlist.split(/\r?\n/)) {
    if (!line.startsWith(STREAM_INF)) continue
    const attrs = attributes(line.slice(STREAM_INF.length))
    const bandwidth = Number(attrs.get('BANDWIDTH'))
    const height = Number(/^\d+x(\d+)$/.exec(attrs.get('RESOLUTION') ?? '')?.[1])
    variants.push({
      index: variants.length,
      bandwidth: Number.isFinite(bandwidth) && bandwidth > 0 ? bandwidth : null,
      height: Number.isFinite(height) && height > 0 ? height : null
    })
  }
  return variants
}

export interface PlaylistSource {
  url: string
  userAgent: string | null
  referrer: string | null
}

/**
 * Lit le corps sans dépasser `max` octets. Le délai de `fetchWithTimeout` s'arrête aux en-têtes :
 * un flux MPEG-TS brut, qui ne finit jamais, ferait attendre `text()` indéfiniment.
 */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      // Un flot binaire se reconnaît dès les premiers octets : inutile d'en lire un mégaoctet
      if (size === 0 && !Buffer.from(value).toString('latin1').trimStart().startsWith('#')) {
        return null
      }
      size += value.byteLength
      if (size > max) return null
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Les variantes changent rarement : une lecture par chaîne et par session suffit. */
const cache = new Map<string, LiveVariant[]>()

/**
 * Lit les variantes d'une chaîne. Un échec n'est pas une erreur — la chaîne reste lisible en
 * qualité automatique — et n'est pas mis en cache : le réseau peut revenir.
 */
export async function fetchVariants(source: PlaylistSource): Promise<LiveVariant[]> {
  const known = cache.get(source.url)
  if (known) return known
  try {
    const headers: Record<string, string> = { 'User-Agent': source.userAgent ?? FFMPEG_AGENT }
    if (source.referrer) headers['Referer'] = source.referrer
    const res = await fetchWithTimeout(source.url, { headers }, TIMEOUT_MS)
    const text = await readCapped(res, MAX_PLAYLIST_BYTES)
    if (text === null || !text.startsWith('#EXTM3U')) return []
    const variants = parseVariants(text)
    cache.set(source.url, variants)
    return variants
  } catch {
    return []
  }
}
