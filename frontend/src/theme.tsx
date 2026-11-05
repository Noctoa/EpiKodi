import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { ThemeInfo, ThemeList } from '@shared/ipc'
import { useProfiles } from './profiles'
import jokerCutin from './assets/persona/joker-cutin.png'
import makotoCutin from './assets/persona/makoto-cutin.webp'

type Persona = 'p3' | 'p5'
const cutins = { p3: makotoCutin, p5: jokerCutin }
const personaOf = (id: string): Persona => (id === 'persona5' ? 'p5' : 'p3')

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

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
  root.dataset['persona'] = personaOf(selected)

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
    else if (saved === 'persona3' || saved === 'persona5') {
      document.documentElement.dataset['theme'] = 'dark'
    }
    document.documentElement.dataset['persona'] = personaOf(saved ?? 'system')
    if (saved === 'system') delete document.documentElement.dataset['theme']
  } catch {
    /* stockage indisponible */
  }
}

export interface ThemeState {
  list: ThemeList | null
  select: (id: string) => Promise<void>
  persona: Persona
  busy: boolean
}

const Ctx = createContext<ThemeState | null>(null)

/**
 * Le thème est appliqué à la racine de l'application, pas dans l'écran des Paramètres : il doit
 * l'être dès le démarrage, et rester appliqué quelle que soit la vue affichée.
 */
export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const value = useThemeState()
  return (
    <Ctx.Provider value={value}>
      {children}
      {value.transition && (
        <div className={`persona-cutin persona-cutin--${value.transition}`} aria-hidden="true">
          <div className="persona-cutin__rays" />
          <div className="persona-cutin__frame">
            <div className="persona-cutin__portrait">
              <img src={cutins[value.transition]} alt="" />
            </div>
          </div>
        </div>
      )}
      {value.error && (
        <div className="theme-error" role="alert">
          {value.error}
          <button onClick={value.dismissError} aria-label="Fermer le message">
            ×
          </button>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useTheme(): ThemeState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme() hors de <ThemeProvider>')
  return ctx
}

function useThemeState() {
  const [list, setList] = useState<ThemeList | null>(null)
  const [persona, setPersona] = useState<Persona>(() =>
    document.documentElement.dataset['persona'] === 'p5' ? 'p5' : 'p3'
  )
  const [busy, setBusy] = useState(false)
  const [transition, setTransition] = useState<Persona | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const lifetime = useRef<AbortController | null>(null)
  const images = useRef<Partial<Record<Persona, HTMLImageElement>>>({})
  const dismissError = useCallback(() => setError(null), [])
  /** Le thème est propre à chaque profil : on le relit à chaque bascule */
  const profileId = useProfiles().active?.id

  useEffect(() => {
    for (const id of ['p3', 'p5'] as const) {
      const image = new Image()
      image.src = cutins[id]
      images.current[id] = image
      void image.decode().catch(() => {
        /* Le thème reste utilisable si un asset manque. */
      })
    }
  }, [])

  const appliquer = useCallback((data: ThemeList, id = data.selected) => {
    setPersona(personaOf(id))
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
    const controller = new AbortController()
    lifetime.current = controller
    window.epikodi
      .themesList()
      .then((data) => {
        if (controller.signal.aborted) return
        setList(data)
        appliquer(data)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Impossible de charger les thèmes.')
      })
    return () => controller.abort()
  }, [appliquer, profileId])

  const select = useCallback(
    async (id: string) => {
      // Verrou synchrone : deux clics dans la même frame ne lancent pas deux écritures IPC.
      if (lock.current || !list || id === list.selected) return
      const signal = lifetime.current!.signal
      lock.current = true
      setBusy(true)
      setError(null)
      try {
        const data = await window.epikodi.themesSelect(id)
        if (signal.aborted) return
        const target = personaOf(data.selected)
        const image = images.current[target]
        const animate =
          target !== persona &&
          image?.complete &&
          image.naturalWidth > 0 &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (animate) {
          setTransition(target)
          await delay(420, signal)
        }
        if (signal.aborted) return
        setList(data)
        appliquer(data)
        if (animate) await delay(780, signal)
      } catch {
        if (!signal.aborted) setError('Impossible de changer de thème. Réessaie.')
      } finally {
        lock.current = false
        if (!signal.aborted) {
          setTransition(null)
          setBusy(false)
        }
      }
    },
    [appliquer, list, persona]
  )

  return useMemo(
    () => ({ list, select, persona, busy, transition, error, dismissError }),
    [list, select, persona, busy, transition, error, dismissError]
  )
}
