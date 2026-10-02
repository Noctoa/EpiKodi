import { useCallback, useEffect, useState } from 'react'
import { toImageUrl, type MetadataMatch } from '@shared/ipc'
import './MatchPicker.css'

interface Props {
  mediaId: number
  /** Titre courant, proposé comme première recherche */
  initialQuery: string
  onClose: () => void
  onApplied: () => void
}

/**
 * « Corriger l'identification » : propose les candidats de la source externe et laisse
 * l'utilisateur trancher quand l'heuristique de nom de fichier s'est trompée.
 */
export function MatchPicker({
  mediaId,
  initialQuery,
  onClose,
  onApplied
}: Props): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [matches, setMatches] = useState<MetadataMatch[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** Recherche déclenchée par le formulaire ; la première est faite par l'effet ci-dessous. */
  const search = useCallback(
    async (term?: string) => {
      setBusy(true)
      setError(null)
      try {
        setMatches(await window.epikodi.metadataSuggest(mediaId, term))
      } catch (err) {
        setError((err as Error).message)
      }
      setBusy(false)
    },
    [mediaId]
  )

  // Première ouverture : on part du titre deviné depuis le nom de fichier
  useEffect(() => {
    let cancelled = false
    window.epikodi.metadataSuggest(mediaId).then(
      (found) => {
        if (cancelled) return
        setMatches(found)
        setBusy(false)
      },
      (err: Error) => {
        if (cancelled) return
        setError(err.message)
        setBusy(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [mediaId])

  const apply = useCallback(
    async (match: MetadataMatch) => {
      setBusy(true)
      try {
        await window.epikodi.metadataApply(mediaId, match.externalId)
        onApplied()
        onClose()
      } catch (err) {
        setError((err as Error).message)
        setBusy(false)
      }
    },
    [mediaId, onApplied, onClose]
  )

  return (
    <div className="picker" role="dialog" aria-label="Corriger l'identification">
      <div className="picker__panel" onClick={(e) => e.stopPropagation()}>
        <div className="picker__head">
          <h3>Corriger l'identification</h3>
          <button className="btn--ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <form
          className="picker__search"
          onSubmit={(e) => {
            e.preventDefault()
            void search(query.trim() || undefined)
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Titre du film ou de la série"
          />
          <button type="submit" disabled={busy}>
            Rechercher
          </button>
        </form>

        {error && <p className="picker__error">{error}</p>}
        {busy && matches.length === 0 && <p className="picker__info">Recherche…</p>}
        {!busy && matches.length === 0 && !error && (
          <p className="picker__info">Aucun résultat. Essaie un autre titre.</p>
        )}

        <ul className="picker__results">
          {matches.map((m) => (
            <li key={m.externalId}>
              <div className="picker__poster">
                {m.posterUrl ? (
                  <img src={toImageUrl(m.posterUrl)} alt="" loading="lazy" />
                ) : (
                  <span>▦</span>
                )}
              </div>
              <div className="picker__info-block">
                <div className="picker__title">
                  {m.title}
                  {m.year && <span className="picker__year"> ({m.year})</span>}
                  {m.kind === 'tv' && <span className="picker__kind">série</span>}
                  <span className="picker__source" title={`Fiche fournie par ${m.providerName}`}>
                    {m.providerName}
                  </span>
                </div>
                {m.originalTitle && m.originalTitle !== m.title && (
                  <div className="picker__original">{m.originalTitle}</div>
                )}
                {m.overview && <p className="picker__overview">{m.overview}</p>}
              </div>
              <button className="btn--ghost" disabled={busy} onClick={() => void apply(m)}>
                Choisir
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
