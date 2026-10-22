import { useCallback, useEffect, useState } from 'react'
import type { MetadataStatus, PluginList, SystemInfo } from '@shared/ipc'
import type { RemoteStatus } from '@shared/remote'
import { useGamepadIds } from '@frontend/remote/gamepad'
import { useTheme } from '@frontend/theme'
import { TV_SHORTCUT, useTvMode } from '@frontend/tvmode'
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

/** Choix du thème : le clic l'applique aussitôt, sans redémarrage. */
function ThemeSettings(): React.JSX.Element {
  const { list, select } = useTheme()
  const tv = useTvMode()

  return (
    <section className="settings__block">
      <h3>Apparence</h3>

      <div className="settings__toggle">
        <div>
          <strong>Mode TV</strong>
          <p className="settings__todo">
            Texte et vignettes agrandis, barre latérale repliée en icônes, pointeur masqué au
            repos&nbsp;: l’interface devient lisible à trois mètres d’un canapé. Il se combine avec
            n’importe quel thème, qui garde ses couleurs. Raccourci&nbsp;:{' '}
            <strong>{TV_SHORTCUT}</strong>, depuis n’importe quel écran.
          </p>
        </div>
        <button
          className={tv.enabled ? '' : 'btn--ghost'}
          onClick={tv.toggle}
          aria-pressed={tv.enabled}
        >
          {tv.enabled ? 'Activé' : 'Activer'}
        </button>
      </div>

      <p className="settings__todo">
        Un thème est un dossier contenant un <code>theme.json</code> qui redéfinit des couleurs et
        des tailles. Le changement s’applique aussitôt, sans redémarrage. Dépose les tiens
        dans&nbsp;:
      </p>
      {list && (
        <p className="settings__path">
          <code>{list.directory}</code>
        </p>
      )}

      <ul className="themes">
        {list?.themes.map((t) => (
          <li key={t.id}>
            <button
              className={`theme ${t.id === list.selected ? 'theme--active' : ''}`}
              onClick={() => void select(t.id)}
            >
              <span className="theme__swatches" aria-hidden="true">
                {['--bg', '--surface-2', '--accent', '--text'].map((token) => (
                  <span
                    key={token}
                    style={{
                      background:
                        t.tokens[token] ??
                        (t.base === 'light'
                          ? {
                              '--bg': '#f4f5f8',
                              '--surface-2': '#e6e9ef',
                              '--accent': '#2f5fe0',
                              '--text': '#16181d'
                            }[token]
                          : {
                              '--bg': '#0f1115',
                              '--surface-2': '#222630',
                              '--accent': '#4f7cff',
                              '--text': '#e8eaf0'
                            }[token])
                    }}
                  />
                ))}
              </span>
              <span className="theme__name">{t.name}</span>
              {t.description && <span className="theme__description">{t.description}</span>}
              {t.id === list.selected && <span className="theme__current">utilisé</span>}
            </button>
          </li>
        ))}
      </ul>

      {list && list.broken.length > 0 && (
        <ul className="theme__errors">
          {list.broken.map((b) => (
            <li key={b.dir}>
              <code>{b.dir.split('/').pop()}</code> : {b.errors.map((e) => e.message).join(', ')}
            </li>
          ))}
        </ul>
      )}
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

/** Télécommande : serveur local pour le téléphone, et manettes détectées. */
function RemoteSettings(): React.JSX.Element {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [port, setPort] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const pads = useGamepadIds()

  useEffect(() => {
    let cancelled = false
    void window.epikodi.remoteStatus().then((s) => {
      if (cancelled) return
      setStatus(s)
      setPort(String(s.port))
    })
    const off = window.epikodi.onRemoteChanged(setStatus)
    return () => {
      cancelled = true
      off()
    }
  }, [])

  /** Les réglages renvoient le nouvel état : un port déjà pris revient en erreur, pas en silence. */
  const run = useCallback(async (action: () => Promise<RemoteStatus>, ok?: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const next = await action()
      setStatus(next)
      setPort(String(next.port))
      if (ok) setMessage(ok)
    } catch (err) {
      setMessage((err as Error).message)
    }
    setBusy(false)
  }, [])

  const copy = (url: string): void => {
    void navigator.clipboard.writeText(url).then(() => setMessage('Adresse copiée.'))
  }

  return (
    <section className="settings__block">
      <h3>Télécommande</h3>
      <p className="settings__todo">
        EpiKodi se pilote depuis un téléphone sur le même réseau : active le serveur, puis ouvre
        l’adresse ci-dessous dans le navigateur du téléphone. Elle contient un jeton d’appairage,
        sans lequel toute requête est refusée. Le serveur est <strong>désactivé par défaut</strong>{' '}
        et n’écoute que le réseau local.
      </p>

      <dl>
        <dt>État</dt>
        <dd>
          {status?.running ? (
            <span className="settings__ok">en écoute sur le port {status.port}</span>
          ) : status?.enabled ? (
            <span className="settings__warn">activée, mais le serveur n’écoute pas</span>
          ) : (
            <span className="settings__hint">désactivée</span>
          )}
          {status?.running && (
            <span className="settings__hint"> · {status.clients} connectée(s)</span>
          )}
        </dd>
        <dt>Manette</dt>
        <dd>
          {pads.length > 0 ? (
            <span className="settings__ok">{pads.join(', ')}</span>
          ) : (
            <span className="settings__hint">
              aucune détectée — branche-la puis appuie sur un bouton
            </span>
          )}
        </dd>
      </dl>

      {status?.error && <p className="settings__message settings__warn">{status.error}</p>}

      {status?.running &&
        (status.urls.length > 0 ? (
          <ul className="remote__urls">
            {status.urls.map((url) => (
              <li key={url}>
                <button className="remote__url" title="Copier l’adresse" onClick={() => copy(url)}>
                  <code>{url}</code>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings__message settings__warn">
            Aucune interface réseau : la machine n’est joignable par aucun autre appareil.
          </p>
        ))}

      <div className="settings__key">
        <button
          disabled={busy || !status}
          onClick={() => status && void run(() => window.epikodi.remoteSetEnabled(!status.enabled))}
        >
          {status?.enabled ? 'Désactiver' : 'Activer'}
        </button>
        <input
          className="remote__port"
          type="number"
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          aria-label="Port du serveur"
        />
        <button
          className="btn--ghost"
          disabled={busy || Number(port) === status?.port}
          onClick={() =>
            void run(() => window.epikodi.remoteSetPort(Number(port)), 'Port enregistré.')
          }
        >
          Changer le port
        </button>
        <button
          className="btn--ghost btn--danger"
          disabled={busy}
          onClick={() =>
            void run(
              () => window.epikodi.remoteRotateToken(),
              'Nouveau jeton : rouvre l’adresse sur le téléphone.'
            )
          }
        >
          Nouveau jeton
        </button>
      </div>
      {message && <p className="settings__message">{message}</p>}

      <p className="settings__todo">
        Manette : croix directionnelle ou stick pour naviguer, <strong>A</strong> valide,{' '}
        <strong>B</strong> revient, <strong>X</strong> lecture / pause, <strong>Y</strong> muet,
        <strong> L1 / R1</strong> piste précédente / suivante, gâchettes <strong>±30 s</strong>,{' '}
        <strong>Start</strong> accueil. Une manette que le navigateur ne normalise pas (affichée «
        disposition inconnue ») garde les sticks, la croix et ses deux premiers boutons. L’API HTTP
        et WebSocket est documentée dans <code>docs/remote-api.md</code>.
      </p>
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

      <ThemeSettings />

      <MetadataSettings />

      <PluginSettings />

      <RemoteSettings />
    </div>
  )
}
