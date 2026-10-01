import type { Guess } from './filename'
import { scoreCandidate, withRankBonus } from './score'
import type { MetadataDetails, MetadataMatch, MetadataProvider } from './types'

const API = 'https://api.themoviedb.org/3'
const IMAGES = 'https://image.tmdb.org/t/p'
const TIMEOUT_MS = 15_000

/** Langue des synopsis ; TMDB retombe sur l'anglais quand la traduction manque. */
const LANGUAGE = 'fr-FR'

interface TmdbResult {
  id: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
  overview?: string
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
}

interface TmdbDetails extends TmdbResult {
  genres?: { name: string }[]
  runtime?: number
  episode_run_time?: number[]
  credits?: { cast?: { name: string }[] }
}

const yearOf = (result: TmdbResult): number | null => {
  const date = result.release_date ?? result.first_air_date ?? ''
  const year = Number(date.slice(0, 4))
  return Number.isFinite(year) && year > 1800 ? year : null
}

const imageUrl = (path: string | null | undefined, size: string): string | null =>
  path ? `${IMAGES}/${size}${path}` : null

/**
 * TheMovieDB : base communautaire de films et séries, dont l'API est gratuite mais demande une
 * clé personnelle. La clé n'est jamais écrite dans le code ; elle vient des Paramètres et est
 * conservée chiffrée (voir `backend/library.ts`).
 */
export class TmdbProvider implements MetadataProvider {
  readonly id = 'tmdb'
  readonly name = 'TheMovieDB'

  constructor(private apiKey: string | null) {}

  setApiKey(key: string | null): void {
    this.apiKey = key?.trim() || null
  }

  configured(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0
  }

  /**
   * TMDB distribue deux formes de clé : la clé v3 (passée en paramètre) et le jeton v4 (un JWT
   * passé en en-tête). On accepte les deux pour éviter un « clé invalide » déroutant.
   */
  private async call<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    if (!this.apiKey) throw new Error('clé TheMovieDB absente')
    const url = new URL(`${API}${path}`)
    url.searchParams.set('language', LANGUAGE)
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value)
    }

    const isJwt = this.apiKey.startsWith('eyJ')
    if (!isJwt) url.searchParams.set('api_key', this.apiKey)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: isJwt ? { Authorization: `Bearer ${this.apiKey}` } : {}
      })
      if (res.status === 401) throw new Error('clé TheMovieDB refusée')
      if (res.status === 429) throw new Error('trop de requêtes TheMovieDB, réessaie plus tard')
      if (!res.ok) throw new Error(`TheMovieDB a répondu ${res.status}`)
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  private toMatch(result: TmdbResult, kind: Guess['kind'], guess?: Guess): MetadataMatch {
    const title = result.title ?? result.name ?? 'Sans titre'
    const original = result.original_title ?? result.original_name ?? null
    const year = yearOf(result)
    return {
      provider: this.id,
      externalId: `tmdb:${kind}:${result.id}`,
      kind,
      title,
      originalTitle: original,
      year,
      overview: result.overview?.trim() || null,
      rating:
        typeof result.vote_average === 'number' && result.vote_average > 0
          ? result.vote_average
          : null,
      posterUrl: imageUrl(result.poster_path, 'w500'),
      backdropUrl: imageUrl(result.backdrop_path, 'w1280'),
      score: guess ? scoreCandidate(guess.title, guess.year, title, year, original) : 0
    }
  }

  async search(guess: Guess, limit = 10): Promise<MetadataMatch[]> {
    const path = guess.kind === 'tv' ? '/search/tv' : '/search/movie'
    const params: Record<string, string> = { query: guess.title }
    // L'année ne filtre que les films : pour une série elle désigne la première diffusion
    if (guess.kind === 'movie' && guess.year) params['year'] = String(guess.year)

    let data = await this.call<{ results?: TmdbResult[] }>(path, params)
    // Une année erronée dans le nom de fichier ne doit pas donner zéro résultat
    if ((data.results ?? []).length === 0 && params['year']) {
      data = await this.call<{ results?: TmdbResult[] }>(path, { query: guess.title })
    }

    return (data.results ?? [])
      .map((r, rank) => {
        const match = this.toMatch(r, guess.kind, guess)
        return { ...match, score: withRankBonus(match.score, rank, guess.year, match.year) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  async details(externalId: string): Promise<MetadataDetails | null> {
    const [, kind, id] = externalId.split(':')
    if (!id) return null
    const data = await this.call<TmdbDetails>(`/${kind === 'tv' ? 'tv' : 'movie'}/${id}`, {
      append_to_response: 'credits'
    })
    const match = this.toMatch(data, kind === 'tv' ? 'tv' : 'movie')
    return {
      ...match,
      score: 1,
      genres: (data.genres ?? []).map((g) => g.name).filter(Boolean),
      cast: (data.credits?.cast ?? [])
        .slice(0, 8)
        .map((c) => c.name)
        .filter(Boolean),
      runtime: data.runtime ?? data.episode_run_time?.[0] ?? null
    }
  }
}
