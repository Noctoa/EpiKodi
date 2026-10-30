import { toImageUrl, toMediaUrl } from '@shared/ipc'
import type { EpgProgramme, IptvChannel } from '@shared/models'

/**
 * Géométrie de la grille des programmes, sans React : quelle tranche de temps, quelles chaînes,
 * quels blocs. Pure, testée — le composant ne fait que dessiner ce qu'elle décide.
 */

export const HOUR = 3600
export const HALF_HOUR = 1800
export const DAY = 24 * HOUR

/** Les guides couvrent une semaine ; au-delà, il n'y a plus rien à montrer. */
const DAYS_AHEAD = 8
/** Un peu de passé : ce qui vient de commencer reste visible, la purge garde une heure. */
const PAST = 2 * HOUR

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)

export const floorTo = (t: number, step: number): number => Math.floor(t / step) * step

export interface TimeWindow {
  from: number
  to: number
}

/** La grille entière, figée à l'ouverture : la décaler toutes les minutes ferait sauter l'écran. */
export function guideWindow(now: number): TimeWindow {
  const from = floorTo(now - PAST, HALF_HOUR)
  return { from, to: from + DAYS_AHEAD * DAY }
}

export interface Segment {
  kind: 'programme' | 'gap'
  start: number
  stop: number
  programme?: EpgProgramme
}

/**
 * Les blocs d'une ligne entre `from` et `to` : les programmes, et des trous comblés entre eux,
 * pour que la ligne n'ait jamais de vide — une chaîne sans guide est un seul grand trou.
 *
 * Deux guides se recouvrent parfois d'une minute : un programme qui commence avant la fin du
 * précédent est raboté plutôt que superposé.
 *
 * `maxGap` découpe les trous en morceaux alignés : à la manette, passer un trou d'une semaine
 * d'un coup de flèche enverrait le curseur au bout de la grille.
 */
export function rowSegments(
  programmes: EpgProgramme[],
  from: number,
  to: number,
  maxGap = Infinity
): Segment[] {
  const segments: Segment[] = []
  const gap = (start: number, stop: number): void => {
    let cursor = start
    while (cursor < stop) {
      const end = Number.isFinite(maxGap) ? Math.min(stop, floorTo(cursor, maxGap) + maxGap) : stop
      segments.push({ kind: 'gap', start: cursor, stop: end })
      cursor = end
    }
  }

  let cursor = from
  const sorted = [...programmes].sort((a, b) => a.start - b.start)
  for (const p of sorted) {
    const start = Math.max(p.start, cursor)
    const stop = Math.min(p.stop, to)
    if (stop <= start) continue
    if (start > cursor) gap(cursor, start)
    segments.push({ kind: 'programme', start, stop, programme: p })
    cursor = stop
    if (cursor >= to) break
  }
  if (cursor < to) gap(cursor, to)
  return segments
}

/** Index du bloc qui contient l'instant `t` ; le plus proche quand `t` sort de la ligne. */
export function segmentAt(segments: Segment[], t: number): number {
  if (segments.length === 0) return -1
  const index = segments.findIndex((s) => s.start <= t && t < s.stop)
  if (index >= 0) return index
  return t < segments[0].start ? 0 : segments.length - 1
}

/** Lignes (ou colonnes) à rendre pour une position de défilement, avec une marge de chaque côté. */
export function visibleRange(
  offset: number,
  viewport: number,
  itemSize: number,
  count: number,
  overscan = 3
): [number, number] {
  if (count === 0) return [0, -1]
  const first = Math.max(0, Math.floor(offset / itemSize) - overscan)
  const last = Math.min(count - 1, Math.ceil((offset + viewport) / itemSize) + overscan)
  return [first, last]
}

/** Les tranches de chargement qui couvrent [from, to[ : la grille demande par tranches de 6 h. */
export const CHUNK = 6 * HOUR
export function chunksBetween(from: number, to: number): number[] {
  const chunks: number[] = []
  for (let c = floorTo(from, CHUNK); c < to; c += CHUNK) chunks.push(c)
  return chunks
}

/** Repères de l'en-tête : toutes les demi-heures dans [from, to]. */
export function timeTicks(from: number, to: number, step = HALF_HOUR): number[] {
  const ticks: number[] = []
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t)
  return ticks
}

/** Part écoulée d'un programme à l'instant `now`, entre 0 et 1. */
export const progressOf = (p: { start: number; stop: number }, now: number): number =>
  p.stop <= p.start ? 0 : Math.min(1, Math.max(0, (now - p.start) / (p.stop - p.start)))

const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })

export const fmtTime = (t: number): string => time.format(new Date(t * 1000))

/** Minuit local de l'instant `t` : les jours de la grille sont ceux de l'utilisateur, pas d'UTC. */
export function localMidnight(t: number): number {
  const d = new Date(t * 1000)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

/** « Aujourd'hui », « Demain », puis « sam. 1 nov. ». */
export function fmtDay(t: number, now: number): string {
  const days = Math.round((localMidnight(t) - localMidnight(now)) / DAY)
  if (days === 0) return 'Aujourd’hui'
  if (days === 1) return 'Demain'
  if (days === -1) return 'Hier'
  return day.format(new Date(t * 1000))
}

/** « 20:50 – 22:40 · 1 h 50 » */
export function fmtSlot(p: { start: number; stop: number }): string {
  const minutes = Math.round((p.stop - p.start) / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const length = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
  return `${fmtTime(p.start)} – ${fmtTime(p.stop)} · ${length}`
}

/** Logo d'une chaîne : la copie en cache s'il y en a une, sinon l'original via le proxy d'images. */
export const channelLogo = (c: IptvChannel): string | null =>
  c.logoPath ? toMediaUrl(c.logoPath) : c.logoUrl ? toImageUrl(c.logoUrl) : null
