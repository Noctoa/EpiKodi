import type { Guess, GuessKind } from './filename'

/** Un candidat renvoyé par une source de métadonnées. */
export interface MetadataMatch {
  /** Identifiant de la source : « tmdb », et demain celui d'un plugin */
  provider: string
  /** Identifiant complet et stable : « tmdb:movie:27205 » */
  externalId: string
  kind: GuessKind
  title: string
  originalTitle: string | null
  year: number | null
  overview: string | null
  rating: number | null
  posterUrl: string | null
  backdropUrl: string | null
  /** Pertinence estimée localement, entre 0 et 1 */
  score: number
}

export interface MetadataDetails extends MetadataMatch {
  genres: string[]
  /** Têtes d'affiche, dans l'ordre du générique */
  cast: string[]
  /** Minutes */
  runtime: number | null
}

/**
 * Source de métadonnées. TheMovieDB en est une implémentation ; l'interface existe pour qu'un
 * plugin (#15) puisse en enregistrer d'autres sans toucher au cœur de l'application.
 */
export interface MetadataProvider {
  readonly id: string
  readonly name: string
  /** false quand il manque une clé d'API : l'identification est alors simplement ignorée. */
  configured(): boolean
  search(guess: Guess, limit?: number): Promise<MetadataMatch[]>
  details(externalId: string): Promise<MetadataDetails | null>
}

const providers = new Map<string, MetadataProvider>()

export function registerProvider(provider: MetadataProvider): void {
  providers.set(provider.id, provider)
}

export function listProviders(): MetadataProvider[] {
  return [...providers.values()]
}

/** Retrouve la source capable de détailler un identifiant « <source>:… ». */
export function providerFor(externalId: string): MetadataProvider | null {
  return providers.get(externalId.split(':')[0]) ?? null
}
