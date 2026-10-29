import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import type { EpgGuide } from '@shared/models'
import { epg, iptv, type Database } from '../db'
import { fetchWithTimeout } from '../net'
import { epgKey, XmltvReader, type XmltvProgramme } from './xmltv'

/**
 * Guides des programmes : téléchargement, décompression et import d'un guide XMLTV, puis purge
 * de ce qui est passé. Un guide réel compte des centaines de milliers de programmes : tout se
 * fait au fil de l'eau, par tranches, en rendant la main entre chacune — le process principal
 * sert aussi l'interface et les flux vidéo, il ne doit jamais rester bloqué.
 */

/** Écrites par transaction : assez pour amortir l'écriture, assez peu pour rendre vite la main. */
const BATCH = 1000
/** Un guide décompressé de plus d'un demi-gigaoctet n'est pas un guide, c'est une bombe gzip. */
const MAX_TEXT_CHARS = 512 * 1024 * 1024
/** Le délai de `fetchWithTimeout` s'arrête aux en-têtes : sans ceci, un serveur muet bloquerait. */
const IDLE_TIMEOUT_MS = 60_000
/** On garde ce qui vient de finir, et une semaine à venir : au-delà, aucun guide n'est fiable. */
const KEEP_PAST_SECONDS = 3600
const KEEP_AHEAD_SECONDS = 8 * 24 * 3600
/** Un guide est rafraîchi en tâche de fond quand sa dernière lecture date de plus que ça. */
export const STALE_AFTER_SECONDS = 12 * 3600

export interface GuideImportResult {
  guideId: number
  name: string
  /** Chaînes décrites par le guide */
  channels: number
  /** Programmes gardés (chaînes importées, fenêtre utile) */
  programmes: number
  /** Chaînes des playlists qui ont reçu au moins un programme */
  matched: number
  error: string | null
}

const isUrl = (location: string): boolean => /^https?:\/\//i.test(location)

/** « https://xmltvfr.fr/xmltv/xmltv_tnt.xml.gz » → « xmltv_tnt ». */
export function suggestGuideName(location: string): string {
  let file = location
  try {
    if (isUrl(location)) file = new URL(location).pathname
  } catch {
    /* on garde l'emplacement tel quel */
  }
  const name = basename(file).replace(/(\.xml)?(\.gz)?$/i, '')
  if (name) return name
  try {
    return new URL(location).hostname
  } catch {
    return 'Guide'
  }
}

/** Une coupure de chaîne entre deux morceaux est toujours possible : on décode en texte au bout. */
async function* textOf(bytes: Readable): AsyncGenerator<string> {
  const iterator = bytes[Symbol.asyncIterator]() as AsyncIterator<Buffer>
  const first = await iterator.next()
  if (first.done) return
  async function* all(): AsyncGenerator<Buffer> {
    yield first.value as Buffer
    for (;;) {
      const next = await iterator.next()
      if (next.done) return
      yield next.value
    }
  }
  // Gzip se reconnaît à ses deux premiers octets, pas à l'extension : un serveur peut servir un
  // `.xml` compressé, ou décompresser lui-même un `.xml.gz`.
  const head = first.value as Buffer
  const raw = Readable.from(all(), { objectMode: false })
  const plain = head[0] === 0x1f && head[1] === 0x8b ? raw.pipe(createGunzip()) : raw
  plain.setEncoding('utf8')
  let total = 0
  for await (const chunk of plain as AsyncIterable<string>) {
    total += chunk.length
    if (total > MAX_TEXT_CHARS) {
      plain.destroy()
      throw new Error('guide trop volumineux')
    }
    yield chunk
  }
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export interface ImportOptions {
  /** Horloge, en secondes : injectable pour les tests */
  now?: number
}

/**
 * Importe un guide déjà ouvert. Seuls les programmes des chaînes importées sont gardés — un guide
 * national en couvre des centaines dont on n'a que quelques-unes —, et seulement dans la fenêtre
 * utile. Le nouveau guide s'écrit par-dessus l'ancien, qui n'est supprimé qu'à la fin.
 */
export async function importGuide(
  db: Database,
  guideId: number,
  bytes: Readable,
  options: ImportOptions = {}
): Promise<{ channels: number; programmes: number }> {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const wanted = iptv.epgKeys(db)
  const runId = Date.now()
  const reader = new XmltvReader({
    wantChannel: (id) => {
      const key = epgKey(id)
      return key !== null && wanted.has(key)
    }
  })

  let channels = 0
  let stored = 0
  let pending: epg.ProgrammeInput[] = []
  const keep = (p: XmltvProgramme): boolean => {
    const end = p.stop ?? p.start + 6 * 3600
    return end >= now - KEEP_PAST_SECONDS && p.start < now + KEEP_AHEAD_SECONDS
  }
  const flush = async (): Promise<void> => {
    epg.writeProgrammes(db, guideId, runId, pending)
    stored += pending.length
    pending = []
    await yieldToEventLoop()
  }

  for await (const text of textOf(bytes)) {
    const batch = reader.push(text)
    channels += batch.channels.length
    for (const p of batch.programmes) {
      if (!keep(p)) continue
      pending.push({ ...p, channelKey: epgKey(p.channel)! })
      if (pending.length >= BATCH) await flush()
    }
  }
  reader.end()
  await flush()
  epg.dropStale(db, guideId, runId)
  return { channels, programmes: stored }
}

/** Ouvre le guide, du réseau ou du disque, avec un délai d'inactivité sur le corps. */
async function open(location: string): Promise<Readable> {
  if (!isUrl(location)) return createReadStream(location)

  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
  const res = await fetchWithTimeout(location, { signal: controller.signal }, IDLE_TIMEOUT_MS)
  if (!res.body) throw new Error('réponse vide')
  const reader = res.body.getReader()
  async function* chunks(): AsyncGenerator<Buffer> {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        // Chaque morceau reçu repousse l'échéance : un gros guide lent passe, un serveur muet non
        clearTimeout(timer)
        timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
        yield Buffer.from(value)
      }
    } finally {
      clearTimeout(timer)
      void reader.cancel().catch(() => undefined)
    }
  }
  return Readable.from(chunks(), { objectMode: false })
}

