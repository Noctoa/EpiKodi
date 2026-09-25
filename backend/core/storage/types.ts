import type { Readable } from 'node:stream'
import type { SourceType } from '@shared/models'

/** Une entrée de dossier, réduite à ce dont le scanner a besoin. */
export interface StorageEntry {
  name: string
  isDirectory: boolean
  size: number
  /** Millisecondes depuis epoch */
  mtime: number
}

export interface StorageStat {
  size: number
  mtime: number
}

/** Plage d'octets, bornes incluses, comme dans un en-tête HTTP Range. */
export interface ByteRange {
  start: number
  end?: number
}

/**
 * Accès uniforme à un stockage, local ou distant. Le scanner, le lecteur et l'enrichissement
 * travaillent contre cette interface : ajouter un protocole ne les modifie pas.
 */
export interface StorageProvider {
  readonly kind: SourceType
  /** Chemin racine lisible par l'utilisateur (dossier local, partage réseau…) */
  readonly label: string
  /** Contenu d'un dossier ; `path` est relatif à la racine de la source. */
  list(path: string): Promise<StorageEntry[]>
  stat(path: string): Promise<StorageStat>
  read(path: string, range?: ByteRange): Promise<Readable>
  /** Vérifie que la source répond, sans lever : sert à marquer une source indisponible. */
  available(): Promise<boolean>
  /**
   * Identifiant stable et complet d'un fichier, stocké en base : chemin absolu pour une source
   * locale, URL `smb://` ou `https://` pour une source réseau.
   */
  locate(path: string): string
  /** Opération inverse de `locate` ; null si le localisateur n'appartient pas à cette source. */
  relative(locator: string): string | null
  /** URL utilisable par ffmpeg/ffprobe, ou null si le protocole leur est inconnu. */
  ffmpegUrl(path: string): string | null
  close(): void
}

/** Erreur normalisée : le scanner distingue « source injoignable » de « fichier absent ». */
export class StorageUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageUnavailable'
  }
}
