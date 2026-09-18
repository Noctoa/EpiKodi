import { useCallback, useEffect, useState } from 'react'
import { toMediaUrl, type FfmpegStatus, type OpenedMedia, type ScanProgress } from '@shared/ipc'
import type { MediaWithMetadata, Source } from '@shared/models'
import { MediaList } from './components/MediaList'
import { Player } from './components/Player'
import { SourcesPanel } from './components/SourcesPanel'
import './App.css'

export default function App(): React.JSX.Element {
  const [playing, setPlaying] = useState<OpenedMedia | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [items, setItems] = useState<MediaWithMetadata[]>([])
  const [enrichPending, setEnrichPending] = useState(0)
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null)
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

  useEffect(() => {
    window.epikodi.systemFfmpeg().then(setFfmpeg)
  }, [])

  // Enrichissement ffprobe en arrière-plan : la liste se met à jour au fil de l'eau
  useEffect(
    () =>
      window.epikodi.onLibraryChanged((e) => {
        setEnrichPending(e.enrichPending)
        void refresh()
      }),
    [refresh]
  )

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

  const play = useCallback((m: MediaWithMetadata) => {
    setPlaying({ path: m.path, name: m.title, url: toMediaUrl(m.path) })
  }, [])

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">EpiKodi</h1>
        <div className="app__status">
          {ffmpeg && !ffmpeg.ffprobe && (
            <span
              className="app__warn"
              title="Installe ffmpeg pour les durées, codecs, tags et miniatures"
            >
              ⚠ ffmpeg introuvable
            </span>
          )}
          {enrichPending > 0 && (
            <span className="app__hint">Analyse : {enrichPending} restant(s)</span>
          )}
        </div>
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
