import { useCallback, useEffect, useState } from 'react'
import type { LibraryStats, OpenedMedia } from '@shared/ipc'
import { Player } from './components/Player'
import './App.css'

export default function App(): React.JSX.Element {
  const [media, setMedia] = useState<OpenedMedia | null>(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)

  useEffect(() => window.epikodi.onMediaOpened(setMedia), [])
  useEffect(() => {
    void window.epikodi.libraryStats().then(setStats)
  }, [])

  const openFile = useCallback(async () => {
    const opened = await window.epikodi.openMediaDialog()
    if (opened) setMedia(opened)
  }, [])

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">EpiKodi</h1>
        <button onClick={openFile}>Ouvrir un média…</button>
      </header>
      <main className="app__main">
        {media ? (
          <Player media={media} />
        ) : (
          <div className="app__empty">
            <p>Aucun média ouvert.</p>
            <p className="app__hint">Ouvre un fichier vidéo ou audio pour tester la lecture.</p>
            {stats && (
              <p className="app__hint">
                Bibliothèque : {stats.sources} source(s), {stats.media} média(s)
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
