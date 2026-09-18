import { toMediaUrl } from '@shared/ipc'
import type { MediaWithMetadata } from '@shared/models'
import './MediaList.css'

interface Props {
  items: MediaWithMetadata[]
  onPlay: (m: MediaWithMetadata) => void
}

export const fmtDuration = (s: number | null): string => {
  if (s === null) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

const fmtSize = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} Go` : `${Math.round(bytes / 1e6)} Mo`

/** "1080p", "4K"… à partir de la hauteur */
const fmtResolution = (h: number | null): string | null =>
  h === null ? null : h >= 2160 ? '4K' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : `${h}p`

function subtitle(m: MediaWithMetadata): string {
  const md = m.metadata
  if (m.type === 'audio') {
    return [md?.artist, md?.album, md?.year].filter(Boolean).join(' · ') || 'Audio'
  }
  return (
    [fmtResolution(md?.height ?? null), md?.videoCodec?.toUpperCase(), fmtSize(m.size)]
      .filter(Boolean)
      .join(' · ') || fmtSize(m.size)
  )
}

export function MediaList({ items, onPlay }: Props): React.JSX.Element {
  if (items.length === 0) {
    return <p className="media-list__empty">Aucun média indexé.</p>
  }
  return (
    <ul className="media-list">
      {items.map((m) => (
        <li key={m.id} className="media-item" onClick={() => onPlay(m)}>
          <div className={`media-item__thumb media-item__thumb--${m.type}`}>
            {m.metadata?.thumbnailPath ? (
              <img src={toMediaUrl(m.metadata.thumbnailPath)} alt="" loading="lazy" />
            ) : (
              <span>{m.type === 'video' ? '▶' : '♪'}</span>
            )}
          </div>
          <div className="media-item__text">
            <span className="media-item__title">{m.title}</span>
            <span className="media-item__sub">{subtitle(m)}</span>
          </div>
          <span className="media-item__meta">
            {m.probedAt === null ? (
              <span className="media-item__pending">analyse…</span>
            ) : (
              fmtDuration(m.duration)
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
