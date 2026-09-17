import { useEffect, useRef } from 'react'
import { AUDIO_EXTENSIONS, type OpenedMedia } from '@shared/ipc'
import './Player.css'

interface PlayerProps {
  media: OpenedMedia
}

function isAudio(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return AUDIO_EXTENSIONS.includes(ext)
}

/** POC : lecteur natif Chromium via <video>/<audio>, source servie par le protocole media://. */
export function Player({ media }: PlayerProps): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.load()
    void el.play().catch(() => {
      /* autoplay refusé : l'utilisateur cliquera sur Play */
    })
    if (!import.meta.env.DEV) return
    const log = (e: Event): void => {
      const detail =
        e.type === 'error'
          ? ` code=${el.error?.code} ${el.error?.message}`
          : ` t=${el.currentTime.toFixed(2)}/${el.duration.toFixed(2)}`
      console.log(`[player] ${e.type}${detail}`)
    }
    const events = ['loadedmetadata', 'playing', 'timeupdate', 'seeked', 'ended', 'error']
    events.forEach((ev) => el.addEventListener(ev, log))
    return () => events.forEach((ev) => el.removeEventListener(ev, log))
  }, [media.url])

  return (
    <div className="player">
      <video
        ref={ref}
        className={isAudio(media.name) ? 'player__media player__media--audio' : 'player__media'}
        src={media.url}
        controls
        autoPlay
      />
      <div className="player__info">
        <span className="player__name">{media.name}</span>
        <span className="player__path">{media.path}</span>
      </div>
    </div>
  )
}
