import { useState } from 'react'
import type { ScanProgress } from '@shared/ipc'
import type { Source } from '@shared/models'
import './SourcesView.css'

interface Props {
  sources: Source[]
  scans: Record<number, ScanProgress>
  /** false = source injoignable pour le moment */
  availability: Record<number, boolean>
  onAdd: () => void
  onAddNetwork: (url: string, password: string | null) => Promise<string | null>
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

function NetworkForm({
  onSubmit
}: {
  onSubmit: (url: string, password: string | null) => Promise<string | null>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) {
    return (
      <button className="btn--ghost" onClick={() => setOpen(true)}>
        + Partage réseau
      </button>
    )
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    void onSubmit(url.trim(), password || null).then((err) => {
      setBusy(false)
      if (err) return setError(err)
      setOpen(false)
      setUrl('')
      setPassword('')
    })
  }

  return (
    <form className="network-form" onSubmit={submit}>
      <label>
        Adresse
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="smb://utilisateur@nas/media/Films"
        />
      </label>
      <label>
        Mot de passe
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="facultatif"
        />
      </label>
      <p className="network-form__hint">
        Partages Windows/Samba (<code>smb://</code>) et serveurs WebDAV (<code>https://</code>). Un
        export NFS se monte côté système puis s'ajoute comme un dossier ordinaire.
      </p>
      {error && <p className="network-form__error">{error}</p>}
      <div className="network-form__actions">
        <button type="submit" disabled={busy || !url.trim()}>
          {busy ? 'Connexion…' : 'Ajouter'}
        </button>
        <button type="button" className="btn--ghost" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  )
}

export function SourcesView({
  sources,
  scans,
  availability,
  onAdd,
  onAddNetwork,
  onScan,
  onCancel,
  onRemove
}: Props): React.JSX.Element {
  return (
    <div className="sources-view">
      <div className="sources-view__head">
        <p className="sources-view__intro">
          Les dossiers et partages surveillés par la bibliothèque. Ils sont rescannés à chaque
          démarrage.
        </p>
        <div className="sources-view__actions">
          <NetworkForm onSubmit={onAddNetwork} />
          <button onClick={onAdd}>+ Ajouter un dossier</button>
        </div>
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
                  <div className="source-card__name">
                    {s.name}
                    {s.type !== 'local' && <span className="source-card__kind">{s.type}</span>}
                    {availability[s.id] === false && (
                      <span
                        className="source-card__offline"
                        title="Source injoignable pour le moment"
                      >
                        hors ligne
                      </span>
                    )}
                  </div>
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
