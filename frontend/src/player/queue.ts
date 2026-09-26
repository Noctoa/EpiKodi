/**
 * File de lecture audio : logique pure (aucun DOM, aucun React), testée unitairement.
 * L'état est immuable : chaque opération renvoie un nouvel état.
 */

export interface QueueItem {
  /** Identifiant stable (id BDD, ou chemin pour un fichier ouvert hors bibliothèque) */
  key: string
  path: string
  url: string
  title: string
  artist: string | null
  album: string | null
  duration: number | null
  thumbnailUrl: string | null
  /** Reprise : position en secondes au démarrage de la piste */
  startAt?: number
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueState {
  items: QueueItem[]
  /** Position dans `items` de la piste courante ; -1 si file vide */
  index: number
  repeat: RepeatMode
  shuffle: boolean
  /**
   * Ordre de lecture quand shuffle est actif : permutation des indices de `items`.
   * Vide quand shuffle est inactif (on lit dans l'ordre).
   */
  order: number[]
}

export const emptyQueue: QueueState = {
  items: [],
  index: -1,
  repeat: 'off',
  shuffle: false,
  order: []
}

export const current = (q: QueueState): QueueItem | null => q.items[q.index] ?? null

/** Mélange de Fisher-Yates ; `rng` injectable pour des tests déterministes. */
export function shuffled(n: number, rng: () => number = Math.random): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** En shuffle, la piste courante passe en tête pour ne pas être rejouée tout de suite. */
function reshuffle(q: QueueState, rng?: () => number): number[] {
  const order = shuffled(q.items.length, rng)
  if (q.index >= 0) {
    const pos = order.indexOf(q.index)
    if (pos > 0) {
      order.splice(pos, 1)
      order.unshift(q.index)
    }
  }
  return order
}

export function setQueue(
  q: QueueState,
  items: QueueItem[],
  start = 0,
  rng?: () => number
): QueueState {
  const next = {
    ...q,
    items,
    index: items.length ? Math.min(Math.max(0, start), items.length - 1) : -1
  }
  return { ...next, order: next.shuffle ? reshuffle(next, rng) : [] }
}

/** Ajoute en fin de file (sans doublon de clé). Si la file était vide, démarre. */
export function enqueue(q: QueueState, items: QueueItem[], rng?: () => number): QueueState {
  const known = new Set(q.items.map((i) => i.key))
  const fresh = items.filter((i) => !known.has(i.key))
  if (fresh.length === 0) return q
  const all = [...q.items, ...fresh]
  const next = { ...q, items: all, index: q.index === -1 ? 0 : q.index }
  // On ajoute les nouveaux indices à la fin de l'ordre aléatoire courant, mélangés entre eux
  const order = next.shuffle
    ? [...q.order, ...shuffled(fresh.length, rng).map((i) => i + q.items.length)]
    : []
  return { ...next, order }
}

/** Insère juste après la piste courante ("lire ensuite"). */
export function playNext(q: QueueState, item: QueueItem): QueueState {
  const without = remove(q, item.key)
  const at = without.index + 1
  const items = [...without.items.slice(0, at), item, ...without.items.slice(at)]
  const next = { ...without, items, index: without.index === -1 ? 0 : without.index }
  if (!next.shuffle) return { ...next, order: [] }
  // Décale les indices ≥ at, puis insère `at` juste après la position courante dans l'ordre
  const order = without.order.map((i) => (i >= at ? i + 1 : i))
  const pos = order.indexOf(next.index)
  order.splice(pos + 1, 0, at)
  return { ...next, order }
}

export function remove(q: QueueState, key: string): QueueState {
  const at = q.items.findIndex((i) => i.key === key)
  if (at === -1) return q
  const items = q.items.filter((_, i) => i !== at)
  let index = q.index
  if (at < q.index) index--
  else if (at === q.index) index = items.length === 0 ? -1 : Math.min(q.index, items.length - 1)
  const order = q.order.filter((i) => i !== at).map((i) => (i > at ? i - 1 : i))
  return { ...q, items, index, order }
}

/** Déplace la piste de `from` vers `to` (indices dans `items`). */
export function move(q: QueueState, from: number, to: number): QueueState {
  if (from === to || from < 0 || to < 0 || from >= q.items.length || to >= q.items.length) return q
  const items = [...q.items]
  const [item] = items.splice(from, 1)
  items.splice(to, 0, item)
  // Suit la piste courante et réécrit l'ordre aléatoire avec les nouveaux indices
  const remap = (i: number): number => {
    if (i === from) return to
    if (from < to && i > from && i <= to) return i - 1
    if (from > to && i >= to && i < from) return i + 1
    return i
  }
  return { ...q, items, index: q.index === -1 ? -1 : remap(q.index), order: q.order.map(remap) }
}

export function clear(q: QueueState): QueueState {
  return { ...q, items: [], index: -1, order: [] }
}

export function setRepeat(q: QueueState, repeat: RepeatMode): QueueState {
  return { ...q, repeat }
}

export function cycleRepeat(q: QueueState): QueueState {
  const next: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }
  return setRepeat(q, next[q.repeat])
}

export function toggleShuffle(q: QueueState, rng?: () => number): QueueState {
  const shuffle = !q.shuffle
  const next = { ...q, shuffle }
  return { ...next, order: shuffle ? reshuffle(next, rng) : [] }
}

/** Position de la piste courante dans l'ordre de lecture effectif. */
function playOrder(q: QueueState): number[] {
  return q.shuffle ? q.order : q.items.map((_, i) => i)
}

/**
 * Piste suivante. `manual` = l'utilisateur a cliqué "suivant" : on ignore repeat-one et on
 * boucle toujours en fin de file. En fin de piste automatique, on s'arrête si repeat est off.
 * Retourne null s'il n'y a rien à jouer.
 */
export function nextIndex(q: QueueState, manual = false): number | null {
  if (q.index === -1) return null
  if (q.repeat === 'one' && !manual) return q.index
  const order = playOrder(q)
  const pos = order.indexOf(q.index)
  if (pos < order.length - 1) return order[pos + 1]
  return q.repeat === 'all' || manual ? order[0] : null
}

export function prevIndex(q: QueueState): number | null {
  if (q.index === -1) return null
  const order = playOrder(q)
  const pos = order.indexOf(q.index)
  return pos > 0 ? order[pos - 1] : order[order.length - 1]
}

export function jumpTo(q: QueueState, index: number): QueueState {
  return index >= 0 && index < q.items.length ? { ...q, index } : q
}
