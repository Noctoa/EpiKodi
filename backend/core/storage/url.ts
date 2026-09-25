import type { SourceType } from '@shared/models'

/** Description d'une source réseau, telle que saisie par l'utilisateur. */
export interface ParsedLocation {
  type: SourceType
  host: string
  port: number | null
  /** Partage SMB, ou racine du serveur pour HTTP */
  share: string
  /** Sous-dossier dans le partage, sans slash initial ni final */
  path: string
  username: string | null
  /** Présent uniquement si saisi dans l'URL ; sinon fourni séparément */
  password: string | null
}

const DEFAULT_PORTS: Partial<Record<SourceType, number>> = { smb: 445, http: 80 }

/**
 * Analyse `smb://user@nas/media/Films`, `nfs://serveur/export`, `https://dav.example/media`
 * ou un chemin local. Les identifiants présents dans l'URL sont extraits pour être chiffrés
 * séparément plutôt que stockés en clair.
 */
export function parseLocation(input: string): ParsedLocation {
  const trimmed = input.trim()
  const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed)
  if (!match) {
    return {
      type: 'local',
      host: '',
      port: null,
      share: '',
      path: trimmed.replace(/\/+$/, ''),
      username: null,
      password: null
    }
  }

  const scheme = match[1].toLowerCase()
  const type: SourceType =
    scheme === 'smb' || scheme === 'cifs'
      ? 'smb'
      : scheme === 'nfs'
        ? 'nfs'
        : scheme === 'http' || scheme === 'https' || scheme === 'webdav'
          ? 'http'
          : 'local'

  let rest = match[2]
  let username: string | null = null
  let password: string | null = null
  const at = rest.lastIndexOf('@')
  if (at !== -1) {
    const credentials = rest.slice(0, at)
    rest = rest.slice(at + 1)
    const colon = credentials.indexOf(':')
    username = decodeURIComponent(colon === -1 ? credentials : credentials.slice(0, colon))
    password = colon === -1 ? null : decodeURIComponent(credentials.slice(colon + 1))
  }

  const [authority, ...segments] = rest.split('/').filter((s, i) => i === 0 || s !== '')
  const portMatch = /^(.+):(\d+)$/.exec(authority)
  const host = portMatch ? portMatch[1] : authority
  const port = portMatch ? Number(portMatch[2]) : (DEFAULT_PORTS[type] ?? null)

  // En HTTP tout le chemin appartient au serveur ; en SMB/NFS le premier segment est le partage
  const share = type === 'http' ? '' : (segments.shift() ?? '')
  return {
    type,
    host,
    port,
    share,
    path: segments.join('/').replace(/\/+$/, ''),
    username,
    password: password || null
  }
}

/** Reconstruit une URL affichable, sans jamais le mot de passe. */
export function formatLocation(loc: ParsedLocation): string {
  if (loc.type === 'local') return loc.path
  const scheme = loc.type === 'http' ? 'https' : loc.type
  const user = loc.username ? `${encodeURIComponent(loc.username)}@` : ''
  const port = loc.port && loc.port !== DEFAULT_PORTS[loc.type] ? `:${loc.port}` : ''
  const tail = [loc.share, loc.path].filter(Boolean).join('/')
  return `${scheme}://${user}${loc.host}${port}${tail ? `/${tail}` : ''}`
}

/** Nom court proposé pour la source : le dernier segment parlant. */
export function suggestName(loc: ParsedLocation): string {
  const segments = [loc.share, loc.path].filter(Boolean).join('/').split('/').filter(Boolean)
  return segments.at(-1) ?? loc.host ?? 'Source'
}
