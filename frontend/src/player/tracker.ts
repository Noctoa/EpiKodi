import type { PlayTarget } from '@shared/ipc'

/**
 * Mesure du temps réellement passé à lire, pour les statistiques. On compte l'horloge murale
 * entre deux `timeupdate` pendant que le média joue — pas la position atteinte : un saut de
 * vingt minutes ne fait pas vingt minutes d'écoute, une pause n'en fait aucune, et un direct
 * (sans position utile) se mesure comme le reste.
 */

/** Écart maximal compté entre deux mesures : au-delà, le lecteur s'est figé ou l'onglet dormait. */
export const MAX_TICK_MS = 2000
/** Fréquence d'envoi au backend : une fermeture brutale ne perd pas plus que ça. */
export const FLUSH_MS = 15_000

export class PlayClock {
  private last: number | null = null
  private pending = 0

  /** Le média joue à l'instant `now` (ms) : ajoute le temps écoulé depuis la dernière mesure. */
  tick(now: number): void {
    if (this.last !== null) {
      const elapsed = now - this.last
      if (elapsed > 0) this.pending += Math.min(elapsed, MAX_TICK_MS)
    }
    this.last = now
  }

  /** Pause, attente de données, saut, fin : le temps jusqu'ici compte, la suite non. */
  stop(now: number): void {
    this.tick(now)
    this.last = null
  }

  /** Secondes accumulées depuis le dernier appel, remises à zéro. */
  take(): number {
    const seconds = this.pending / 1000
    this.pending = 0
    return seconds
  }
}

/** Cible du journal pour un élément de la file audio ; null pour un fichier hors bibliothèque. */
export function targetOfKey(key: string): PlayTarget | null {
  const [kind, id] = [key.slice(0, key.indexOf(':')), Number(key.slice(key.indexOf(':') + 1))]
  if (!Number.isInteger(id)) return null
  if (kind === 'media') return { kind: 'media', mediaId: id }
  if (kind === 'episode') return { kind: 'episode', episodeId: id }
  return null
}

function newSession(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Suit la lecture d'un élément `<audio>` / `<video>` pour une cible donnée : une séance par
 * appel. Retourne la fonction d'arrêt, qui envoie ce qui reste.
 */
export function trackPlayback(el: HTMLMediaElement, target: PlayTarget): () => void {
  const session = newSession()
  const clock = new PlayClock()
  const now = (): number => performance.now()

  const flush = (): void => {
    const seconds = clock.take()
    // Moins d'une seconde : bruit d'un lecteur qui démarre ou d'un saut, pas une écoute
    if (seconds >= 1) void window.epikodi.statsRecord(session, target, seconds).catch(() => {})
  }
  const onTick = (): void => {
    if (!el.paused && !el.seeking) clock.tick(now())
  }
  const onStop = (): void => clock.stop(now())

  const events: [string, () => void][] = [
    ['playing', onTick],
    ['timeupdate', onTick],
    ['pause', onStop],
    ['waiting', onStop],
    ['seeking', onStop],
    ['ended', onStop],
    ['emptied', onStop]
  ]
  events.forEach(([e, h]) => el.addEventListener(e, h))
  const timer = setInterval(flush, FLUSH_MS)

  return () => {
    events.forEach(([e, h]) => el.removeEventListener(e, h))
    clearInterval(timer)
    if (!el.paused) clock.stop(now())
    flush()
  }
}
