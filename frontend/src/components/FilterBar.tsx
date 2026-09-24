import type { Facets, MediaQuery, MediaSort, Source } from '@shared/models'
import './FilterBar.css'

interface Props {
  query: MediaQuery
  facets: Facets
  sources: Source[]
  onChange: (patch: Partial<MediaQuery>) => void
  onReset: () => void
  /** Nombre de résultats affichés */
  count: number
}

const SORTS: { value: MediaSort; label: string }[] = [
  { value: 'title', label: 'Nom' },
  { value: 'addedAt', label: "Date d'ajout" },
  { value: 'duration', label: 'Durée' },
  { value: 'year', label: 'Année' }
]

/** `undefined` quand l'option « toutes » est choisie, pour retirer le filtre. */
const pick = <T,>(value: string, parse: (v: string) => T): T | undefined =>
  value === '' ? undefined : parse(value)

export function FilterBar({
  query,
  facets,
  sources,
  onChange,
  onReset,
  count
}: Props): React.JSX.Element {
  const active =
    query.genre !== undefined ||
    query.year !== undefined ||
    query.sourceId !== undefined ||
    query.unwatched === true

  return (
    <div className="filters">
      {sources.length > 1 && (
        <label className="filters__field">
          Source
          <select
            value={query.sourceId ?? ''}
            onChange={(e) => onChange({ sourceId: pick(e.target.value, Number) })}
          >
            <option value="">Toutes</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {facets.genres.length > 0 && (
        <label className="filters__field">
          Genre
          <select
            value={query.genre ?? ''}
            onChange={(e) => onChange({ genre: pick(e.target.value, String) })}
          >
            <option value="">Tous</option>
            {facets.genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      )}

      {facets.years.length > 0 && (
        <label className="filters__field">
          Année
          <select
            value={query.year ?? ''}
            onChange={(e) => onChange({ year: pick(e.target.value, Number) })}
          >
            <option value="">Toutes</option>
            {facets.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="filters__check">
        <input
          type="checkbox"
          checked={query.unwatched === true}
          onChange={(e) => onChange({ unwatched: e.target.checked || undefined })}
        />
        Non vus
      </label>

      <span className="filters__spacer" />

      <label className="filters__field">
        Trier par
        <select
          value={query.sort ?? 'title'}
          onChange={(e) => onChange({ sort: e.target.value as MediaSort })}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="btn--ghost"
        onClick={() => onChange({ order: query.order === 'desc' ? 'asc' : 'desc' })}
        title={query.order === 'desc' ? 'Ordre décroissant' : 'Ordre croissant'}
      >
        {query.order === 'desc' ? '↓' : '↑'}
      </button>

      <span className="filters__count">{count} résultat(s)</span>
      {active && (
        <button className="btn--ghost" onClick={onReset}>
          Réinitialiser
        </button>
      )}
    </div>
  )
}
