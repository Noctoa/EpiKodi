import { Readable } from 'node:stream'
import type { ByteRange, StorageEntry, StorageProvider, StorageStat } from './types'
import { StorageUnavailable } from './types'

const TIMEOUT_MS = 20_000

/**
 * Un fichier distant isolé, désigné par son URL complète — typiquement l'épisode d'un podcast,
 * qui n'appartient à aucune source scannée. Les requêtes Range permettent de se déplacer dans
 * l'épisode sans le télécharger entièrement.
 */
export class RemoteFileProvider implements StorageProvider {
  readonly kind = 'http' as const

  constructor(private fileUrl: string) {}

  get label(): string {
    return this.fileUrl
  }

  list(): Promise<StorageEntry[]> {
    return Promise.reject(new StorageUnavailable('un fichier distant ne se parcourt pas'))
  }

  private async request(init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(this.fileUrl, {
        ...init,
        redirect: 'follow',
        signal: controller.signal
      })
      if (!res.ok) throw new StorageUnavailable(`HTTP ${res.status} sur ${this.fileUrl}`)
      return res
    } catch (err) {
      if (err instanceof StorageUnavailable) throw err
      throw new StorageUnavailable(`fichier distant injoignable`, { cause: err })
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Certains hébergeurs de podcasts répondent `200` à un `HEAD` mais avec un corps vide et
   * `content-length: 0` — on croirait alors le fichier vide. Quand la taille annoncée n'est pas
   * exploitable, on la redemande par un GET d'un seul octet : l'en-tête `Content-Range` d'une
   * réponse 206 donne la taille réelle. Si rien n'aboutit, la taille reste inconnue (0) et le
   * fichier est servi d'un bloc, sans saut.
   */
  async stat(): Promise<StorageStat> {
    let mtime = 0
    try {
      const head = await this.request({ method: 'HEAD' })
      mtime = Date.parse(head.headers.get('last-modified') ?? '') || 0
      const declared = Number(head.headers.get('content-length') ?? 0)
      const type = head.headers.get('content-type') ?? ''
      if (declared > 0 && !type.startsWith('text/')) return { size: declared, mtime }
    } catch {
      /* HEAD non supporté : on tente la plage */
    }

    const probe = await this.request({ headers: { Range: 'bytes=0-0' } })
    await probe.body?.cancel()
    const total = Number(/\/(\d+)\s*$/.exec(probe.headers.get('content-range') ?? '')?.[1] ?? 0)
    return {
      size: Number.isFinite(total) ? total : 0,
      mtime: mtime || Date.parse(probe.headers.get('last-modified') ?? '') || 0
    }
  }

  async read(_path: string, range?: ByteRange): Promise<Readable> {
    const res = await this.request(
      range ? { headers: { Range: `bytes=${range.start}-${range.end ?? ''}` } } : {}
    )
    if (!res.body) throw new StorageUnavailable('réponse sans corps')
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  }

  async available(): Promise<boolean> {
    try {
      await this.request({ method: 'HEAD' })
      return true
    } catch {
      return false
    }
  }

  locate(): string {
    return this.fileUrl
  }

  relative(locator: string): string | null {
    return locator === this.fileUrl ? '' : null
  }

  /** ffmpeg lit http(s) nativement. */
  ffmpegUrl(): string {
    return this.fileUrl
  }

  close(): void {}
}
