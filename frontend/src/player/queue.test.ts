import { describe, expect, it } from 'vitest'
import {
  current,
  cycleRepeat,
  emptyQueue,
  enqueue,
  jumpTo,
  move,
  nextIndex,
  playNext,
  prevIndex,
  remove,
  setQueue,
  shuffled,
  toggleShuffle,
  type QueueItem
} from './queue'

const item = (n: number): QueueItem => ({
  key: String(n),
  path: `/${n}.mp3`,
  url: `media://local/${n}`,
  title: `Piste ${n}`,
  artist: null,
  album: null,
  duration: null,
  thumbnailUrl: null
})
const items = (n: number): QueueItem[] => Array.from({ length: n }, (_, i) => item(i + 1))
const keys = (q: ReturnType<typeof setQueue>): string[] => q.items.map((i) => i.key)
// rng constant → shuffled() renvoie une permutation déterministe
const rng = (): number => 0.3

describe('file de lecture', () => {
  it('démarre à la piste demandée et enchaîne dans l’ordre', () => {
    let q = setQueue(emptyQueue, items(3), 1)
    expect(current(q)?.key).toBe('2')
    q = jumpTo(q, nextIndex(q)!)
    expect(current(q)?.key).toBe('3')
    expect(nextIndex(q)).toBeNull() // fin de file, repeat off → stop
    expect(nextIndex(q, true)).toBe(0) // "suivant" manuel → boucle
  })

  it('repeat all boucle, repeat one reste sur place sauf en manuel', () => {
    let q = setQueue(emptyQueue, items(2), 1)
    q = cycleRepeat(q) // all
    expect(nextIndex(q)).toBe(0)
    q = cycleRepeat(q) // one
    expect(nextIndex(q)).toBe(1)
    expect(nextIndex(q, true)).toBe(0)
    q = cycleRepeat(q) // off
    expect(q.repeat).toBe('off')
  })

  it('précédent boucle en tête de file', () => {
    const q = setQueue(emptyQueue, items(3), 0)
    expect(prevIndex(q)).toBe(2)
  })

  it('enqueue ajoute sans doublon et démarre si vide', () => {
    let q = enqueue(emptyQueue, items(2))
    expect(q.index).toBe(0)
    q = enqueue(q, [item(2), item(3)])
    expect(keys(q)).toEqual(['1', '2', '3'])
    expect(q.index).toBe(0)
  })

  it('playNext insère juste après la piste courante', () => {
    let q = setQueue(emptyQueue, items(3), 0)
    q = playNext(q, item(9))
    expect(keys(q)).toEqual(['1', '9', '2', '3'])
    expect(nextIndex(q)).toBe(1)
    // déplacer une piste déjà présente
    q = playNext(q, item(3))
    expect(keys(q)).toEqual(['1', '3', '9', '2'])
  })

  it('remove ajuste l’index de la piste courante', () => {
    let q = setQueue(emptyQueue, items(4), 2)
    q = remove(q, '1') // avant → index recule
    expect(current(q)?.key).toBe('3')
    q = remove(q, '3') // la courante → on passe à la suivante
    expect(current(q)?.key).toBe('4')
    q = remove(q, '4') // dernière → on recule
    expect(current(q)?.key).toBe('2')
    q = remove(q, '2')
    expect(q.index).toBe(-1)
  })

  it('move réordonne et suit la piste courante', () => {
    let q = setQueue(emptyQueue, items(4), 3)
    q = move(q, 3, 0)
    expect(keys(q)).toEqual(['4', '1', '2', '3'])
    expect(current(q)?.key).toBe('4')
    q = move(q, 1, 3)
    expect(keys(q)).toEqual(['4', '2', '3', '1'])
    expect(current(q)?.key).toBe('4')
  })

  it('shuffle : permutation complète, piste courante en tête, toutes lues une fois', () => {
    expect(shuffled(5, rng).sort()).toEqual([0, 1, 2, 3, 4].sort())
    let q = setQueue(emptyQueue, items(5), 2)
    q = toggleShuffle(q, rng)
    expect(q.order[0]).toBe(2)
    const played = [q.index]
    for (let i = 0; i < 4; i++) {
      const n = nextIndex(q)!
      played.push(n)
      q = jumpTo(q, n)
    }
    expect([...played].sort()).toEqual([0, 1, 2, 3, 4])
    expect(nextIndex(q)).toBeNull()
    q = toggleShuffle(q)
    expect(q.order).toEqual([])
  })

  it('shuffle : enqueue et remove gardent un ordre cohérent', () => {
    let q = toggleShuffle(setQueue(emptyQueue, items(3), 0), rng)
    q = enqueue(q, [item(4), item(5)], rng)
    expect([...q.order].sort()).toEqual([0, 1, 2, 3, 4])
    q = remove(q, '2')
    expect([...q.order].sort()).toEqual([0, 1, 2, 3])
    expect(q.order).toHaveLength(4)
  })
})
