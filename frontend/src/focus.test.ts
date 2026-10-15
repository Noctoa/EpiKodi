import { describe, expect, it } from 'vitest'
import { bestCandidate, type Box } from './focus'

/** Boîte carrée de 100×60 posée en (x, y). */
const box = (x: number, y: number): Box => ({ left: x, top: y, right: x + 100, bottom: y + 60 })

/**
 * Deux rangées de trois, comme deux sections de l'accueil :
 *   0 1 2   ← « continuer à regarder »
 *   3 4 5   ← « récemment ajoutés »
 */
const GRILLE = [box(0, 0), box(120, 0), box(240, 0), box(0, 100), box(120, 100), box(240, 100)]

const depuis = (index: number, direction: Parameters<typeof bestCandidate>[2]): number | null => {
  const autres = GRILLE.filter((_, i) => i !== index)
  const trouvé = bestCandidate(GRILLE[index], autres, direction)
  return trouvé === null ? null : GRILLE.indexOf(autres[trouvé])
}

describe('bestCandidate', () => {
  it('descend sur la case d’en dessous, pas sur la plus proche en diagonale', () => {
    expect(depuis(1, 'down')).toBe(4)
    expect(depuis(2, 'down')).toBe(5)
  })

  it('remonte de la même façon', () => {
    expect(depuis(4, 'up')).toBe(1)
  })

  it('va à la case voisine à gauche et à droite', () => {
    expect(depuis(1, 'right')).toBe(2)
    expect(depuis(1, 'left')).toBe(0)
  })

  it('ne renvoie rien quand il n’y a rien dans cette direction', () => {
    expect(depuis(0, 'up')).toBeNull()
    expect(depuis(0, 'left')).toBeNull()
    expect(depuis(5, 'down')).toBeNull()
    expect(depuis(5, 'right')).toBeNull()
  })

  it('ignore ce qui est strictement aligné quand on demande l’autre axe', () => {
    // La case 3 est pile en dessous de la 0 : elle n'est pas « à droite » de la 0
    expect(bestCandidate(GRILLE[0], [GRILLE[3]], 'right')).toBeNull()
  })

  it('accepte une cible de travers s’il n’y a qu’elle', () => {
    // Fin d'une rangée courte : la seule case plus bas est décalée de deux colonnes
    expect(bestCandidate(box(240, 0), [box(0, 100)], 'down')).toBe(0)
  })

  it('préfère la plus proche quand plusieurs sont dans la direction', () => {
    expect(bestCandidate(box(0, 0), [box(0, 400), box(0, 100)], 'down')).toBe(1)
  })
})
