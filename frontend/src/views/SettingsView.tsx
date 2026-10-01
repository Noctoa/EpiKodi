import { useCallback, useEffect, useState } from 'react'
import type { MetadataStatus, SystemInfo } from '@shared/ipc'
import './SettingsView.css'

/** Clé TheMovieDB : saisie, enregistrement chiffré, et effacement. */
function MetadataSettings(): React.JSX.Element {
  const [status, setStatus] = useState<MetadataStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.epikodi.metadataStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (value: string | null) => {
    setBusy(true)
    setMessage(null)
    try {
      setStatus(await window.epikodi.metadataSetKey(value))
      setKey('')
      setMessage(
        value ? 'Clé enregistrée. L’identification démarre en arrière-plan.' : 'Clé effacée.'
      )
    } catch (err) {
      setMessage((err as Error).message)
    }
    setBusy(false)
  }, [])

  return (
    <section className="settings__block">
      <h3>Métadonnées des films</h3>
      <p className="settings__todo">
        EpiKodi peut récupérer affiches, synopsis, notes, genres et casting depuis{' '}
        <strong>TheMovieDB</strong>. L’API est gratuite mais demande une clé personnelle, à créer
        depuis les paramètres de ton compte sur themoviedb.org (rubrique API). La clé est chiffrée
        par le trousseau du système et n’apparaît jamais dans le code.
      </p>
      <dl>
        <dt>État</dt>
        <dd>
          {status?.configured ? (
            <span className="settings__ok">clé enregistrée</span>
          ) : (
            <span className="settings__warn">aucune clé — identification désactivée</span>
          )}
          {status && status.pending > 0 && (
            <span className="settings__hint"> · {status.pending} média(s) en attente</span>
          )}
        </dd>
      </dl>
      <div className="settings__key">
        <input
          type="password"
          value={key}
          placeholder={status?.configured ? 'Remplacer la clé…' : 'Colle ta clé TheMovieDB'}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && void save(key.trim())}
        />
        <button disabled={busy || !key.trim()} onClick={() => void save(key.trim())}>
          Enregistrer
        </button>
        {status?.configured && (
          <button
            className="btn--ghost btn--danger"
            disabled={busy}
            onClick={() => void save(null)}
          >
            Effacer
          </button>
        )}
      </div>
      {message && <p className="settings__message">{message}</p>}
    </section>
  )
}

export function SettingsView(): React.JSX.Element {
  const [info, setInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    window.epikodi.systemInfo().then((i) => {
      if (!cancelled) setInfo(i)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!info) return <p className="settings__loading">Chargement…</p>

  return (
    <div className="settings">
      <section className="settings__block">
        <h3>Système</h3>
        <dl>
          <dt>Version</dt>
          <dd>EpiKodi {info.version}</dd>
          <dt>FFmpeg</dt>
          <dd>
            {info.ffmpeg.ffmpeg ? (
              <span className="settings__ok">
                détecté {info.ffmpeg.version && `(${info.ffmpeg.version})`}
              </span>
            ) : (
              <span className="settings__warn">
                introuvable — durées, codecs, tags et miniatures indisponibles. Installe-le avec{' '}
                <code>pacman -S ffmpeg</code> ou <code>apt install ffmpeg</code>.
              </span>
            )}
          </dd>
          <dt>ffprobe</dt>
          <dd>
            {info.ffmpeg.ffprobe ? (
              <span className="settings__ok">détecté</span>
            ) : (
              <span className="settings__warn">introuvable</span>
            )}
          </dd>
        </dl>
      </section>

      <section className="settings__block">
        <h3>Emplacements</h3>
        <dl>
          <dt>Base de données</dt>
          <dd>
            <code>{info.databasePath}</code>
          </dd>
          <dt>Miniatures</dt>
          <dd>
            <code>{info.thumbnailDir}</code>
          </dd>
        </dl>
      </section>

      <MetadataSettings />

      <section className="settings__block">
        <h3>À venir</h3>
        <p className="settings__todo">
          Thèmes, extensions et télécommande arrivent dans les prochaines itérations.
        </p>
      </section>
    </div>
  )
}
