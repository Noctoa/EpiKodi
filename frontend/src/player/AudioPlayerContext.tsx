import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react'
import * as Q from './queue'
import type { QueueItem, QueueState, RepeatMode } from './queue'

interface Status {
  playing: boolean
  time: number
  duration: number
  volume: number
  muted: boolean
  error: string | null
}

interface AudioPlayerApi {
  queue: QueueState
  current: QueueItem | null
  status: Status
  /** Remplace la file et lit à partir de `start` */
  play(items: QueueItem[], start?: number): void
  enqueue(items: QueueItem[]): void
  playNext(item: QueueItem): void
  remove(key: string): void
  move(from: number, to: number): void
  jumpTo(index: number): void
  clear(): void
  toggle(): void
  pause(): void
  next(): void
  prev(): void
  seek(t: number): void
  setVolume(v: number): void
  toggleMute(): void
  cycleRepeat(): void
  toggleShuffle(): void
}

type Action =
  | { type: 'set'; items: QueueItem[]; start: number }
  | { type: 'enqueue'; items: QueueItem[] }
  | { type: 'playNext'; item: QueueItem }
  | { type: 'remove'; key: string }
  | { type: 'move'; from: number; to: number }
  | { type: 'jump'; index: number }
  | { type: 'clear' }
  | { type: 'repeat' }
  | { type: 'shuffle' }

function reducer(q: QueueState, a: Action): QueueState {
  switch (a.type) {
    case 'set':
      return Q.setQueue(q, a.items, a.start)
    case 'enqueue':
      return Q.enqueue(q, a.items)
    case 'playNext':
      return Q.playNext(q, a.item)
    case 'remove':
      return Q.remove(q, a.key)
    case 'move':
      return Q.move(q, a.from, a.to)
    case 'jump':
      return Q.jumpTo(q, a.index)
    case 'clear':
      return Q.clear(q)
    case 'repeat':
      return Q.cycleRepeat(q)
    case 'shuffle':
      return Q.toggleShuffle(q)
  }
}

const Ctx = createContext<AudioPlayerApi | null>(null)

const STORAGE_KEY = 'epikodi.audio.prefs'
function loadPrefs(): { volume: number; repeat: RepeatMode; shuffle: boolean } {
  try {
    return {
      volume: 1,
      repeat: 'off',
      shuffle: false,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    }
  } catch {
    return { volume: 1, repeat: 'off', shuffle: false }
  }
}

/**
 * Un seul <audio> pour toute l'application, monté à la racine : la musique continue quelle que
 * soit la vue affichée. La file est un état pur (queue.ts) ; ce contexte fait le lien avec le DOM.
 */
