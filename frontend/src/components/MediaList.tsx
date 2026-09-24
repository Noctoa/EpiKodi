import { toMediaUrl } from '@shared/ipc'
import type { MediaWithMetadata } from '@shared/models'
import { fmtDuration, fmtResolution, fmtSize } from '@frontend/format'
import './MediaList.css'

interface Props {
  items: MediaWithMetadata[]
  onPlay: (m: MediaWithMetadata) => void
  onEnqueue?: (m: MediaWithMetadata) => void
  onPlayNext?: (m: MediaWithMetadata) => void
  /** Ouvre la vue détail (clic sur le titre) */
  onOpenDetail?: (m: MediaWithMetadata) => void
  /** Clé de la piste audio en cours (pour la surligner) */
  currentKey?: string | null
  /** Affiche le numéro de piste à la place de la miniature (vue album) */
  showTrackNumbers?: boolean
}

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

export function MediaList({
  items,
  onPlay,
  onEnqueue,
  onPlayNext,
  onOpenDetail,
  currentKey,
  showTrackNumbers
}: Props): React.JSX.Element {
  if (items.length === 0) {
    return <p className="media-list__empty">Aucun média indexé.</p>
  }
  return (
    <ul className={`media-list ${showTrackNumbers ? 'media-list--tracks' : ''}`}>
      {items.map((m, i) => (
        <li
          key={m.id}
          className={`media-item ${currentKey === `media:${m.id}` ? 'media-item--current' : ''}`}
          onDoubleClick={() => onPlay(m)}
        >
          {showTrackNumbers ? (
            <span className="media-item__num">{m.metadata?.track ?? i + 1}</span>
          ) : (
            <div className={`media-item__thumb media-item__thumb--${m.type}`}>
              {m.metadata?.thumbnailPath ? (
                <img src={toMediaUrl(m.metadata.thumbnailPath)} alt="" loading="lazy" />
              ) : (
                <span>{m.type === 'video' ? '▶' : '♪'}</span>
              )}
            </div>
          )}

          <button className="media-item__text" onClick={() => onPlay(m)}>
            <span className="media-item__title">{m.title}</span>
            {!showTrackNumbers && <span className="media-item__sub">{subtitle(m)}</span>}
          </button>

          <span className="media-item__actions">
            {onOpenDetail && (
              <button
                className="media-item__action"
                onClick={() => onOpenDetail(m)}
                title="Détails"
              >
                ⓘ
              </button>
            )}
            {m.type === 'audio' && onPlayNext && (
              <button
                className="media-item__action"
                onClick={() => onPlayNext(m)}
                title="Lire ensuite"
              >
                ⤴
              </button>
            )}
            {m.type === 'audio' && onEnqueue && (
              <button
                className="media-item__action"
                onClick={() => onEnqueue(m)}
                title="Ajouter à la file"
              >
                +
              </button>
            )}
          </span>

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
