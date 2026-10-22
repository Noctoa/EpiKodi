import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

/**
 * Mode TV : la même application, mise en page pour être lue à trois mètres.
 *
 * Tout tient dans un attribut sur <html> — `frontend/src/styles/tv.css` fait le reste. Il n'y a
 * donc ni second jeu de composants, ni rendu à refaire : la bascule est instantanée, et vaut
 * aussi bien pour l'écran affiché que pour ceux qu'on n'a pas encore ouverts.
 *
 * Le choix est mémorisé localement, comme les préférences du lecteur audio et non comme le thème :
 * il décrit l'écran devant lequel on est assis, pas la bibliothèque. Une même bibliothèque
 * partagée entre un bureau et un salon n'a aucune raison d'imposer le même mode aux deux.
 */
const STORAGE_KEY = 'epikodi.tv'

/** Temps sans souris avant de masquer le pointeur. Assez long pour ne pas gêner un réglage. */
const IDLE_DELAY = 4000

/** Raccourci global. La seule touche de fonction que l'application s'attribue. */
export const TV_SHORTCUT = 'F10'

function store(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    /* stockage indisponible */
  }
}

export function applyTvMode(enabled: boolean): void {
  const root = document.documentElement
  if (enabled) root.dataset['tv'] = 'on'
  else {
    delete root.dataset['tv']
    delete root.dataset['idle']
  }
}

/**
 * Relu avant le premier rendu : sans cela, l'application apparaîtrait une fraction de seconde à
 * la taille du bureau avant de basculer. Même raison que `restoreThemeEarly()`.
 */
export function restoreTvModeEarly(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'on') applyTvMode(true)
  } catch {
    /* stockage indisponible */
  }
}

export interface TvModeState {
  enabled: boolean
  toggle: () => void
}

const Ctx = createContext<TvModeState | null>(null)

export function TvModeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const value = useTvModeState()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTvMode(): TvModeState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTvMode() hors de <TvModeProvider>')
  return ctx
}

function useTvModeState(): TvModeState {
  // `restoreTvModeEarly()` a déjà tranché : on repart de ce que porte le document, pour que le
  // premier rendu et l'affichage disent la même chose.
  const [enabled, setEnabled] = useState(() => document.documentElement.dataset['tv'] === 'on')
  const toggle = useCallback(() => setEnabled((on) => !on), [])

  useEffect(() => {
    applyTvMode(enabled)
    store(enabled)
  }, [enabled])

  /*
   * Le raccourci est écouté ici et non dans `App` : il doit répondre partout, y compris devant le
   * lecteur, qui absorbe les touches de l'application.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== TV_SHORTCUT) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  /* Pointeur masqué après inactivité, et seulement en mode TV : ailleurs, la souris est l'outil. */
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    let timer = 0

    const wake = (): void => {
      delete root.dataset['idle']
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        root.dataset['idle'] = 'on'
      }, IDLE_DELAY)
    }

    wake()
    const events = ['mousemove', 'mousedown', 'wheel'] as const
    for (const name of events) window.addEventListener(name, wake, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const name of events) window.removeEventListener(name, wake)
      delete root.dataset['idle']
    }
  }, [enabled])

  return useMemo(() => ({ enabled, toggle }), [enabled, toggle])
}
