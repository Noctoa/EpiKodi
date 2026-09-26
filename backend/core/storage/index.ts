import type { Source } from '@shared/models'
import { HttpProvider } from './http'
import { LocalProvider } from './local'
import { SmbProvider } from './smb'
import type { StorageProvider } from './types'
import { parseLocation } from './url'

export * from './types'
export { formatLocation, parseLocation, suggestName, type ParsedLocation } from './url'
export { parsePropfind } from './http'
export { LocalProvider } from './local'
export { RemoteFileProvider } from './remote-file'

/**
 * Construit le provider correspondant à une source.
 * NFS n'a pas de client Node utilisable : un export NFS se déclare comme un dossier local une
 * fois monté par le système (voir docs/network-storage.md).
 */
export function createProvider(source: Source, password: string | null = null): StorageProvider {
  const location = parseLocation(source.path)
  switch (location.type) {
    case 'smb':
      return new SmbProvider(location, password)
    case 'http':
      return new HttpProvider(location, password)
    default:
      return new LocalProvider(location.path || source.path)
  }
}
