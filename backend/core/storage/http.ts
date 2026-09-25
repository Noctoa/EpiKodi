import { Readable } from 'node:stream'
import type { ByteRange, StorageEntry, StorageProvider, StorageStat } from './types'
import { StorageUnavailable } from './types'
import type { ParsedLocation } from './url'

const TIMEOUT_MS = 15_000

/**
 * Serveur HTTP(S) ou WebDAV. Le listing utilise `PROPFIND` (WebDAV) ; la lecture utilise les
 * requêtes Range, donc le saut dans une vidéo distante ne télécharge que ce qui est nécessaire.
 */
export class HttpProvider implements StorageProvider {
  readonly kind = 'http' as const
  private auth: string | null

  constructor(
    private location: ParsedLocation,
    password: string | null
  ) {
    this.auth = location.username
      ? `Basic ${Buffer.from(`${location.username}:${password ?? ''}`).toString('base64')}`
      : null
  }

  get label(): string {
    return this.baseUrl('')
  }

  /** URL absolue d'un chemin relatif à la racine de la source. */
  private baseUrl(path: string): string {
    const scheme = this.location.port === 80 ? 'http' : 'https'
    const port =
      this.location.port && ![80, 443].includes(this.location.port) ? `:${this.location.port}` : ''
    const segments = [this.location.path, path].filter(Boolean).join('/')
    return `${scheme}://${this.location.host}${port}/${segments}`.replace(/(?<!:)\/{2,}/g, '/')
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.auth ? { Authorization: this.auth, ...extra } : extra
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } catch (err) {
      throw new StorageUnavailable(`serveur injoignable : ${this.location.host}`, { cause: err })
    } finally {
      clearTimeout(timer)
    }
  }

  async list(path: string): Promise<StorageEntry[]> {
    const url = this.baseUrl(path)
    const res = await this.fetchWithTimeout(url, {
      method: 'PROPFIND',
      headers: this.headers({ Depth: '1', 'Content-Type': 'application/xml' }),
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>'
    })
    if (!res.ok) throw new StorageUnavailable(`PROPFIND ${res.status} sur ${url}`)
    return parsePropfind(await res.text(), new URL(url).pathname)
  }

  async stat(path: string): Promise<StorageStat> {
    const res = await this.fetchWithTimeout(this.baseUrl(path), {
      method: 'HEAD',
      headers: this.headers()
    })
    if (!res.ok) throw new StorageUnavailable(`HEAD ${res.status} sur ${path}`)
    return {
      size: Number(res.headers.get('content-length') ?? 0),
      mtime: Date.parse(res.headers.get('last-modified') ?? '') || 0
    }
  }

  async read(path: string, range?: ByteRange): Promise<Readable> {
    const headers = this.headers(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {})
    const res = await this.fetchWithTimeout(this.baseUrl(path), { headers })
    if (!res.ok || !res.body) throw new StorageUnavailable(`GET ${res.status} sur ${path}`)
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  }

  async available(): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(this.baseUrl(''), {
        method: 'HEAD',
        headers: this.headers()
      })
      return res.ok || res.status === 405 // certains serveurs refusent HEAD sur un dossier
    } catch {
      return false
    }
  }

  locate(path: string): string {
    return this.baseUrl(path)
  }

  relative(locator: string): string | null {
    const root = this.baseUrl('')
    if (!locator.startsWith(root)) return null
    return locator.slice(root.length).replace(/^\/+/, '')
  }

  /** ffmpeg parle http(s) nativement : inutile de passer par le pont local. */
  ffmpegUrl(path: string): string {
    return this.baseUrl(path)
  }

  close(): void {}
}

/**
 * Extrait les entrées d'une réponse PROPFIND. On reste sur des expressions régulières plutôt
 * que d'ajouter un parseur XML : la réponse est très régulière et l'on ne lit que quatre champs.
 */
export function parsePropfind(xml: string, basePath: string): StorageEntry[] {
  const entries: StorageEntry[] = []
  const base = decodeURIComponent(basePath).replace(/\/+$/, '')
  for (const [, block] of xml.matchAll(
    /<(?:\w+:)?response[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g
  )) {
    const href = /<(?:\w+:)?href[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/.exec(block)?.[1]?.trim()
    if (!href) continue
    const path = decodeURIComponent(href).replace(/\/+$/, '')
    if (path === base) continue // la première entrée est le dossier lui-même
    const name = path.split('/').filter(Boolean).at(-1)
    if (!name) continue
    entries.push({
      name,
      isDirectory: /<(?:\w+:)?collection\s*\/?>/.test(block),
      size: Number(/<(?:\w+:)?getcontentlength[^>]*>(\d+)</.exec(block)?.[1] ?? 0),
      mtime:
        Date.parse(/<(?:\w+:)?getlastmodified[^>]*>([\s\S]*?)</.exec(block)?.[1]?.trim() ?? '') || 0
    })
  }
  return entries
}
