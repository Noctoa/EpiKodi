import { useState } from 'react'
import { useAudioPlayer } from '@frontend/player/AudioPlayerContext'
import { fmtDuration } from './MediaList'
import './QueuePanel.css'

/** File d'attente : sauter à une piste, retirer, réordonner par glisser-déposer. */
export function QueuePanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const p = useAudioPlayer()
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const total = p.queue.items.reduce((s, i) => s + (i.duration ?? 0), 0)

  return (
    <div className="queue">
      <div className="queue__head">
        <h3>
          File d'attente{' '}
          <span className="queue__count">
            {p.queue.items.length} · {fmtDuration(total)}
          </span>
        </h3>
        <div className="queue__actions">
          <button className="btn--ghost" onClick={p.clear}>
            Vider
          </button>
          <button className="btn--ghost" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <ol className="queue__list">
        {p.queue.items.map((item, i) => (
          <li
            key={item.key}
            className={[
              'queue__item',
              i === p.queue.index ? 'queue__item--current' : '',
              dragOver === i && dragFrom !== i ? 'queue__item--over' : ''
            ].join(' ')}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(i)
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={() => {
              if (dragFrom !== null) p.move(dragFrom, i)
              setDragFrom(null)
              setDragOver(null)
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDragOver(null)
            }}
            onDoubleClick={() => p.jumpTo(i)}
          >
            <span className="queue__grip" title="Glisser pour réordonner">
              ⋮⋮
            </span>
            <span className="queue__num">
              {i === p.queue.index && p.status.playing ? '▶' : i + 1}
            </span>
            <span className="queue__text" onClick={() => p.jumpTo(i)}>
              <span className="queue__title">{item.title}</span>
              <span className="queue__sub">
                {[item.artist, item.album].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="queue__dur">{fmtDuration(item.duration)}</span>
            <button className="queue__remove" onClick={() => p.remove(item.key)} title="Retirer">
              ✕
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
