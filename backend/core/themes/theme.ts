/**
 * Format d'un thème : un fichier `theme.json` déclarant des surcharges de variables CSS.
 * Un thème ne contient aucun code — seulement des valeurs — et il est validé avant d'être
 * appliqué, car ces valeurs finissent injectées dans une feuille de style.
 */

/** Variables qu'un thème a le droit de redéfinir. Toute autre clé est refusée. */
export const THEME_TOKENS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--text',
  '--text-muted',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--danger',
  '--danger-soft',
  '--warning',
  '--warning-soft',
  '--success',
  '--overlay',
  '--overlay-strong',
  '--overlay-gradient',
  '--shadow',
  '--radius',
  '--font',
  '--font-size',
  '--tile-min'
] as const

export type ThemeToken = (typeof THEME_TOKENS)[number]

export interface Theme {
  id: string
  name: string
  description: string | null
  author: string | null
  /** Thème intégré servant de point de départ ; seules les variables listées sont surchargées */
  base: 'dark' | 'light'
  tokens: Partial<Record<ThemeToken, string>>
}

export interface ThemeError {
  field: string
  message: string
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/

/**
 * Valeurs acceptées : couleurs, longueurs et piles de polices. Tout le reste est refusé —
 * en particulier `url()`, qui chargerait une ressource distante, et les caractères `;` ou `}`
 * qui permettraient de sortir de la déclaration et d'injecter du style arbitraire.
 */
const VALUE_RE =
  /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)|-?[0-9.]+(px|rem|em|%|vh|vw)?|[a-zA-Z0-9\s,'"-]+)$/

export function isSafeValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 200) return false
  if (/[;{}<>\\]/.test(trimmed)) return false
  if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(trimmed)) return false
  return VALUE_RE.test(trimmed)
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/**
 * Valide un `theme.json` déjà analysé. Retourne le thème normalisé, ou la liste des problèmes —
 * jamais d'exception, pour qu'un thème fautif n'empêche pas les autres de se charger.
 */
export function parseTheme(
  raw: unknown
): { theme: Theme; errors: [] } | { theme: null; errors: ThemeError[] } {
  const errors: ThemeError[] = []
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const id = asString(data['id'])
  if (!id) errors.push({ field: 'id', message: 'identifiant manquant' })
  else if (!ID_RE.test(id)) {
    errors.push({ field: 'id', message: 'identifiant invalide : minuscules, chiffres et tirets' })
  }

  const name = asString(data['name'])
  if (!name) errors.push({ field: 'name', message: 'nom manquant' })

  const baseRaw = asString(data['base']) ?? 'dark'
  if (baseRaw !== 'dark' && baseRaw !== 'light') {
    errors.push({ field: 'base', message: 'base attendue : « dark » ou « light »' })
  }

  const tokens: Partial<Record<ThemeToken, string>> = {}
  const rawTokens = data['tokens']
  if (rawTokens !== undefined && (typeof rawTokens !== 'object' || rawTokens === null)) {
    errors.push({ field: 'tokens', message: 'tokens doit être un objet' })
  } else {
    for (const [key, value] of Object.entries((rawTokens ?? {}) as Record<string, unknown>)) {
      const token = key.startsWith('--') ? key : `--${key}`
      if (!(THEME_TOKENS as readonly string[]).includes(token)) {
        errors.push({ field: 'tokens', message: `variable inconnue : ${key}` })
        continue
      }
      if (typeof value !== 'string' || !isSafeValue(value)) {
        errors.push({ field: 'tokens', message: `valeur refusée pour ${key}` })
        continue
      }
      tokens[token as ThemeToken] = value.trim()
    }
  }

  if (errors.length > 0) return { theme: null, errors }
  return {
    theme: {
      id: id!,
      name: name!,
      description: asString(data['description']),
      author: asString(data['author']),
      base: baseRaw as 'dark' | 'light',
      tokens
    },
    errors: []
  }
}

/** Les deux thèmes intégrés, toujours proposés, plus le suivi du réglage du système. */
export const BUILTIN_THEMES: Theme[] = [
  {
    id: 'system',
    name: 'Système',
    description: 'Suit le réglage clair/sombre du bureau',
    author: null,
    base: 'dark',
    tokens: {}
  },
  { id: 'dark', name: 'Sombre', description: null, author: null, base: 'dark', tokens: {} },
  { id: 'light', name: 'Clair', description: null, author: null, base: 'light', tokens: {} }
]
