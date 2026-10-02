import { useCallback, useEffect, useState } from 'react'
import type { MetadataStatus, PluginList, SystemInfo } from '@shared/ipc'
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

/** Extensions installées : état, permissions, erreurs de chargement, activation. */
function PluginSettings(): React.JSX.Element {
  const [list, setList] = useState<PluginList | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.epikodi.pluginsList().then((l) => {
      if (!cancelled) setList(l)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    setBusy(id)
    setList(await window.epikodi.pluginsSetEnabled(id, enabled))
    setBusy(null)
  }, [])

  const etat = {
    active: { texte: 'active', classe: 'settings__ok' },
    inactive: { texte: 'inactive', classe: 'settings__hint' },
    error: { texte: 'en erreur', classe: 'settings__warn' }
  } as const

  return (
    <section className="settings__block">
      <h3>Extensions</h3>
      <p className="settings__todo">
        Une extension est un dossier contenant un <code>manifest.json</code> et du JavaScript.
        Chacune tourne dans son propre process : une extension qui plante n’emporte pas
        l’application. Dépose-les dans&nbsp;:
      </p>
      {list && (
        <p className="settings__path">
          <code>{list.directory}</code>
        </p>
      )}

      {list?.plugins.length === 0 && list.broken.length === 0 && (
        <p className="settings__todo">
          Aucune extension installée. Un exemple complet et documenté est fourni dans
          <code> examples/plugins/tvmaze-provider</code>.
        </p>
      )}

      <ul className="plugins">
        {list?.plugins.map((p) => (
          <li key={p.id} className="plugin">
            <div className="plugin__main">
              <div className="plugin__name">
                {p.name}
                <span className="plugin__version">v{p.version}</span>
                <span className={etat[p.status].classe}> · {etat[p.status].texte}</span>
              </div>
              {p.description && <div className="plugin__description">{p.description}</div>}
              <div className="plugin__meta">
                {[
                  p.author,
                  p.permissions.length ? `permissions : ${p.permissions.join(', ')}` : null,
                  p.contributes.length ? `fournit : ${p.contributes.join(', ')}` : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {p.error && <div className="plugin__error">{p.error}</div>}
            </div>
            <button
              className="btn--ghost"
              disabled={busy === p.id}
              onClick={() => void toggle(p.id, !p.enabled)}
            >
              {busy === p.id ? '…' : p.enabled ? 'Désactiver' : 'Activer'}
            </button>
          </li>
        ))}

        {list?.broken.map((b) => (
          <li key={b.dir} className="plugin plugin--broken">
            <div className="plugin__main">
              <div className="plugin__name">
                {b.dir.split('/').pop()}
                <span className="settings__warn"> · manifeste invalide</span>
              </div>
              <ul className="plugin__errors">
                {b.errors.map((e) => (
                  <li key={e.field}>
                    <code>{e.field}</code> : {e.message}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
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

      <PluginSettings />

      <section className="settings__block">
        <h3>À venir</h3>
        <p className="settings__todo">
          Thèmes et télécommande arrivent dans les prochaines itérations.
        </p>
      </section>
    </div>
  )
}
