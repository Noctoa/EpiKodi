/** Comparaison de titres, indépendante de la source interrogée. Pure et testée. */

/** Minuscules, sans accents ni ponctuation : « L'Été, le film ! » → « l ete le film ». */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Similarité 0..1 par mots communs (indice de Jaccard pondéré par l'ordre). */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a)
  const right = normalizeTitle(b)
  if (!left || !right) return 0
  if (left === right) return 1

  const wordsA = left.split(' ')
  const wordsB = right.split(' ')
  const setB = new Set(wordsB)
  const common = wordsA.filter((w) => setB.has(w)).length
  const jaccard = common / new Set([...wordsA, ...wordsB]).size

  // Un titre entièrement contenu dans l'autre (« Alien » vs « Alien, le huitième passager »)
  const containment = left.includes(right) || right.includes(left) ? 0.25 : 0
  return Math.min(1, jaccard + containment)
}

/**
 * Note finale d'un candidat : la ressemblance du titre, relevée quand l'année correspond et
 * abaissée quand elle diverge nettement.
 */
export function scoreCandidate(
  guessTitle: string,
  guessYear: number | null,
  candidateTitle: string,
  candidateYear: number | null,
  alternateTitle?: string | null
): number {
  const base = Math.max(
    titleSimilarity(guessTitle, candidateTitle),
    alternateTitle ? titleSimilarity(guessTitle, alternateTitle) : 0
  )
  if (guessYear === null || candidateYear === null) return Number(base.toFixed(3))

  const gap = Math.abs(guessYear - candidateYear)
  const yearFactor = gap === 0 ? 0.3 : gap === 1 ? 0.1 : gap <= 3 ? 0 : -0.3
  return Number(Math.max(0, Math.min(1, base + yearFactor)).toFixed(3))
}

/** Au-dessus de ce seuil, l'identification est retenue sans demander confirmation. */
export const AUTO_MATCH_THRESHOLD = 0.75

/**
 * Le moteur de recherche de la source compare aussi les titres alternatifs, ce que nous ne
 * pouvons pas faire localement : « Spirited Away » désigne « Le Voyage de Chihiro », dont aucun
 * mot ne coïncide. Quand un résultat arrive en tête ET que son année correspond exactement, on
 * fait confiance à ce classement plutôt qu'à notre seule comparaison de titres.
 */
export function withRankBonus(
  score: number,
  rank: number,
  guessYear: number | null,
  candidateYear: number | null
): number {
  const corroborated = rank === 0 && guessYear !== null && guessYear === candidateYear
  return corroborated ? Math.max(score, AUTO_MATCH_THRESHOLD + 0.05) : score
}
