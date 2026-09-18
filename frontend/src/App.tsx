import { useCallback, useEffect, useState } from 'react'
import { toMediaUrl, type OpenedMedia, type ScanProgress } from '@shared/ipc'
import type { Media, Source } from '@shared/models'
import { MediaList } from './components/MediaList'
import { Player } from './components/Player'
import { SourcesPanel } from './components/SourcesPanel'
import './App.css'

export default function App(): React.JSX.Element {
  const [playing, setPlaying] = useState<OpenedMedia | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [items, setItems] = useState<Media[]>([])
  const [scans, setScans] = useState<Record<number, ScanProgress>>({})

  const refresh = useCallback(
    () =>
      Promise.all([window.epikodi.sourcesList(), window.epikodi.mediaList()]).then(([s, m]) => {
        setSources(s)
        setItems(m)
      }),
    []
  )

  // Chargement initial
  useEffect(() => {
    let cancelled = false
    Promise.all([window.epikodi.sourcesList(), window.epikodi.mediaList()]).then(([s, m]) => {
      if (cancelled) return
      setSources(s)
      setItems(m)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => window.epikodi.onMediaOpened(setPlaying), [])

  // Progression des scans : mise à jour de l'état + rafraîchissement de la liste à chaque lot
  useEffect(
    () =>
      window.epikodi.onScanProgress((p) => {
        setScans((prev) => ({ ...prev, [p.sourceId]: p }))
        void refresh()
      }),
    [refresh]
  )

  const openFile = useCallback(async () => {
    const opened = await window.epikodi.openMediaDialog()
    if (opened) setPlaying(opened)
  }, [])

  const addSource = useCallback(async () => {
    const s = await window.epikodi.sourcesAdd()
    if (s) await refresh()
  }, [refresh])

  const removeSource = useCallback(
    async (id: number) => {
      await window.epikodi.sourcesRemove(id)
      setScans((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await refresh()
    },
    [refresh]
  )

  const play = useCallback((m: Media) => {
    setPlaying({ path: m.path, name: m.title, url: toMediaUrl(m.path) })
  }, [])

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">EpiKodi</h1>
        <div className="app__header-actions">
          {playing && (
            <button className="btn--ghost" onClick={() => setPlaying(null)}>
              ← Bibliothèque
            </button>
          )}
          <button onClick={openFile}>Ouvrir un média…</button>
        </div>
      </header>
      <div className="app__body">
        <SourcesPanel
          sources={sources}
          scans={scans}
          onAdd={addSource}
          onScan={(id) => void window.epikodi.sourcesScan(id)}
          onCancel={(id) => void window.epikodi.sourcesCancelScan(id)}
          onRemove={removeSource}
        />
        <main className="app__main">
          {playing ? <Player media={playing} /> : <MediaList items={items} onPlay={play} />}
        </main>
      </div>
    </div>
  )
}