/** Un rafraîchissement à la fois par guide : le démarrage et un clic peuvent se croiser. */
const running = new Map<number, Promise<GuideImportResult>>()

/**
 * Recharge un guide. Comme pour les listes de chaînes, une erreur est mémorisée sur le guide et
 * jamais propagée : un guide injoignable ne doit pas empêcher de regarder la télévision.
 */
export function refreshGuide(db: Database, guideId: number): Promise<GuideImportResult> {
  const current = running.get(guideId)
  if (current) return current
  const task = (async (): Promise<GuideImportResult> => {
    const guide = epg.guide(db, guideId)
    if (!guide) throw new Error(`guide ${guideId} introuvable`)
    const started = Date.now()
    try {
      const result = await importGuide(db, guideId, await open(guide.location))
      epg.markFetched(db, guideId, { error: null, channelCount: result.channels })
      const after = epg.guide(db, guideId)!
      console.log(
        `[epg] « ${guide.name} » : ${result.programmes} programmes, ` +
          `${after.matchedCount} chaîne(s) rattachée(s) sur ${result.channels}, ` +
          `${((Date.now() - started) / 1000).toFixed(1)} s`
      )
      return { guideId, name: guide.name, ...result, matched: after.matchedCount, error: null }
    } catch (err) {
      const message =
        (err as Error).name === 'AbortError' ? 'le serveur ne répond plus' : (err as Error).message
      epg.markFetched(db, guideId, { error: message })
      console.warn(`[epg] « ${guide.name} » : ${message}`)
      const after = epg.guide(db, guideId)!
      return {
        guideId,
        name: guide.name,
        channels: after.channelCount,
        programmes: after.programmeCount,
        matched: after.matchedCount,
        error: message
      }
    }
  })()
  running.set(guideId, task)
  void task.finally(() => running.delete(guideId))
  return task
}

export async function addGuide(
  db: Database,
  location: string,
  name: string | null
): Promise<GuideImportResult> {
  const trimmed = location.trim()
  if (!trimmed) throw new Error('aucune URL ni fichier')
  const guide = epg.upsertGuide(db, trimmed, name?.trim() || suggestGuideName(trimmed))
  return refreshGuide(db, guide.id)
}

/**
 * Tâche de fond : purge ce qui est passé, puis recharge les guides périmés (ou tous, `force`).
 * En série : deux guides de cent mégaoctets en parallèle n'iraient pas plus vite.
 */
export async function refreshStaleGuides(
  db: Database,
  { force = false, now = Math.floor(Date.now() / 1000) } = {}
): Promise<GuideImportResult[]> {
  const purged = epg.purgePast(db, now)
  if (purged > 0) console.log(`[epg] ${purged} programme(s) passé(s) supprimé(s)`)
  const results: GuideImportResult[] = []
  for (const guide of epg.listGuides(db)) {
    if (!force && !isStale(guide, now)) continue
    results.push(await refreshGuide(db, guide.id))
  }
  return results
}

export const isStale = (guide: EpgGuide, now: number): boolean =>
  guide.lastFetchAt === null || now - guide.lastFetchAt > STALE_AFTER_SECONDS
