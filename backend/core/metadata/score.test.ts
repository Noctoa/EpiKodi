import { describe, expect, it } from 'vitest'
import {
  AUTO_MATCH_THRESHOLD,
  normalizeTitle,
  scoreCandidate,
  titleSimilarity,
  withRankBonus
} from './score'

describe('normalizeTitle', () => {
  it('ignore accents, casse et ponctuation', () => {
    expect(normalizeTitle("L'Été, le film !")).toBe('l ete le film')
    expect(normalizeTitle('Mission: Impossible')).toBe('mission impossible')
  })
})

describe('titleSimilarity', () => {
  it('reconnaît un titre identique malgré la mise en forme', () => {
    expect(titleSimilarity('Inception', 'INCEPTION')).toBe(1)
    expect(titleSimilarity('Le Fabuleux Destin', 'le fabuleux destin')).toBe(1)
  })

  it('relève un titre contenu dans un autre', () => {
    expect(titleSimilarity('Alien', 'Alien, le huitième passager')).toBeGreaterThan(0.4)
  })

  it('distingue deux titres sans rapport', () => {
    expect(titleSimilarity('Inception', 'Titanic')).toBeLessThan(0.2)
  })

  it('renvoie 0 pour une chaîne vide', () => {
    expect(titleSimilarity('', 'Inception')).toBe(0)
  })
})

describe('scoreCandidate', () => {
  it('récompense une année identique', () => {
    const exact = scoreCandidate('Inception', 2010, 'Inception', 2010)
    const autre = scoreCandidate('Inception', 2010, 'Inception', 1998)
    expect(exact).toBeGreaterThan(AUTO_MATCH_THRESHOLD)
    expect(exact).toBeGreaterThan(autre)
  })

  it('tolère un an d’écart, pénalise au-delà', () => {
    expect(scoreCandidate('Un Film', 2015, 'Un Film', 2016)).toBeGreaterThan(
      scoreCandidate('Un Film', 2015, 'Un Film', 2001)
    )
  })

  it('se rabat sur le titre quand une année manque', () => {
    expect(scoreCandidate('Inception', null, 'Inception', 2010)).toBe(1)
    expect(scoreCandidate('Inception', 2010, 'Inception', null)).toBe(1)
  })

  it('retient le titre original quand il colle mieux', () => {
    const score = scoreCandidate(
      'The Eighth Passenger',
      null,
      'Alien',
      null,
      'The Eighth Passenger'
    )
    expect(score).toBe(1)
  })

  it('ne dépasse jamais les bornes 0 et 1', () => {
    expect(scoreCandidate('Film', 2020, 'Film', 2020)).toBeLessThanOrEqual(1)
    expect(scoreCandidate('Rien', 2020, 'Autre Chose', 1950)).toBeGreaterThanOrEqual(0)
  })

  it('laisse un mauvais candidat sous le seuil d’acceptation automatique', () => {
    expect(scoreCandidate('Inception', 2010, 'Titanic', 1997)).toBeLessThan(AUTO_MATCH_THRESHOLD)
  })
})

describe('withRankBonus', () => {
  it('accepte un premier résultat dont l’année correspond, même si le titre diffère', () => {
    // « Spirited Away » cherché, « Le Voyage de Chihiro » renvoyé : aucun mot commun
    const brut = scoreCandidate('Spirited Away', 2001, 'Le Voyage de Chihiro', 2001)
    expect(brut).toBeLessThan(AUTO_MATCH_THRESHOLD)
    expect(withRankBonus(brut, 0, 2001, 2001)).toBeGreaterThan(AUTO_MATCH_THRESHOLD)
  })

  it('n’avantage pas les résultats suivants', () => {
    expect(withRankBonus(0.2, 1, 2001, 2001)).toBe(0.2)
  })

  it('exige une année identique, pas seulement proche', () => {
    expect(withRankBonus(0.2, 0, 2001, 2002)).toBe(0.2)
    expect(withRankBonus(0.2, 0, null, 2001)).toBe(0.2)
  })

  it('ne dégrade jamais un score déjà élevé', () => {
    expect(withRankBonus(0.95, 0, 2010, 2010)).toBe(0.95)
  })
})
