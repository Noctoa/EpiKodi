import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetchWithTimeout } from '../net'

/**
 * Chaque service musical fixe sa cadence : une requête par seconde pour MusicBrainz, trois pour
 * AcoustID. Au-delà, l'adresse est bannie quelques minutes. `Throttle` espace les appels d'un
 * même service, quel que soit le nombre d'appelants.
 */
export class Throttle {
  /** Les tests simulent le réseau : attendre n'y aurait aucun sens. */
  static enabled = true
  private next = 0

  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    if (!Throttle.enabled) return
    const now = Date.now()
    const at = Math.max(now, this.next)
    this.next = at + this.intervalMs
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now))
  }
}

/** Une panne passagère (réseau coupé, serveur saturé) : on réessaiera, rien n'est mémorisé. */
export class TransientError extends Error {}

/** La clé d'API est refusée : inutile d'insister sur les morceaux suivants. */
export class KeyRejectedError extends Error {}

const transient = (err: unknown): boolean => {
  const message = (err as Error).message ?? ''
  return (
    (err as Error).name === 'AbortError' ||
    /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|HTTP (429|5\d\d)/.test(message)
  )
}

/** Attente avant chaque nouvelle tentative, quand le service se dit saturé. */
const RETRY_DELAYS_MS = [1500, 4000]

/**
 * JSON d'un service, ou null quand la ressource n'existe pas (404). MusicBrainz répond 503 dès
 * que sa file globale déborde, même à la cadence permise : on réessaie avant de renoncer.
 */
export async function getJson<T>(
  url: string,
  throttle: Throttle,
  init: RequestInit = {}
): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    await throttle.wait()
    try {
      const res = await fetchWithTimeout(url, {
        ...init,
        headers: { Accept: 'application/json', ...init.headers }
      })
      return (await res.json()) as T
    } catch (err) {
      const message = (err as Error).message
      if (/HTTP 404/.test(message)) return null
      const delay = RETRY_DELAYS_MS[attempt]
      if (/HTTP (429|503)/.test(message) && delay !== undefined) {
        if (Throttle.enabled) await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      if (transient(err)) throw new TransientError(message)
      throw err
    }
  }
}

/** Nom de fichier stable pour une clé : la même pochette n'est téléchargée qu'une fois. */
export const artworkFileName = (kind: string, key: string): string =>
  `${kind}-${createHash('sha1').update(key).digest('hex').slice(0, 16)}.jpg`

/**
 * Télécharge une image dans `dir`. Le fichier n'apparaît qu'une fois complet : une coupure en
 * cours de route ne laisse pas une pochette tronquée que l'interface afficherait à moitié.
 */
export async function downloadImage(
  url: string,
  dir: string,
  name: string,
  throttle: Throttle
): Promise<string | null> {
  await throttle.wait()
  await mkdir(dir, { recursive: true })
  const dest = join(dir, name)
  const partial = `${dest}.part`
  try {
    const res = await fetchWithTimeout(url)
    if (!res.body || !/^image\//.test(res.headers.get('content-type') ?? 'image/')) return null
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(partial)
    )
    await rename(partial, dest)
    return dest
  } catch (err) {
    await rm(partial, { force: true })
    if (/HTTP 404/.test((err as Error).message)) return null
    if (transient(err)) throw new TransientError((err as Error).message)
    throw err
  }
}
