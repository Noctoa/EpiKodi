import type { ScanProgress } from '@shared/ipc'
import type { Source } from '@shared/models'
import './SourcesView.css'

interface Props {
  sources: Source[]
  scans: Record<number, ScanProgress>
  onAdd: () => void
  onScan: (id: number) => void
  onCancel: (id: number) => void
  onRemove: (id: number) => void
}

function ScanStatus({ p }: { p: ScanProgress }): React.JSX.Element {
  if (p.error) return <span className="scan scan--error">Erreur : {p.error}</span>
  if (!p.done) {
    return (
      <span className="scan scan--running">
        Scan… {p.scanned} fichiers · {p.current.split('/').pop()}
      </span>
    )
  }
  return (
    <span className="scan">
      {p.scanned} fichiers · +{p.added} ajouté(s) · ~{p.updated} modifié(s) · −{p.removed} retiré(s)
    </span>
  )
}

const fmtDate = (ts: number | null): string =>
  ts === null
    ? 'jamais'
    : new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

export function SourcesView({
  sources,
  scans,
  onAdd,
  onScan,
  onCancel,
  onRemove
}: Props): React.JSX.Element {
  return (
    <div className="sources-view">
      <div className="sources-view__head">
        <p className="sources-view__intro">
          Les dossiers surveillés par la bibliothèque. Ils sont rescannés à chaque démarrage.
        </p>
        <button onClick={onAdd}>+ Ajouter un dossier</button>
      </div>

      {sources.length === 0 ? (
        <p className="sources-view__empty">
          Aucune source. Ajoute un dossier contenant des vidéos ou de la musique pour remplir la
          bibliothèque.
        </p>
      ) : (
        <ul className="sources-view__list">
          {sources.map((s) => {
            const p = scans[s.id]
            const scanning = p && !p.done
            return (
              <li key={s.id} className="source-card">
                <div className="source-card__main">
                  <div className="source-card__name">{s.name}</div>
                  <div className="source-card__path" title={s.path}>
                    {s.path}
                  </div>
                  {p ? (
                    <ScanStatus p={p} />
                  ) : (
                    <span className="scan">Dernier scan : {fmtDate(s.lastScanAt)}</span>
                  )}
                </div>
                <div className="source-card__actions">
                  {scanning ? (
                    <button className="btn--ghost" onClick={() => onCancel(s.id)}>
                      Annuler
                    </button>
                  ) : (
                    <button className="btn--ghost" onClick={() => onScan(s.id)}>
                      Rescanner
                    </button>
                  )}
                  <button className="btn--ghost btn--danger" onClick={() => onRemove(s.id)}>
                    Supprimer
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
