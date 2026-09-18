import type { Media } from '@shared/models'
import './MediaList.css'

interface Props {
  items: Media[]
  onPlay: (m: Media) => void
}

const fmtSize = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} Go` : `${Math.round(bytes / 1e6)} Mo`

export function MediaList({ items, onPlay }: Props): React.JSX.Element {
  if (items.length === 0) {
    return <p className="media-list__empty">Aucun média indexé.</p>
  }
  return (
    <ul className="media-list">
      {items.map((m) => (
        <li key={m.id} className="media-item" onClick={() => onPlay(m)}>
          <span className={`media-item__type media-item__type--${m.type}`}>
            {m.type === 'video' ? '▶' : '♪'}
          </span>
          <span className="media-item__title">{m.title}</span>
          <span className="media-item__meta">{fmtSize(m.size)}</span>
        </li>
      ))}
    </ul>
  )
}
