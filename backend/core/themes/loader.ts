import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { BUILTIN_THEMES, parseTheme, type Theme, type ThemeError } from './theme'

export interface BrokenTheme {
  dir: string
  errors: ThemeError[]
}

export interface DiscoveredThemes {
  themes: Theme[]
  broken: BrokenTheme[]
}

/** Lit un `theme.json` ; retourne null si le dossier n'en contient pas. */
async function readTheme(
  dir: string
): Promise<{ theme: Theme | null; errors: ThemeError[] } | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(dir, 'theme.json'), 'utf8'))
  } catch {
    return null // pas de thème ici, ce n'est pas une erreur
  }
  return parseTheme(raw)
}

/**
 * Découvre les thèmes installés. Deux emplacements, pour deux usages :
 *  - `themesDir` : un thème seul, simple fichier de couleurs, sans code ;
 *  - les dossiers d'extensions : une extension peut livrer un thème avec le reste.
 *
 * Les thèmes intégrés sont toujours présents en tête, et un thème fautif est signalé plutôt
 * que d'empêcher les autres de se charger.
 */
export async function discoverThemes(
  themesDir: string,
  pluginDirs: string[] = []
): Promise<DiscoveredThemes> {
  const themes: Theme[] = [...BUILTIN_THEMES]
  const broken: BrokenTheme[] = []
  const vus = new Set(themes.map((t) => t.id))

  let dossiers: string[] = []
  try {
    dossiers = (await readdir(themesDir)).map((nom) => join(themesDir, nom))
  } catch {
    /* dossier absent : aucun thème personnalisé */
  }

  for (const dir of [...dossiers, ...pluginDirs]) {
    const resultat = await readTheme(dir)
    if (!resultat) continue
    if (!resultat.theme) {
      broken.push({ dir, errors: resultat.errors })
      console.warn(
        `[themes] ${basename(dir)} : ${resultat.errors.map((e) => e.message).join(', ')}`
      )
      continue
    }
    if (vus.has(resultat.theme.id)) {
      broken.push({
        dir,
        errors: [{ field: 'id', message: `identifiant déjà utilisé : ${resultat.theme.id}` }]
      })
      continue
    }
    vus.add(resultat.theme.id)
    themes.push(resultat.theme)
  }

  return { themes, broken }
}
