import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AUDIO_EXTENSIONS,
  toMediaUrl,
  type FfmpegStatus,
  type LibraryStats,
  type OpenedMedia,
  type ScanProgress
} from '@shared/ipc'
import type { Facets, MediaQuery, MediaWithMetadata, Source } from '@shared/models'
import { FilterBar } from './components/FilterBar'
import { Grid } from './components/Grid'
import { MediaDetail } from './components/MediaDetail'
import { MiniPlayer } from './components/MiniPlayer'
import { Player } from './components/Player'
import { Sidebar } from './components/Sidebar'
import { useDebounced } from './hooks'
import { groupByArtist, tracksOf } from './library/grouping'
import {
  back,
  canGoBack,
  currentView,
  initialNav,
  navigate,
  push,
  viewTitle,
  type SectionName,
  type View
} from './navigation'
import { useAudioPlayer } from './player/AudioPlayerContext'
import { fromMedia, fromOpened } from './player/items'
import { HomeView, tileOf } from './views/HomeView'
import { AlbumsView, AlbumTracksView, ArtistsView } from './views/MusicView'
import { PodcastsView } from './views/PodcastsView'
import { SearchView } from './views/SearchView'
import { SettingsView } from './views/SettingsView'
import { SourcesView } from './views/SourcesView'
import './App.css'

const isAudioFile = (name: string): boolean =>
  AUDIO_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')

/** Assez haut pour une bibliothèque personnelle ; la pagination viendra si besoin. */
const PAGE_SIZE = 10_000
const EMPTY_FACETS: Facets = { genres: [], years: [] }
/** Vues sur lesquelles la barre de filtres a du sens */
const FILTERABLE = new Set(['videos', 'music', 'search'])

