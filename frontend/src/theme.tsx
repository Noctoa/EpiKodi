import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { ThemeInfo, ThemeList } from '@shared/ipc'

/** Feuille de style injectée pour les surcharges d'un thème personnalisé. */
const STYLE_ID = 'epikodi-theme'
/** Mémorisé localement pour éviter un flash au démarrage, avant la réponse du backend. */
const STORAGE_KEY = 'epikodi.theme'

/**
 * Applique un thème sans redémarrage :
 *  - l'attribut `data-theme` sur <html> bascule entre les palettes intégrées (absent = système) ;
 *  - les variables surchargées par un thème personnalisé sont injectées dans une feuille dédiée.
 *
 * Comme tout passe par des variables CSS, le changement est instantané sur toutes les vues :
 * aucun composant n'a besoin d'être rendu à nouveau.
 */
export function applyTheme(selected: string, theme: ThemeInfo | undefined): void {
  const root = document.documentElement

  if (selected === 'system') delete root.dataset['theme']
  else root.dataset['theme'] = theme?.base ?? (selected === 'light' ? 'light' : 'dark')

  const declarations = Object.entries(theme?.tokens ?? {})
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')

  let style = document.getElementById(STYLE_ID)
  if (!declarations) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.append(style)
  }
  style.textContent = `:root {\n${declarations}\n}`
}

/** Dernier thème choisi, relu avant la réponse du backend pour éviter un changement visible. */
export function restoreThemeEarly(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset['theme'] = saved
    else if (saved === 'system') delete document.documentElement.dataset['theme']
  } catch {
    /* stockage indisponible */
  }
}

export interface ThemeState {
  list: ThemeList | null
  select: (id: string) => Promise<void>
  /** Applique un thème le temps du survol, sans l'enregistrer */
  preview: (id: string | null) => void
}

const Ctx = createContext<ThemeState | null>(null)

/**
 * Le thème est appliqué à la racine de l'application, pas dans l'écran des Paramètres : il doit
 * l'être dès le démarrage, et rester appliqué quelle que soit la vue affichée.
 */
export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const value = useThemeState()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme() hors de <ThemeProvider>')
  return ctx
}

function useThemeState(): ThemeState {
  const [list, setList] = useState<ThemeList | null>(null)

  const appliquer = useCallback((data: ThemeList, id = data.selected) => {
    applyTheme(
      id,
      data.themes.find((t) => t.id === id)
    )
    try {
      localStorage.setItem(STORAGE_KEY, data.selected)
    } catch {
      /* stockage indisponible */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.epikodi.themesList().then((data) => {
      if (cancelled) return
      setList(data)
      appliquer(data)
    })
    return () => {
      cancelled = true
    }
  }, [appliquer])

  const select = useCallback(
    async (id: string) => {
      const data = await window.epikodi.themesSelect(id)
      setList(data)
      appliquer(data)
    },
    [appliquer]
  )

  const preview = useCallback(
    (id: string | null) => {
      if (!list) return
      appliquer(list, id ?? list.selected)
    },
    [list, appliquer]
  )

  return useMemo(() => ({ list, select, preview }), [list, select, preview])
}
