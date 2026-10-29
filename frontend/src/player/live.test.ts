import { describe, expect, it } from 'vitest'
import { liveStats, MAX_RECONNECTS, reconnectDelay, sortVariants, variantLabel } from './live'

describe('reconnectDelay', () => {
  it('double à chaque tentative, puis plafonne', () => {
    expect([0, 1, 2, 3, 4, 5].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000])
  })

  it('laisse le temps de traverser une coupure de dix secondes', () => {
    // Critère de l'issue #29 : le réseau revient au bout de 10 s
    const lastStart = Array.from({ length: MAX_RECONNECTS }, (_, i) => reconnectDelay(i)).reduce(
      (a, b) => a + b
    )
    expect(lastStart).toBeGreaterThan(10_000)
  })
})

describe('liveStats', () => {
  it('décrit la résolution et le débit', () => {
    expect(liveStats(1080, 4200)).toBe('1080p · 4.2 Mb/s')
  })

  it('omet ce qui n’est pas encore connu', () => {
    expect(liveStats(720, 0)).toBe('720p')
    expect(liveStats(0, 0)).toBeNull()
  })
})

describe('variantLabel', () => {
  it('nomme une variante par sa résolution et son débit', () => {
    expect(variantLabel({ index: 0, height: 720, bandwidth: 2_111_272 })).toBe('720p · 2.1 Mb/s')
  })

  it('se contente du débit, ou du rang, faute de mieux', () => {
    expect(variantLabel({ index: 0, height: null, bandwidth: 1_042_180 })).toBe('1.0 Mb/s')
    expect(variantLabel({ index: 2, height: null, bandwidth: null })).toBe('Variante 3')
  })
})

describe('sortVariants', () => {
  it('met la meilleure qualité en tête sans perdre le rang d’origine', () => {
    const sorted = sortVariants([
      { index: 0, height: null, bandwidth: 1_000_000 },
      { index: 1, height: null, bandwidth: 3_000_000 },
      { index: 2, height: null, bandwidth: 600_000 }
    ])
    expect(sorted.map((v) => v.index)).toEqual([1, 0, 2])
  })
})
