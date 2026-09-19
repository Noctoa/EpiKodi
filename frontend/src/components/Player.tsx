import { useCallback, useEffect, useRef, useState } from 'react'
import { AUDIO_EXTENSIONS, type OpenedMedia, type SubtitleTrack } from '@shared/ipc'
import { fmtDuration } from './MediaList'
import './Player.css'

interface PlayerProps {
  media: OpenedMedia
  onClose?: () => void
}

/** API Chromium (flag AudioVideoTracks) absente des types DOM standard. */
interface AudioTrackLike {
  id: string
  label: string
  language: string
  enabled: boolean
}
type VideoWithAudioTracks = HTMLVideoElement & {
  audioTracks?: ArrayLike<AudioTrackLike> & { onchange: (() => void) | null }
}

const SEEK_STEP = 10
const VOLUME_STEP = 0.05
const HIDE_DELAY = 2500

function isAudio(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return AUDIO_EXTENSIONS.includes(ext)
}

export function Player({ media, onClose }: PlayerProps): React.JSX.Element {
  const videoRef = useRef<VideoWithAudioTracks>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([])
  const [subtitleId, setSubtitleId] = useState<string | null>(null)
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null)
  const [audioTracks, setAudioTracks] = useState<AudioTrackLike[]>([])
  const [menu, setMenu] = useState<'subtitles' | 'audio' | null>(null)

  const audio = isAudio(media.name)

  // ---------- chargement ----------

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    setError(null)
    setSubtitleId(null)
    setSubtitleUrl(null)
    setAudioTracks([])
    el.load()
    void el.play().catch(() => {
      /* autoplay refusé : l'utilisateur cliquera sur Play */
    })
    if (audio) return
    void window.epikodi.playerSubtitles(media.path).then(setSubtitles)
  }, [media.path, media.url, audio])

  // ---------- événements vidéo ----------

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onTime = (): void => {
      setTime(el.currentTime)
      const b = el.buffered
      setBuffered(b.length ? b.end(b.length - 1) : 0)
    }
    const onMeta = (): void => {
      setDuration(el.duration)
      const at = el.audioTracks
      if (at && at.length > 1) {
        setAudioTracks(Array.from(at))
        at.onchange = () => setAudioTracks(Array.from(at))
      }
    }
    const onError = (): void => setError(el.error?.message ?? 'Lecture impossible')
    const onVolume = (): void => {
      setVolume(el.volume)
      setMuted(el.muted)
    }
    const handlers: [string, () => void][] = [
      ['play', () => setPlaying(true)],
      ['pause', () => setPlaying(false)],
      ['ended', () => setPlaying(false)],
      ['timeupdate', onTime],
      ['progress', onTime],
      ['loadedmetadata', onMeta],
      ['durationchange', onMeta],
      ['volumechange', onVolume],
      ['error', onError]
    ]
    handlers.forEach(([e, h]) => el.addEventListener(e, h))
    return () => handlers.forEach(([e, h]) => el.removeEventListener(e, h))
  }, [])

  useEffect(() => {
    const onFs = (): void => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ---------- actions ----------

  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }, [])

  const seekBy = useCallback((delta: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = Math.min(Math.max(0, el.currentTime + delta), el.duration || 0)
  }, [])

  const seekTo = useCallback((t: number) => {
    const el = videoRef.current
    if (el) el.currentTime = t
  }, [])

  const changeVolume = useCallback((v: number) => {
    const el = videoRef.current
    if (!el) return
    el.volume = Math.min(1, Math.max(0, v))
    if (el.volume > 0) el.muted = false
  }, [])

  const toggleMute = useCallback(() => {
    const el = videoRef.current
    if (el) el.muted = !el.muted
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen()
  }, [])

  const selectSubtitle = useCallback(
    async (id: string | null) => {
      setMenu(null)
      setSubtitleId(id)
      if (subtitleUrl) URL.revokeObjectURL(subtitleUrl)
      if (!id) return setSubtitleUrl(null)
      const track = subtitles.find((t) => t.id === id)
      if (!track) return
      try {
        const vtt = await window.epikodi.playerSubtitleVtt(media.path, track)
        setSubtitleUrl(URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })))
      } catch {
        setSubtitleId(null)
      }
    },
    [media.path, subtitles, subtitleUrl]
  )

  const selectAudio = useCallback((id: string) => {
    const at = videoRef.current?.audioTracks
    if (!at) return
    for (const t of Array.from(at)) t.enabled = t.id === id
    setAudioTracks(Array.from(at))
    setMenu(null)
  }, [])

  // ---------- masquage des contrôles ----------

  const armHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused && !menu) setControlsVisible(false)
    }, HIDE_DELAY)
  }, [menu])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    armHideTimer()
  }, [armHideTimer])

  // À la reprise de la lecture, les contrôles se masquent d'eux-mêmes après le délai
  useEffect(() => {
    armHideTimer()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [armHideTimer, playing])

  // ---------- clavier ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const map: Record<string, () => void> = {
        ' ': togglePlay,
        k: togglePlay,
        ArrowLeft: () => seekBy(-SEEK_STEP),
        ArrowRight: () => seekBy(SEEK_STEP),
        j: () => seekBy(-SEEK_STEP),
        l: () => seekBy(SEEK_STEP),
        ArrowUp: () => changeVolume((videoRef.current?.volume ?? 1) + VOLUME_STEP),
        ArrowDown: () => changeVolume((videoRef.current?.volume ?? 1) - VOLUME_STEP),
        f: toggleFullscreen,
        m: toggleMute,
        Escape: () => {
          if (menu) setMenu(null)
          else if (document.fullscreenElement) void document.exitFullscreen()
          else onClose?.()
        }
      }
      const action = map[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      if (action) {
        e.preventDefault()
        action()
        showControls()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekBy, changeVolume, toggleFullscreen, toggleMute, showControls, onClose, menu])

  // ---------- rendu ----------

  const pct = duration ? (time / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0
  const hidden = !controlsVisible && playing && !audio

  return (
    <div
      ref={containerRef}
      className={`player ${audio ? 'player--audio' : ''} ${hidden ? 'player--hidden' : ''}`}
      onMouseMove={showControls}
      onClick={() => setMenu(null)}
    >
      <video
        ref={videoRef}
        className="player__video"
        src={media.url}
        autoPlay
        onClick={togglePlay}
        onDoubleClick={audio ? undefined : toggleFullscreen}
      >
        {subtitleUrl && <track kind="subtitles" src={subtitleUrl} default />}
      </video>

      {audio && (
        <div className="player__audio-art">
          <span>♪</span>
        </div>
      )}

      {error && <div className="player__error">{error}</div>}

      <div className="player__controls" onClick={(e) => e.stopPropagation()}>
        <div className="player__title">{media.name}</div>

        <div
          className="player__seek"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            seekTo(((e.clientX - r.left) / r.width) * duration)
          }}
        >
          <div className="player__seek-buffered" style={{ width: `${bufPct}%` }} />
          <div className="player__seek-played" style={{ width: `${pct}%` }} />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Position"
          />
        </div>

        <div className="player__bar">
          <button className="player__btn" onClick={togglePlay} title="Lecture / pause (espace)">
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="player__btn" onClick={() => seekBy(-SEEK_STEP)} title="−10 s (←)">
            ↺
          </button>
          <button className="player__btn" onClick={() => seekBy(SEEK_STEP)} title="+10 s (→)">
            ↻
          </button>
          <span className="player__time">
            {fmtDuration(time)} / {fmtDuration(duration || null)}
          </span>

          <div className="player__spacer" />

          <button className="player__btn" onClick={toggleMute} title="Muet (M)">
            {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
          </button>
          <input
            className="player__volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume"
          />

          {audioTracks.length > 1 && (
            <div className="player__menu-wrap">
              <button
                className={`player__btn ${menu === 'audio' ? 'player__btn--active' : ''}`}
                onClick={() => setMenu(menu === 'audio' ? null : 'audio')}
                title="Piste audio"
              >
                🎧
              </button>
              {menu === 'audio' && (
                <ul className="player__menu">
                  {audioTracks.map((t) => (
                    <li
                      key={t.id}
                      className={t.enabled ? 'player__menu-item--active' : ''}
                      onClick={() => selectAudio(t.id)}
                    >
                      {t.label || t.language || `Piste ${t.id}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!audio && (
            <div className="player__menu-wrap">
              <button
                className={`player__btn ${menu === 'subtitles' ? 'player__btn--active' : ''} ${subtitleId ? 'player__btn--on' : ''}`}
                onClick={() => setMenu(menu === 'subtitles' ? null : 'subtitles')}
                title="Sous-titres"
              >
                CC
              </button>
              {menu === 'subtitles' && subtitles.length === 0 && (
                <ul className="player__menu">
                  <li className="player__menu-empty">
                    Aucun sous-titre : ajoute un fichier{' '}
                    <code>{media.name.replace(/\.[^.]+$/, '')}.srt</code> à côté de la vidéo
                  </li>
                </ul>
              )}
              {menu === 'subtitles' && subtitles.length > 0 && (
                <ul className="player__menu">
                  <li
                    className={subtitleId === null ? 'player__menu-item--active' : ''}
                    onClick={() => void selectSubtitle(null)}
                  >
                    Désactivés
                  </li>
                  {subtitles.map((t) => (
                    <li
                      key={t.id}
                      className={t.id === subtitleId ? 'player__menu-item--active' : ''}
                      onClick={() => void selectSubtitle(t.id)}
                    >
                      {t.label}
                      <span className="player__menu-hint">
                        {t.source === 'external' ? 'fichier' : 'interne'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!audio && (
            <button className="player__btn" onClick={toggleFullscreen} title="Plein écran (F)">
              {fullscreen ? '⤡' : '⛶'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
