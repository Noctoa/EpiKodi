import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUDIO_EXTENSIONS,
  toLiveUrl,
  toStreamUrl,
  type OpenedMedia,
  type PlaybackPlanInfo,
  type SubtitleTrack
} from '@shared/ipc'
import { fmtDuration } from '@frontend/format'
import { setVideoControl, type MediaControl } from '@frontend/remote/control'
import './Player.css'

interface PlayerProps {
  media: OpenedMedia
  /** Identifiant en bibliothèque : sans lui, la position n'est pas mémorisée */
  mediaId?: number
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
  /** Compteurs Chromium d'octets passés aux décodeurs : le débit réel du direct */
  webkitVideoDecodedByteCount?: number
  webkitAudioDecodedByteCount?: number
}

const SEEK_STEP = 10
const VOLUME_STEP = 0.05
const HIDE_DELAY = 2500
/** Après une pause plus longue, reprendre un direct le rejoint là où il en est, pas là où on l'a laissé. */
const LIVE_REJOIN_MS = 10_000
const LIVE_STATS_MS = 2000

/** « 1080p · 4,2 Mb/s » : ce que le direct envoie vraiment, pas ce que la playlist annonce. */
function liveStats(height: number, kbps: number): string | null {
  const parts = [
    height > 0 ? `${height}p` : null,
    kbps > 0 ? `${(kbps / 1000).toFixed(1)} Mb/s` : null
  ]
  return parts.filter(Boolean).join(' · ') || null
}

function isAudio(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return AUDIO_EXTENSIONS.includes(ext)
}