export function AudioPlayerProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLAudioElement>(null)
  const prefs = useMemo(() => loadPrefs(), [])
  const [queue, dispatch] = useReducer(reducer, {
    ...Q.emptyQueue,
    repeat: prefs.repeat,
    shuffle: prefs.shuffle
  })
  const [status, setStatus] = useState<Status>({
    playing: false,
    time: 0,
    duration: 0,
    volume: prefs.volume,
    muted: false,
    error: null
  })
  const current = Q.current(queue)
  // La file peut changer entre deux événements DOM : on garde toujours la dernière version
  const queueRef = useRef(queue)
  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  const currentUrl = current?.url ?? null
  const startAt = current?.startAt ?? 0
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!currentUrl) {
      el.removeAttribute('src')
      el.load()
      return
    }
    el.src = currentUrl
    el.volume = prefs.volume
    // Reprise d'un épisode entamé : on se positionne dès que la durée est connue
    const resume = startAt
    if (resume && resume > 0) {
      const seek = (): void => {
        el.currentTime = resume
        el.removeEventListener('loadedmetadata', seek)
      }
      el.addEventListener('loadedmetadata', seek)
    }
    void el.play().catch(() => {
      /* autoplay refusé : Play manuel */
    })
  }, [currentUrl, prefs.volume, startAt])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (patch: Partial<Status>): void => setStatus((s) => ({ ...s, ...patch }))
    const handlers: [string, () => void][] = [
      ['play', () => update({ playing: true, error: null })],
      ['pause', () => update({ playing: false })],
      ['timeupdate', () => update({ time: el.currentTime })],
      [
        'durationchange',
        () => update({ duration: Number.isFinite(el.duration) ? el.duration : 0 })
      ],
      ['volumechange', () => update({ volume: el.volume, muted: el.muted })],
      ['error', () => update({ playing: false, error: el.error?.message ?? 'Lecture impossible' })],
      [
        'ended',
        () => {
          const q = queueRef.current
          const n = Q.nextIndex(q)
          if (n === null) return update({ playing: false })
          if (n === q.index) {
            el.currentTime = 0 // repeat one
            void el.play()
          } else dispatch({ type: 'jump', index: n })
        }
      ]
    ]
    handlers.forEach(([e, h]) => el.addEventListener(e, h))
    return () => handlers.forEach(([e, h]) => el.removeEventListener(e, h))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ volume: status.volume, repeat: queue.repeat, shuffle: queue.shuffle })
      )
    } catch {
      /* stockage indisponible */
    }
  }, [status.volume, queue.repeat, queue.shuffle])

  const el = (): HTMLAudioElement | null => ref.current

  const api = useMemo<Omit<AudioPlayerApi, 'queue' | 'current' | 'status'>>(
    () => ({
      play: (items, start = 0) => dispatch({ type: 'set', items, start }),
      enqueue: (items) => dispatch({ type: 'enqueue', items }),
      playNext: (item) => dispatch({ type: 'playNext', item }),
      remove: (key) => dispatch({ type: 'remove', key }),
      move: (from, to) => dispatch({ type: 'move', from, to }),
      jumpTo: (index) => dispatch({ type: 'jump', index }),
      clear: () => dispatch({ type: 'clear' }),
      toggle: () => {
        const a = el()
        if (!a || !a.src) return
        if (a.paused) void a.play()
        else a.pause()
      },
      pause: () => el()?.pause(),
      next: () => {
        const n = Q.nextIndex(queueRef.current, true)
        if (n !== null) dispatch({ type: 'jump', index: n })
      },
      prev: () => {
        const a = el()
        // Convention des lecteurs : après 3 s, "précédent" revient au début de la piste
        if (a && a.currentTime > 3) {
          a.currentTime = 0
          return
        }
        const p = Q.prevIndex(queueRef.current)
        if (p !== null) dispatch({ type: 'jump', index: p })
      },
      seek: (t) => {
        const a = el()
        if (a) a.currentTime = t
      },
      setVolume: (v) => {
        const a = el()
        if (!a) return
        a.volume = Math.min(1, Math.max(0, v))
        if (a.volume > 0) a.muted = false
      },
      toggleMute: () => {
        const a = el()
        if (a) a.muted = !a.muted
      },
      cycleRepeat: () => dispatch({ type: 'repeat' }),
      toggleShuffle: () => dispatch({ type: 'shuffle' })
    }),
    []
  )

  // Même index re-dispatché (repeat all sur une file d'une piste, ou jump sur la courante) : relance
  const jumpTo = useCallback(
    (index: number) => {
      if (index === queueRef.current.index) {
        const a = el()
        if (a) {
          a.currentTime = 0
          void a.play()
        }
      } else api.jumpTo(index)
    },
    [api]
  )

  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    ms.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artist ?? '',
          album: current.album ?? '',
          artwork: current.thumbnailUrl ? [{ src: current.thumbnailUrl }] : []
        })
      : null
    ms.setActionHandler('play', api.toggle)
    ms.setActionHandler('pause', api.toggle)
    ms.setActionHandler('nexttrack', api.next)
    ms.setActionHandler('previoustrack', api.prev)
  }, [current, api])

  const value = useMemo<AudioPlayerApi>(
    () => ({ ...api, jumpTo, queue, current, status }),
    [api, jumpTo, queue, current, status]
  )

  return (
    <Ctx.Provider value={value}>
      <audio ref={ref} preload="auto" />
      {children}
    </Ctx.Provider>
  )
}

export function useAudioPlayer(): AudioPlayerApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAudioPlayer() hors de <AudioPlayerProvider>')
  return ctx
}
