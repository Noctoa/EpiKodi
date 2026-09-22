import { useCallback, useEffect, useState } from 'react'
import {
  AUDIO_EXTENSIONS,
  toMediaUrl,
  type FfmpegStatus,
  type OpenedMedia,
  type ScanProgress
} from '@shared/ipc'
import type { MediaWithMetadata, Source } from '@shared/models'
import { MediaList } from './components/MediaList'
import { MiniPlayer } from './components/MiniPlayer'
import { Player } from './components/Player'
import { SourcesPanel } from './components/SourcesPanel'
import { useAudioPlayer } from './player/AudioPlayerContext'
import { albumOrder, fromMedia, fromOpened } from './player/items'
import './App.css'

const isAudioFile = (name: string): boolean =>
  AUDIO_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')

export default function App(): React.JSX.Element {
  const audio = useAudioPlayer()
  const [playing, setPlayingState] = useState<OpenedMedia | null>(null)

  // Ouvrir une vidéo met la musique en pause : un seul son à la fois
  const setPlaying = useCallback(
    (m: OpenedMedia | null) => {
      if (m) audio.pause()
      setPlayingState(m)
    },
    [audio]
  )

  /** Fichier hors bibliothèque (dialogue, --open) : audio → mini-lecteur, vidéo → lecteur plein. */
  const openExternal = useCallback(
    (o: OpenedMedia) => {
      if (isAudioFile(o.name)) {
        setPlayingState(null)
        audio.play([fromOpened(o)])
      } else setPlaying(o)
    },
    [audio, setPlaying]
  )
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

  useEffect(() => window.epikodi.onMediaOpened(openExternal), [openExternal])

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
    if (opened) openExternal(opened)
  }, [openExternal])

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

  // Audio : la file devient toutes les pistes affichées, en ordre album, à partir de celle cliquée.
  // Vidéo : lecteur plein écran.
  const play = useCallback(
    (m: MediaWithMetadata) => {
      if (m.type === 'audio') {
        setPlayingState(null)
        const tracks = albumOrder(items.filter((i) => i.type === 'audio'))
        audio.play(
          tracks.map(fromMedia),
          tracks.findIndex((t) => t.id === m.id)
        )
      } else setPlaying({ path: m.path, name: m.title, url: toMediaUrl(m.path) })
    },
    [items, audio, setPlaying]
  )

  const enqueue = useCallback((m: MediaWithMetadata) => audio.enqueue([fromMedia(m)]), [audio])
  const playNext = useCallback((m: MediaWithMetadata) => audio.playNext(fromMedia(m)), [audio])

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
        <main className={`app__main ${playing ? 'app__main--player' : ''}`}>
          {playing ? (
            <Player media={playing} onClose={() => setPlaying(null)} />
          ) : (
            <MediaList
              items={items}
              onPlay={play}
              onEnqueue={enqueue}
              onPlayNext={playNext}
              currentKey={audio.current?.key ?? null}
            />
          )}
        </main>
      </div>
      <MiniPlayer />
    </div>
  )
}
