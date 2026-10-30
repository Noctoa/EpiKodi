import { describe, expect, it } from 'vitest'
import type { EpgProgramme } from '@shared/models'
import {
  chunksBetween,
  fmtSlot,
  guideWindow,
  HOUR,
  progressOf,
  rowSegments,
  segmentAt,
  timeTicks,
  visibleRange
} from './guide'

const T0 = Date.parse('2026-10-30T18:00:00Z') / 1000

const prog = (title: string, startMin: number, stopMin: number): EpgProgramme => ({
  id: startMin,
  channelKey: 'tf1.fr',
  start: T0 + startMin * 60,
  stop: T0 + stopMin * 60,
  title,
  subtitle: null,
  description: null,
  category: null,
  iconUrl: null,
  episode: null
})

const shape = (segments: ReturnType<typeof rowSegments>): string[] =>
  segments.map((s) => `${s.programme?.title ?? '·'} ${(s.start - T0) / 60}-${(s.stop - T0) / 60}`)

describe('rowSegments', () => {
  it('comble les trous pour qu’une ligne n’ait jamais de vide', () => {
    const segments = rowSegments(
      [prog('Journal', 0, 40), prog('Film', 60, 180)],
      T0 - 30 * 60,
      T0 + 240 * 60
    )
    expect(shape(segments)).toEqual([
      '· -30-0',
      'Journal 0-40',
      '· 40-60',
      'Film 60-180',
      '· 180-240'
    ])
  })

  it('rogne ce qui déborde de la fenêtre', () => {
    const segments = rowSegments([prog('Long', -60, 120)], T0, T0 + 60 * 60)
    expect(shape(segments)).toEqual(['Long 0-60'])
    // Le programme est entier : la fiche montre ses vrais horaires
    expect(segments[0].programme?.start).toBe(T0 - HOUR)
  })

  it('rabote un programme qui chevauche le précédent au lieu de le superposer', () => {
    const segments = rowSegments([prog('B', 25, 60), prog('A', 0, 30)], T0, T0 + 60 * 60)
    expect(shape(segments)).toEqual(['A 0-30', 'B 30-60'])
  })

  it('fait d’une chaîne sans guide un seul bloc, ou des tranches pour la manette', () => {
    expect(shape(rowSegments([], T0, T0 + 3 * HOUR))).toEqual(['· 0-180'])
    expect(shape(rowSegments([], T0 - 30 * 60, T0 + 2 * HOUR, HOUR))).toEqual([
      '· -30-0',
      '· 0-60',
      '· 60-120'
    ])
  })
})

describe('segmentAt', () => {
  const segments = rowSegments([prog('Journal', 0, 40), prog('Film', 60, 180)], T0, T0 + 4 * HOUR)

  it('trouve le bloc qui contient l’instant', () => {
    expect(segments[segmentAt(segments, T0 + 90 * 60)].programme?.title).toBe('Film')
    expect(segments[segmentAt(segments, T0 + 40 * 60)].kind).toBe('gap')
  })

  it('se rabat sur le bord quand l’instant sort de la ligne', () => {
    expect(segmentAt(segments, T0 - HOUR)).toBe(0)
    expect(segmentAt(segments, T0 + 10 * HOUR)).toBe(segments.length - 1)
    expect(segmentAt([], T0)).toBe(-1)
  })
})

describe('visibleRange', () => {
  it('ne rend que les lignes à l’écran, plus une marge', () => {
    // 200 chaînes de 60 px, fenêtre de 600 px défilée à 3 000 px
    expect(visibleRange(3000, 600, 60, 200, 2)).toEqual([48, 62])
    expect(visibleRange(0, 600, 60, 200, 2)).toEqual([0, 12])
    expect(visibleRange(11_800, 600, 60, 200, 2)).toEqual([194, 199])
    expect(visibleRange(0, 600, 60, 0)).toEqual([0, -1])
  })
})

describe('fenêtre et repères', () => {
  it('commence un peu avant maintenant, sur une demi-heure, et couvre la semaine', () => {
    const w = guideWindow(T0 + 47 * 60)
    expect(w.from).toBe(T0 - 1.5 * HOUR)
    expect((w.to - w.from) / HOUR).toBe(8 * 24)
  })

  it('découpe en tranches et en demi-heures alignées', () => {
    expect(chunksBetween(T0 + HOUR, T0 + 7 * HOUR).map((c) => (c - T0) / HOUR)).toEqual([0, 6])
    expect(timeTicks(T0 + 10 * 60, T0 + 90 * 60).map((t) => (t - T0) / 60)).toEqual([30, 60, 90])
  })

  it('mesure l’avancement et la durée d’un programme', () => {
    const p = prog('Film', 0, 110)
    expect(progressOf(p, T0 + 55 * 60)).toBeCloseTo(0.5)
    expect(progressOf(p, T0 - HOUR)).toBe(0)
    expect(progressOf(p, T0 + 5 * HOUR)).toBe(1)
    expect(fmtSlot(p)).toMatch(/ – .* · 1 h 50$/)
  })
})
