import type { Guess } from '../metadata/filename'
import { scoreCandidate } from '../metadata/score'
import type { MetadataDetails, MetadataMatch, MetadataProvider } from '../metadata/types'
import type { PluginManager, PluginInfo } from './manager'
import type { PluginMatch } from './protocol'

/**
 * Présente un plugin comme une source de métadonnées ordinaire. C'est ce qui permet à une
 * extension d'enrichir la bibliothèque sans que le cœur de l'application ne la connaisse :
 * elle passe par la même interface que TheMovieDB.
 */
export class PluginMetadataProvider implements MetadataProvider {
  readonly id: string
  readonly name: string

  constructor(
    private manager: PluginManager,
    private info: PluginInfo
  ) {
    this.id = `plugin:${info.manifest.id}`
    this.name = info.manifest.name
  }

  configured(): boolean {
    return this.info.status === 'active'
  }

  private toMatch(raw: PluginMatch, guess?: Guess): MetadataMatch {
    return {
      provider: this.id,
      externalId: `${this.id}:${raw.externalId}`,
      kind: raw.kind,
      title: raw.title,
      originalTitle: raw.originalTitle ?? null,
      year: raw.year ?? null,
      overview: raw.overview ?? null,
      rating: raw.rating ?? null,
      posterUrl: raw.posterUrl ?? null,
      backdropUrl: raw.backdropUrl ?? null,
      score: guess
        ? scoreCandidate(guess.title, guess.year, raw.title, raw.year ?? null, raw.originalTitle)
        : 1
    }
  }

  async search(guess: Guess, limit = 10): Promise<MetadataMatch[]> {
    const raw = (await this.manager.call(this.info.manifest.id, 'search', {
      title: guess.title,
      year: guess.year,
      kind: guess.kind
    })) as PluginMatch[] | null

    return (raw ?? [])
      .map((r) => this.toMatch(r, guess))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  async details(externalId: string): Promise<MetadataDetails | null> {
    // On retire notre préfixe avant de redonner l'identifiant au plugin
    const own = externalId.startsWith(`${this.id}:`)
      ? externalId.slice(this.id.length + 1)
      : externalId
    const raw = (await this.manager.call(
      this.info.manifest.id,
      'details',
      own
    )) as PluginMatch | null
    if (!raw) return null
    return {
      ...this.toMatch(raw),
      score: 1,
      genres: raw.genres ?? [],
      cast: raw.cast ?? [],
      runtime: raw.runtime ?? null
    }
  }
}
