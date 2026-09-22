import { useState } from 'react'
import { useAudioPlayer } from '@frontend/player/AudioPlayerContext'
import { fmtDuration } from './MediaList'
import { QueuePanel } from './QueuePanel'
import './MiniPlayer.css'

const REPEAT_ICON = { off: '🔁', all: '🔁', one: '🔂' } as const
const REPEAT_TITLE = {
  off: 'Répéter : non',
  all: 'Répéter : la file',
  one: 'Répéter : la piste'
} as const

/** Barre de lecture audio persistante, en bas de toutes les vues. */
export function MiniPlayer(): React.JSX.Element | null {
  const p = useAudioPlayer()
  const [queueOpen, setQueueOpen] = useState(false)
  const { current, status, queue } = p
  if (!current) return null

  const pct = status.duration ? (status.time / status.duration) * 100 : 0
  const position = queue.items.findIndex((i) => i.key === current.key) + 1

  return (
    <>
      {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
      <footer className="mini">
        <div
          className="mini__seek"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            p.seek(((e.clientX - r.left) / r.width) * status.duration)
          }}
        >
          <div className="mini__seek-played" style={{ width: `${pct}%` }} />
        </div>

        <div className="mini__row">
          <div className="mini__now">
            <div className="mini__art">
              {current.thumbnailUrl ? <img src={current.thumbnailUrl} alt="" /> : <span>♪</span>}
            </div>
            <div className="mini__text">
              <div className="mini__title" title={current.path}>
                {current.title}
              </div>
              <div className="mini__sub">
                {[current.artist, current.album].filter(Boolean).join(' · ') || 'Audio'}
              </div>
            </div>
          </div>

          <div className="mini__controls">
            <button
              className={`mini__btn mini__btn--small ${queue.shuffle ? 'mini__btn--on' : ''}`}
              onClick={p.toggleShuffle}
              title="Aléatoire"
            >
              🔀
            </button>
            <button className="mini__btn" onClick={p.prev} title="Précédent">
              ⏮
            </button>
            <button
              className="mini__btn mini__btn--play"
              onClick={p.toggle}
              title="Lecture / pause"
            >
              {status.playing ? '❚❚' : '▶'}
            </button>
            <button className="mini__btn" onClick={p.next} title="Suivant">
              ⏭
            </button>
            <button
              className={`mini__btn mini__btn--small ${queue.repeat !== 'off' ? 'mini__btn--on' : ''}`}
              onClick={p.cycleRepeat}
              title={REPEAT_TITLE[queue.repeat]}
            >
              {REPEAT_ICON[queue.repeat]}
            </button>
          </div>

          <div className="mini__right">
            <span className="mini__time">
              {fmtDuration(status.time)} / {fmtDuration(status.duration || current.duration)}
            </span>
            <button className="mini__btn mini__btn--small" onClick={p.toggleMute} title="Muet">
              {status.muted || status.volume === 0 ? '🔇' : '🔊'}
            </button>
            <input
              className="mini__volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={status.muted ? 0 : status.volume}
              onChange={(e) => p.setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
            <button
              className={`mini__btn mini__btn--small ${queueOpen ? 'mini__btn--on' : ''}`}
              onClick={() => setQueueOpen((o) => !o)}
              title="File d'attente"
            >
              ☰ {position}/{queue.items.length}
            </button>
          </div>
        </div>
        {status.error && <div className="mini__error">{status.error}</div>}
      </footer>
    </>
  )
}
