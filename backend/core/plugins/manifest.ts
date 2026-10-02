/**
 * Format d'un plugin : un dossier contenant un `manifest.json` et le code à charger.
 * La validation est pure et testée : un manifeste invalide est refusé avec un message utile
 * plutôt que de faire échouer le chargement plus loin, de façon obscure.
 */

/** Ce qu'un plugin peut demander à l'application. Tout le reste lui est refusé. */
export const PERMISSIONS = ['network', 'library:read', 'library:write'] as const
export type Permission = (typeof PERMISSIONS)[number]

/** Points d'extension qu'un plugin déclare fournir. */
export const CONTRIBUTIONS = ['metadataProvider', 'hooks', 'menu'] as const
export type Contribution = (typeof CONTRIBUTIONS)[number]

export interface PluginManifest {
  /** Identifiant unique, en minuscules : sert de clé et de nom de dossier */
  id: string
  name: string
  version: string
  description: string | null
  author: string | null
  /** Fichier JavaScript à charger, relatif au dossier du plugin */
  main: string
  permissions: Permission[]
  contributes: Contribution[]
  /** Version minimale d'EpiKodi attendue, au format semver partiel (« 0.1 ») */
  engine: string | null
}

export interface ManifestError {
  field: string
  message: string
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
const VERSION_RE = /^\d+\.\d+(\.\d+)?/

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/**
 * Valide un manifeste déjà analysé en JSON. Retourne le manifeste normalisé, ou la liste des
 * problèmes rencontrés — jamais une exception, pour qu'un plugin fautif n'arrête pas les autres.
 */
export function parseManifest(
  raw: unknown
): { manifest: PluginManifest; errors: [] } | { manifest: null; errors: ManifestError[] } {
  const errors: ManifestError[] = []
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const id = asString(data['id'])
  if (!id) errors.push({ field: 'id', message: 'identifiant manquant' })
  else if (!ID_RE.test(id)) {
    errors.push({
      field: 'id',
      message: 'identifiant invalide : minuscules, chiffres et tirets, 3 à 50 caractères'
    })
  }

  const name = asString(data['name'])
  if (!name) errors.push({ field: 'name', message: 'nom manquant' })

  const version = asString(data['version'])
  if (!version) errors.push({ field: 'version', message: 'version manquante' })
  else if (!VERSION_RE.test(version)) {
    errors.push({ field: 'version', message: 'version attendue au format « 1.0.0 »' })
  }

  const main = asString(data['main'])
  if (!main) errors.push({ field: 'main', message: 'point d’entrée « main » manquant' })
  else if (main.includes('..') || main.startsWith('/')) {
    // Un plugin ne doit pas pouvoir charger du code hors de son dossier
    errors.push({
      field: 'main',
      message: 'le point d’entrée doit rester dans le dossier du plugin'
    })
  }

  const permissions: Permission[] = []
  for (const value of asArray(data['permissions'])) {
    if (typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)) {
      permissions.push(value as Permission)
    } else {
      errors.push({ field: 'permissions', message: `permission inconnue : ${String(value)}` })
    }
  }

  const contributes: Contribution[] = []
  for (const value of asArray(data['contributes'])) {
    if (typeof value === 'string' && (CONTRIBUTIONS as readonly string[]).includes(value)) {
      contributes.push(value as Contribution)
    } else {
      errors.push({ field: 'contributes', message: `contribution inconnue : ${String(value)}` })
    }
  }

  if (errors.length > 0) return { manifest: null, errors }
  return {
    manifest: {
      id: id!,
      name: name!,
      version: version!,
      description: asString(data['description']),
      author: asString(data['author']),
      main: main!,
      permissions,
      contributes,
      engine: asString(data['engine'])
    },
    errors: []
  }
}

/** Un plugin ne reçoit que ce qu'il a déclaré vouloir. */
export const grants = (manifest: PluginManifest, permission: Permission): boolean =>
  manifest.permissions.includes(permission)
