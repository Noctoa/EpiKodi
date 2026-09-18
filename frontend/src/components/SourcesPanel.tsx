import type { ScanProgress } from '@shared/ipc'
import type { Source } from '@shared/models'
import './SourcesPanel.css'

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
      {p.scanned} fichiers · +{p.added} ~{p.updated} −{p.removed}
    </span>
  )
}

export function SourcesPanel({ sources, scans, onAdd, onScan, onCancel, onRemove }: Props) {
  return (
    <aside className="sources">
      <div className="sources__head">
        <h2>Sources</h2>
        <button onClick={onAdd}>+ Dossier</button>
      </div>
      {sources.length === 0 && (
        <p className="sources__empty">Ajoute un dossier contenant des vidéos ou de la musique.</p>
      )}
      <ul className="sources__list">
        {sources.map((s) => {
          const p = scans[s.id]
          const scanning = p && !p.done
          return (
            <li key={s.id} className="source">
              <div className="source__name">{s.name}</div>
              <div className="source__path" title={s.path}>
                {s.path}
              </div>
              {p && <ScanStatus p={p} />}
              <div className="source__actions">
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
    </aside>
  )
}
