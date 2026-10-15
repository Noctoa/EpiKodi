import { useEffect } from 'react'

/**
 * Navigation directionnelle : passer d'une zone à l'autre à la flèche, au clavier comme à la
 * télécommande. Chaque grille gère déjà ses propres vignettes ; ce module prend le relais quand
 * le composant focalisé ne consomme pas la touche — bord d'une grille, bouton isolé, barre
 * latérale — et choisit la cible la plus proche dans la direction demandée.
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Un décalage latéral coûte plus cher qu'un éloignement dans la direction visée. */
const LATERAL_PENALTY = 2

/** En deçà, la cible est considérée à la même hauteur (ou colonne) que l'origine. */
const MIN_STEP = 1

const center = (b: Box): { x: number; y: number } => ({
  x: (b.left + b.right) / 2,
  y: (b.top + b.bottom) / 2
})

/**
 * Index de la meilleure cible dans une direction, ou `null` s'il n'y a rien de ce côté.
 * Le score mêle la distance dans la direction visée et le décalage latéral : d'une vignette, on
 * descend sur celle d'en dessous, pas sur la plus proche en diagonale.
 */
export function bestCandidate(origin: Box, candidates: Box[], direction: Direction): number | null {
  const from = center(origin)
  const vertical = direction === 'up' || direction === 'down'
  let best: number | null = null
  let bestScore = Number.POSITIVE_INFINITY

  candidates.forEach((candidate, index) => {
    const to = center(candidate)
    const forward =
      direction === 'down'
        ? to.y - from.y
        : direction === 'up'
          ? from.y - to.y
          : direction === 'right'
            ? to.x - from.x
            : from.x - to.x
    if (forward <= MIN_STEP) return

    const lateral = vertical ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y)
    const score = forward + lateral * LATERAL_PENALTY
    if (score < bestScore) {
      bestScore = score
      best = index
    }
  })

  return best
}

/** Ce que le curseur peut atteindre : vignettes, boutons, liens — barre latérale comprise. */
const TARGETS = '.sidebar button, .app__view .tile, .app__view button, .app__view a'

/**
 * Attribut porté par l'élément sous le curseur, et par lui seul. C'est ce que le surlignage de
 * la télécommande cible (voir `remote-nav` dans `remote/bridge.ts`).
 *
 * Un attribut plutôt qu'une classe : React réécrit le `className` qu'il a rendu. Et il est posé
 * à la main plutôt qu'en écoutant `focusin` : quand la fenêtre n'a pas le focus du système,
 * Chromium met à jour `document.activeElement` mais n'émet aucun événement de focus — or piloter
 * depuis un téléphone, c'est justement ne pas être devant la fenêtre.
 */
export const CURSOR_ATTR = 'data-cursor'

/** Déplace le curseur sur un élément : focus réel, et marque visible. */
export function focusCursor(el: HTMLElement): void {
  document.querySelector(`[${CURSOR_ATTR}]`)?.removeAttribute(CURSOR_ATTR)
  el.setAttribute(CURSOR_ATTR, '')
  el.focus({ preventScroll: true })
}

/** Premier élément atteignable de la vue : là où le curseur se pose en arrivant sur un écran. */
export function firstFocusable(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.app__view .tile, .app__view button, .app__view a')
}

const DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

/** Déplace le focus d'une zone à l'autre. Retourne faux s'il n'y a rien dans cette direction. */
export function moveFocus(direction: Direction): boolean {
  const current = document.activeElement
  if (!(current instanceof HTMLElement)) return false

  const targets = [...document.querySelectorAll<HTMLElement>(TARGETS)].filter(
    // `offsetParent` à null : élément masqué, donc inatteignable
    (el) => el !== current && el.offsetParent !== null
  )
  const index = bestCandidate(
    current.getBoundingClientRect(),
    targets.map((el) => el.getBoundingClientRect()),
    direction
  )
  if (index === null) return false

  focusCursor(targets[index])
  targets[index].scrollIntoView({ block: 'nearest' })
  return true
}

/**
 * Branche les flèches sur la navigation directionnelle, en dernier recours : si le composant
 * focalisé a déjà traité la touche (une grille qui déplace sa sélection), il a appelé
 * `preventDefault` et on ne fait rien.
 *
 * Rien n'est détourné tant que l'utilisateur n'a pas pris la main au focus : sans élément
 * focalisé, les flèches font défiler la page comme partout ailleurs.
 */
export function useDirectionalFocus(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const direction = DIRECTIONS[e.key]
      if (!direction || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return

      const target = e.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (document.activeElement === document.body || document.activeElement === null) return
      // Devant le lecteur, les flèches appartiennent à la lecture : saut et volume. Son écouteur
      // est posé après le nôtre, on ne peut pas compter sur son `preventDefault`.
      if (document.querySelector('.player')) return

      if (moveFocus(direction)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
