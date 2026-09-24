import { useEffect, useState } from 'react'
import type { SystemInfo } from '@shared/ipc'
import './SettingsView.css'

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

      <section className="settings__block">
        <h3>À venir</h3>
        <p className="settings__todo">
          Thèmes, extensions, télécommande et intégration TheMovieDB arrivent dans les prochaines
          itérations.
        </p>
      </section>
    </div>
  )
}