export function Player({ media, mediaId, onClose }: PlayerProps): React.JSX.Element {
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

  const [plan, setPlan] = useState<PlaybackPlanInfo | null>(null)
  /** Position de départ du flux ffmpeg courant : en transcodé, le saut relance l'encodage ici */
  const [offset, setOffset] = useState(0)

  /** Position enregistrée à l'ouverture : propose de reprendre plutôt que de l'imposer */
  const [resumeAt, setResumeAt] = useState<number | null>(null)

  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([])
  const [subtitleId, setSubtitleId] = useState<string | null>(null)
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null)
  const [audioTracks, setAudioTracks] = useState<AudioTrackLike[]>([])
  const [menu, setMenu] = useState<'subtitles' | 'audio' | null>(null)
  /** Moment de la mise en pause, pour savoir si un direct doit être rejoint à la reprise */
  const pausedAt = useRef<number | null>(null)

  /** Chaîne en direct : pas de durée, pas de saut, pas de reprise — et ffmpeg derrière */
  const isLive = media.live === true
  /** Relance du direct (bouton Réessayer, retour après une longue pause) : change l'URL */
  const [attempt, setAttempt] = useState(0)
  const [starting, setStarting] = useState(isLive)
  const [stats, setStats] = useState<string | null>(null)

  const audio = isAudio(media.name)
  const transcoded = plan !== null && plan.mode !== 'direct'
  // Tant que le plan n'est pas connu, on ne charge rien : inutile de faire échouer une lecture
  // directe sur un .avi pour la relancer aussitôt en transcodé.
  const src = isLive
    ? toLiveUrl(media.path, attempt)
    : plan === null
      ? null
      : transcoded
        ? toStreamUrl(media.path, offset)
        : media.url

  useEffect(() => {
    // Un direct n'a rien à analyser : ni plan de lecture, ni position, ni sous-titres à côté
    if (isLive) return
    let cancelled = false
    window.epikodi.playerPlan(media.path).then((p) => {
      if (!cancelled) setPlan(p)
    })
    if (mediaId !== undefined) {
      window.epikodi.playbackState(mediaId).then((state) => {
        // On ne propose la reprise que si l'on est loin du début et de la fin
        if (!cancelled && !state.completed && state.position > 10) setResumeAt(state.position)
      })
    }
    if (!audio) void window.epikodi.playerSubtitles(media.path).then(setSubtitles)
    return () => {
      cancelled = true
    }
  }, [media.path, audio, mediaId, isLive])

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
    // `<video>` ne sait dire que « échec » : pour un direct, le backend sait pourquoi
    const liveFailure = (prefix: string): void => {
      setStarting(false)
      void window.epikodi.playerLiveError(media.path).then((reason) => {
        setError(reason ? `${prefix} : ${reason}` : prefix)
      })
    }
    const onError = (): void => {
      if (isLive) liveFailure('Chaîne indisponible')
      else setError(el.error?.message ?? 'Lecture impossible')
    }
    const onVolume = (): void => {
      setVolume(el.volume)
      setMuted(el.muted)
    }
    const onPlay = (): void => {
      setPlaying(true)
      const since = pausedAt.current
      pausedAt.current = null
      if (isLive && since !== null && Date.now() - since > LIVE_REJOIN_MS) setAttempt((a) => a + 1)
    }
    const onPause = (): void => {
      setPlaying(false)
      pausedAt.current = Date.now()
    }
    const onEnded = (): void => {
      setPlaying(false)
      if (isLive) liveFailure('Le direct s’est interrompu')
    }
    const handlers: [string, () => void][] = [
      ['play', onPlay],
      ['pause', onPause],
      // Chaque relance du direct repart d'un écran propre, jusqu'à la première image
      [
        'loadstart',
        () => {
          if (!isLive) return
          setStarting(true)
          setError(null)
        }
      ],
      ['playing', () => setStarting(false)],
      ['ended', onEnded],
      ['timeupdate', onTime],
      ['progress', onTime],
      ['loadedmetadata', onMeta],
      ['durationchange', onMeta],
      ['volumechange', onVolume],
      ['error', onError]
    ]
    handlers.forEach(([e, h]) => el.addEventListener(e, h))
    return () => handlers.forEach(([e, h]) => el.removeEventListener(e, h))
  }, [isLive, media.path])

  // Résolution et débit du direct, relevés sur ce que le décodeur reçoit vraiment
  useEffect(() => {
    const el = videoRef.current
    if (!isLive || !el) return
    let last = { bytes: 0, at: performance.now() }
    const timer = setInterval(() => {
      const bytes = (el.webkitVideoDecodedByteCount ?? 0) + (el.webkitAudioDecodedByteCount ?? 0)
      const at = performance.now()
      // Le compteur repart de zéro à chaque relance du flux
      const kbps = bytes >= last.bytes ? ((bytes - last.bytes) * 8) / (at - last.at) : 0
      last = { bytes, at }
      setStats(liveStats(el.videoHeight, kbps))
    }, LIVE_STATS_MS)
    return () => clearInterval(timer)
  }, [isLive, src])

  useEffect(() => {
    const onFs = (): void => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Position mémorisée toutes les 5 secondes et à la fermeture : rouvrir la vidéo proposera
  // de reprendre là où l'on s'était arrêté. Au-delà de 95 %, le média est considéré vu.
  const lastSaved = useRef(0)
  useEffect(() => {
    if (mediaId === undefined || duration <= 0) return
    const finished = time >= duration * 0.95
    if (!finished && Math.abs(time - lastSaved.current) < 5) return
    lastSaved.current = time
    void window.epikodi.playbackSave(mediaId, finished ? 0 : time, finished)
  }, [mediaId, time, duration])

  // Fermeture du lecteur : on enregistre la position exacte, sans attendre le prochain tour
  useEffect(() => {
    const el = videoRef.current
    return () => {
      if (mediaId === undefined || !el || !Number.isFinite(el.duration)) return
      const fini = el.currentTime >= el.duration * 0.95
      void window.epikodi.playbackSave(mediaId, fini ? 0 : el.currentTime, fini)
    }
  }, [mediaId])

  // Un flux transcodé recommence à 0 après chaque saut : le temps réel est décalé, et la durée
  // vient de ffprobe puisque le conteneur fragmenté ne l'annonce pas.
  // Un direct n'a pas de durée : Chromium annonce l'infini, qu'on ne veut ni afficher ni envoyer
  // à la télécommande.
  const displayDuration = isLive ? 0 : transcoded ? (plan?.duration ?? 0) : duration
  // `-ss` recule jusqu'à l'image clé précédente : le flux démarre un peu avant la position
  // demandée, donc le temps calculé peut dépasser la durée réelle. On le borne.
  const clamp = (t: number): number => (displayDuration ? Math.min(t, displayDuration) : t)
  const displayTime = transcoded ? clamp(offset + time) : time
  const displayBuffered = transcoded ? clamp(offset + buffered) : buffered

  // Lues par les actions et les raccourcis, qui doivent rester stables entre deux rendus
  const live = useRef({ time: 0, duration: 0, transcoded: false })
  useEffect(() => {
    live.current = { time: displayTime, duration: displayDuration, transcoded }
  }, [displayTime, displayDuration, transcoded])

  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }, [])

  const seekTo = useCallback(
    (t: number) => {
      const el = videoRef.current
      if (!el || isLive) return
      const target = Math.max(0, Math.min(t, live.current.duration || t))
      if (live.current.transcoded) {
        // On ne peut pas se déplacer dans un flux : on en redemande un qui commence à `target`
        setTime(0)
        setBuffered(0)
        setOffset(target)
      } else el.currentTime = target
    },
    [isLive]
  )

  const seekBy = useCallback((delta: number) => seekTo(live.current.time + delta), [seekTo])

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

  // La télécommande (téléphone, manette) pilote le lecteur par cet enregistrement : elle lit la
  // position à la demande, sans provoquer de rendu à chaque seconde de lecture.
  useEffect(() => {
    const control: MediaControl = {
      source: 'video',
      snapshot: () => {
        const el = videoRef.current
        return {
          playing: el ? !el.paused && !el.ended : false,
          title: media.name,
          // Sans durée, le téléphone désactive sa barre de lecture ; la deuxième ligne dit pourquoi
          subtitle: isLive ? 'En direct' : null,
          position: isLive ? 0 : live.current.time,
          duration: live.current.duration,
          volume: el?.volume ?? 1,
          muted: el?.muted ?? false
        }
      },
      toggle: togglePlay,
      play: () => void videoRef.current?.play().catch(() => undefined),
      pause: () => videoRef.current?.pause(),
      stop: () => onClose?.(),
      seekTo,
      seekBy,
      setVolume: changeVolume,
      toggleMute
    }
    setVideoControl(control)
    return () => setVideoControl(null)
  }, [media.name, isLive, togglePlay, seekTo, seekBy, changeVolume, toggleMute, onClose])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const map: Record<string, () => void> = {
        ' ': togglePlay,
        k: togglePlay,
        ...(isLive
          ? {}
          : {
              ArrowLeft: () => seekBy(-SEEK_STEP),
              ArrowRight: () => seekBy(SEEK_STEP),
              j: () => seekBy(-SEEK_STEP),
              l: () => seekBy(SEEK_STEP)
            }),
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
  }, [
    togglePlay,
    seekBy,
    changeVolume,
    toggleFullscreen,
    toggleMute,
    showControls,
    onClose,
    menu,
    isLive
  ])

  // La source est posée ici plutôt qu'en attribut : quitter le lecteur ou changer de flux doit
  // couper l'ancien. Sans cela, Chromium garde la requête ouverte le temps que l'élément soit
  // ramassé — et, pour un direct ou un fichier transcodé, ffmpeg avec elle (mesuré : plus de 8 s).
  // Déclaré en dernier : l'enregistrement de la position, plus haut, lit `currentTime` avant.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !src) return
    el.src = src
    void el.play().catch(() => {
      /* autoplay refusé : l'utilisateur cliquera sur Play */
    })
    return () => {
      el.removeAttribute('src')
      el.load()
    }
  }, [src])

  const pct = displayDuration ? (displayTime / displayDuration) * 100 : 0
  const bufPct = displayDuration ? (displayBuffered / displayDuration) * 100 : 0
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

      {error && (
        <div className="player__error">
          <span>{error}</span>
          {isLive && (
            <button className="btn--ghost" onClick={() => setAttempt((a) => a + 1)}>
              Réessayer
            </button>
          )}
        </div>
      )}

      {isLive && starting && !error && (
        <div className="player__resume">
          <span>Connexion à la chaîne…</span>
        </div>
      )}

      {resumeAt !== null && (
        <div className="player__resume">
          <span>Tu avais arrêté à {fmtDuration(resumeAt)}.</span>
          <button
            onClick={() => {
              seekTo(resumeAt)
              setResumeAt(null)
            }}
          >
            Reprendre
          </button>
          <button className="btn--ghost" onClick={() => setResumeAt(null)}>
            Recommencer
          </button>
        </div>
      )}

      <div className="player__controls" onClick={(e) => e.stopPropagation()}>
        <div className="player__title">
          {media.name}
          {isLive && <span className="player__badge player__badge--live">En direct</span>}
          {isLive && stats && <span className="player__stats">{stats}</span>}
          {transcoded && (
            <span className="player__badge" title={plan.reason}>
              {plan.mode === 'remux' ? 'remux' : 'transcodage'}
            </span>
          )}
        </div>

        {!isLive && (
          <div
            className="player__seek"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              seekTo(((e.clientX - r.left) / r.width) * displayDuration)
            }}
          >
            <div className="player__seek-buffered" style={{ width: `${bufPct}%` }} />
            <div className="player__seek-played" style={{ width: `${pct}%` }} />
            <input
              type="range"
              min={0}
              max={displayDuration || 0}
              step={0.1}
              value={displayTime}
              onChange={(e) => seekTo(Number(e.target.value))}
              aria-label="Position"
            />
          </div>
        )}

        <div className="player__bar">
          <button className="player__btn" onClick={togglePlay} title="Lecture / pause (espace)">
            {playing ? '❚❚' : '▶'}
          </button>
          {!isLive && (
            <>
              <button className="player__btn" onClick={() => seekBy(-SEEK_STEP)} title="−10 s (←)">
                ↺
              </button>
              <button className="player__btn" onClick={() => seekBy(SEEK_STEP)} title="+10 s (→)">
                ↻
              </button>
              <span className="player__time">
                {fmtDuration(displayTime)} / {fmtDuration(displayDuration || null)}
              </span>
            </>
          )}

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

          {!audio && !isLive && (
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