export default function App(): React.JSX.Element {
  const audio = useAudioPlayer()
  const [nav, setNav] = useState(initialNav)
  const [playing, setPlayingState] = useState<OpenedMedia | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [items, setItems] = useState<MediaWithMetadata[]>([])
  const [results, setResults] = useState<MediaWithMetadata[]>([])
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [scans, setScans] = useState<Record<number, ScanProgress>>({})
  const [enrichPending, setEnrichPending] = useState(0)
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null)

  // Recherche et filtres
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<MediaQuery>({})
  const debouncedSearch = useDebounced(search)
  /** Incrémenté quand la bibliothèque change : force le rechargement des résultats */
  const [revision, setRevision] = useState(0)

  const view = currentView(nav)
  const videos = useMemo(() => results.filter((m) => m.type === 'video'), [results])
  const artists = useMemo(() => groupByArtist(results), [results])
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items])
  const currentKey = audio.current?.key ?? null

  // ---------- données ----------

  const reloadLibrary = useCallback(
    () =>
      Promise.all([
        window.epikodi.sourcesList(),
        window.epikodi.mediaList({ limit: PAGE_SIZE }),
        window.epikodi.libraryStats(),
        window.epikodi.mediaFacets()
      ]).then(([s, m, st, f]) => {
        setSources(s)
        setItems(m)
        setStats(st)
        setFacets(f)
        setRevision((r) => r + 1)
      }),
    []
  )

  useEffect(() => {
    let cancelled = false
    void reloadLibrary()
    window.epikodi.systemFfmpeg().then((f) => {
      if (!cancelled) setFfmpeg(f)
    })
    return () => {
      cancelled = true
    }
  }, [reloadLibrary])

  // Résultats filtrés : rechargés à chaque changement de requête ou de bibliothèque
  useEffect(() => {
    let cancelled = false
    window.epikodi
      .mediaList({ ...filters, search: debouncedSearch || undefined, limit: PAGE_SIZE })
      .then((r) => {
        if (!cancelled) setResults(r)
      })
    return () => {
      cancelled = true
    }
  }, [filters, debouncedSearch, revision])

  useEffect(
    () =>
      window.epikodi.onLibraryChanged((e) => {
        setEnrichPending(e.enrichPending)
        void reloadLibrary()
      }),
    [reloadLibrary]
  )

  useEffect(
    () =>
      window.epikodi.onScanProgress((p) => {
        setScans((prev) => ({ ...prev, [p.sourceId]: p }))
        void reloadLibrary()
      }),
    [reloadLibrary]
  )

  // ---------- navigation ----------

  const go = useCallback((v: View) => setNav((n) => navigate(n, v)), [])
  const open = useCallback((v: View) => setNav((n) => push(n, v)), [])
  const goBack = useCallback(() => setNav((n) => back(n)), [])

  /** Saisir une recherche ouvre la vue Résultats ; la vider revient d'où l'on venait. */
  const onSearchChange = useCallback((value: string) => {
    setSearch(value)
    setNav((n) => {
      const v = currentView(n)
      if (value && v.name !== 'search') return push(n, { name: 'search' })
      if (!value && v.name === 'search') return back(n)
      return n
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (playing) return
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === 'Escape' && inInput) {
        ;(e.target as HTMLInputElement).blur()
        return
      }
      if (inInput) return
      // Retour clavier « salon »
      if (e.key === 'Backspace' || e.key === 'Escape') {
        e.preventDefault()
        goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, playing])

  // ---------- lecture ----------

  const showVideo = useCallback(
    (m: OpenedMedia | null) => {
      if (m) audio.pause()
      setPlayingState(m)
    },
    [audio]
  )

  /** Audio → file de lecture ; vidéo → lecteur plein cadre. */
  const playMedia = useCallback(
    (m: MediaWithMetadata, queue: MediaWithMetadata[] = []) => {
      if (m.type === 'audio') {
        setPlayingState(null)
        const list = (queue.length ? queue : results).filter((i) => i.type === 'audio')
        const start = Math.max(
          0,
          list.findIndex((t) => t.id === m.id)
        )
        audio.play(list.map(fromMedia), start)
      } else showVideo({ path: m.path, name: m.title, url: toMediaUrl(m.path) })
    },
    [results, audio, showVideo]
  )

  const playById = useCallback(
    (id: number, queue?: MediaWithMetadata[]) => {
      const m = byId.get(id)
      if (m) playMedia(m, queue)
    },
    [byId, playMedia]
  )

  const openExternal = useCallback(
    (o: OpenedMedia) => {
      if (isAudioFile(o.name)) {
        setPlayingState(null)
        audio.play([fromOpened(o)])
      } else showVideo(o)
    },
    [audio, showVideo]
  )

  useEffect(() => window.epikodi.onMediaOpened(openExternal), [openExternal])

  const openFile = useCallback(async () => {
    const opened = await window.epikodi.openMediaDialog()
    if (opened) openExternal(opened)
  }, [openExternal])

  // ---------- sources ----------

  const addSource = useCallback(async () => {
    const s = await window.epikodi.sourcesAdd()
    if (s) await reloadLibrary()
  }, [reloadLibrary])

  const removeSource = useCallback(
    async (id: number) => {
      await window.epikodi.sourcesRemove(id)
      setScans((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await reloadLibrary()
    },
    [reloadLibrary]
  )

  // ---------- contenu de la vue ----------

  const detailMedia = view.name === 'detail' ? byId.get(view.mediaId) : undefined
  const openDetail = useCallback(
    (m: MediaWithMetadata) => open({ name: 'detail', mediaId: m.id }),
    [open]
  )
  const enqueue = useCallback((m: MediaWithMetadata) => audio.enqueue([fromMedia(m)]), [audio])
  const playNext = useCallback((m: MediaWithMetadata) => audio.playNext(fromMedia(m)), [audio])

  function content(): React.JSX.Element {
    switch (view.name) {
      case 'home':
        return (
          <HomeView
            items={items}
            stats={stats}
            onOpen={(id) => open({ name: 'detail', mediaId: id })}
            onPlay={(id) => playById(id)}
            onAddSource={addSource}
          />
        )

      case 'search':
        return (
          <SearchView
            results={results}
            search={search}
            currentKey={currentKey}
            onOpenDetail={openDetail}
            onPlay={playMedia}
            onEnqueue={enqueue}
            onPlayNext={playNext}
          />
        )

      case 'videos':
        return (
          <Grid
            tiles={videos.map((m) => tileOf(m, currentKey))}
            onOpen={(k) => open({ name: 'detail', mediaId: Number(k) })}
            onPlay={(k) => playById(Number(k), videos)}
            empty="Aucune vidéo ne correspond. Ajuste les filtres ou ajoute un dossier dans Sources."
          />
        )

      case 'music':
        return (
          <ArtistsView artists={artists} onOpen={(artist) => open({ name: 'artist', artist })} />
        )

      case 'artist': {
        const albums = artists.find((a) => a.artist === view.artist)?.albums ?? []
        return (
          <AlbumsView
            albums={albums}
            onOpen={(album) => open({ name: 'album', artist: view.artist, album })}
            onPlay={(album) => {
              const tracks = albums.find((a) => a.album === album)?.tracks ?? []
              if (tracks[0]) playMedia(tracks[0], tracks)
            }}
          />
        )
      }

      case 'album': {
        const album = artists
          .find((a) => a.artist === view.artist)
          ?.albums.find((a) => a.album === view.album)
        if (!album) return <div className="grid__empty">Album introuvable.</div>
        const tracks = tracksOf(artists, view.artist, view.album)
        return (
          <AlbumTracksView
            album={album}
            currentKey={currentKey}
            onPlay={(m) => playMedia(m, tracks)}
            onEnqueue={enqueue}
            onPlayNext={playNext}
            onPlayAll={() => tracks[0] && playMedia(tracks[0], tracks)}
            onOpenDetail={openDetail}
          />
        )
      }

      case 'podcasts':
        return <PodcastsView />

      case 'sources':
        return (
          <SourcesView
            sources={sources}
            scans={scans}
            onAdd={addSource}
            onScan={(id) => void window.epikodi.sourcesScan(id)}
            onCancel={(id) => void window.epikodi.sourcesCancelScan(id)}
            onRemove={removeSource}
          />
        )

      case 'settings':
        return <SettingsView />

      case 'detail':
        return detailMedia ? (
          <MediaDetail
            media={detailMedia}
            source={sources.find((s) => s.id === detailMedia.sourceId)}
            onPlay={() => playMedia(detailMedia)}
            onEnqueue={() => enqueue(detailMedia)}
            onPlayNext={() => playNext(detailMedia)}
          />
        ) : (
          <div className="grid__empty">Ce média n'est plus dans la bibliothèque.</div>
        )
    }
  }

  const audioCount = results.filter((m) => m.type === 'audio').length
  const counts: Partial<Record<SectionName, number>> = {
    videos: videos.length,
    music: audioCount,
    sources: sources.length
  }
  // Le compteur de la barre de filtres décrit ce que la vue affiche, pas le total tous types
  const filterCount =
    view.name === 'videos' ? videos.length : view.name === 'music' ? audioCount : results.length

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">EpiKodi</h1>

        <div className="app__search">
          <span className="app__search-icon">⌕</span>
          <input
            type="search"
            value={search}
            placeholder="Rechercher un titre, un artiste, un album…"
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Rechercher dans la bibliothèque"
          />
          {search && (
            <button
              className="app__search-clear"
              onClick={() => onSearchChange('')}
              title="Effacer"
            >
              ✕
            </button>
          )}
        </div>

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
            <button className="btn--ghost" onClick={() => setPlayingState(null)}>
              ← Bibliothèque
            </button>
          )}
          <button onClick={openFile}>Ouvrir un média…</button>
        </div>
      </header>

      <div className="app__body">
        <Sidebar view={view} counts={counts} onNavigate={(s) => go({ name: s } as View)} />
        <main className={`app__main ${playing ? 'app__main--player' : ''}`}>
          {playing ? (
            <Player media={playing} onClose={() => setPlayingState(null)} />
          ) : (
            <>
              <div className="app__view-head">
                {canGoBack(nav) && (
                  <button className="app__back" onClick={goBack} title="Retour (Échap)">
                    ←
                  </button>
                )}
                <h2 className="app__view-title">{viewTitle(view, detailMedia?.title)}</h2>
              </div>
              {FILTERABLE.has(view.name) && (
                <FilterBar
                  query={filters}
                  facets={facets}
                  sources={sources}
                  count={filterCount}
                  onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
                  onReset={() => setFilters((f) => ({ sort: f.sort, order: f.order }))}
                />
              )}
              <div className="app__view">{content()}</div>
            </>
          )}
        </main>
      </div>

      <MiniPlayer />
    </div>
  )
}
