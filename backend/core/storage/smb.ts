import { PassThrough, type Readable } from 'node:stream'
import SMB2 from '@tryjsky/v9u-smb2'
import type { ByteRange, StorageEntry, StorageProvider, StorageStat } from './types'
import { StorageUnavailable } from './types'
import { formatLocation, parseLocation, type ParsedLocation } from './url'

/**
 * Les types livrés par `@tryjsky/v9u-smb2` déclarent `name`, `mtime` et `isDirectory()` mais
 * omettent `size`, que le serveur renvoie pourtant. On redéclare la forme réellement reçue.
 */
interface SmbStat {
  name: string
  size?: number
  mtime?: Date
  isDirectory(): boolean
}

const asSmbStats = (value: unknown): SmbStat[] => value as SmbStat[]
const asSmbStat = (value: unknown): SmbStat => value as SmbStat

const TIMEOUT_MS = 12_000

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new StorageUnavailable(`délai dépassé : ${what}`)), TIMEOUT_MS)
    )
  ])
}

/**
 * Partage Windows / Samba, en espace utilisateur : aucun montage, aucun droit root.
 * Les chemins SMB utilisent « \ » et sont relatifs à la racine du partage.
 */
export class SmbProvider implements StorageProvider {
  readonly kind = 'smb' as const
  private client: SMB2
  private base: string

  constructor(
    private location: ParsedLocation,
    password: string | null
  ) {
    this.client = new SMB2({
      share: `\\\\${location.host}\\${location.share}`,
      domain: 'WORKGROUP',
      username: location.username ?? 'guest',
      password: password ?? '',
      port: location.port ?? 445,
      autoCloseTimeout: 0
    })
    this.base = location.path.replace(/\//g, '\\')
  }

  /**
   * Une connexion SMB ne supporte pas deux opérations simultanées : le scan et la vérification
   * de disponibilité se bloquaient mutuellement. Les opérations sont donc mises à la queue leu
   * leu ; seule leur *initiation* est sérialisée, la lecture d'un flux continue en parallèle.
   */
  private queue: Promise<unknown> = Promise.resolve()

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  get label(): string {
    return `//${this.location.host}/${this.location.share}${this.location.path ? `/${this.location.path}` : ''}`
  }

  private full(path: string): string {
    const rel = path.replace(/\//g, '\\')
    return [this.base, rel].filter(Boolean).join('\\')
  }

  async list(path: string): Promise<StorageEntry[]> {
    // `stats: true` ramène nom, taille, date et type en un seul aller-retour réseau
    const entries = asSmbStats(
      await this.serial(() =>
        withTimeout(
          this.client.readdir(this.full(path), { stats: true }),
          `listing de ${this.label}`
        )
      )
    )
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      size: Number(e.size ?? 0),
      mtime: e.mtime ? new Date(e.mtime).getTime() : 0
    }))
  }

  async stat(path: string): Promise<StorageStat> {
    const s = asSmbStat(
      await this.serial(() => withTimeout(this.client.stat(this.full(path)), `stat ${path}`))
    )
    return { size: Number(s.size ?? 0), mtime: s.mtime ? new Date(s.mtime).getTime() : 0 }
  }

  /** Lecture par plage : c'est elle qui rend le saut possible dans une vidéo distante. */
  async read(path: string, range?: ByteRange): Promise<Readable> {
    const options = range
      ? { start: range.start, ...(range.end !== undefined && { end: range.end }) }
      : {}
    const source = await this.serial(() =>
      withTimeout(
        new Promise<Readable>((resolve, reject) => {
          this.client.createReadStream(
            this.full(path),
            options,
            (err?: Error, stream?: Readable) =>
              err || !stream ? reject(err ?? new StorageUnavailable('flux vide')) : resolve(stream)
          )
        }),
        `lecture de ${path}`
      )
    )

    // La bibliothèque referme le descripteur en fin de flux, puis une seconde fois quand le
    // consommateur détruit le flux : ce STATUS_FILE_CLOSED arrive après les données et ne doit
    // pas transformer une lecture réussie en échec.
    const out = new PassThrough()
    let finished = false
    source.once('end', () => {
      finished = true
    })
    source.on('error', (err: Error) => {
      if (finished) out.end()
      else out.destroy(err)
    })
    out.once('close', () => source.destroy())
    source.pipe(out)
    return out
  }

  async available(): Promise<boolean> {
    try {
      await this.serial(() => withTimeout(this.client.readdir(this.base || ''), 'connexion'))
      return true
    } catch {
      return false
    }
  }

  locate(path: string): string {
    return formatLocation({
      ...this.location,
      password: null,
      path: [this.location.path, path].filter(Boolean).join('/')
    })
  }

  relative(locator: string): string | null {
    const loc = parseLocation(locator)
    if (
      loc.type !== 'smb' ||
      loc.host !== this.location.host ||
      loc.share !== this.location.share
    ) {
      return null
    }
    const base = this.location.path
    if (!base) return loc.path
    return loc.path === base
      ? ''
      : loc.path.startsWith(`${base}/`)
        ? loc.path.slice(base.length + 1)
        : null
  }

  /** ffmpeg ne connaît pas smb:// : les fichiers distants lui sont servis par le pont HTTP. */
  ffmpegUrl(): null {
    return null
  }

  close(): void {
    try {
      this.client.disconnect()
    } catch {
      /* déjà fermé */
    }
  }
}
