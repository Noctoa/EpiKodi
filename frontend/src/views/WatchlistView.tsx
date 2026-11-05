import { useState } from 'react'
import { toMediaUrl, type WatchlistItem } from '@shared/ipc'
import type { MediaWithMetadata, Profile } from '@shared/models'
import { ProfileAvatar } from '@frontend/components/ProfilePicker'
import { fmtDuration } from '@frontend/format'
import { useProfiles } from '@frontend/profiles'
import './WatchlistView.css'

interface Props {
  items: WatchlistItem[]
  onOpenDetail: (m: MediaWithMetadata) => void
  onPlay: (m: MediaWithMetadata) => void
  onRemove: (m: MediaWithMetadata) => void
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

/**
 * Watchlist du foyer : commune à tous les profils. Chaque entrée dit qui l'a proposée et qui
 * l'a déjà vue — c'est tout l'intérêt d'une liste partagée sans comptes ni serveur.
 */
export function WatchlistView({ items, onOpenDetail, onPlay, onRemove }: Props): React.JSX.Element {
  const { profiles, active } = useProfiles()
  const [hideSeen, setHideSeen] = useState(false)
  const byId = new Map(profiles.map((p) => [p.id, p]))
  const seenByMe = (i: WatchlistItem): boolean => i.seenBy.some((s) => s.profileId === active?.id)
  const shown = hideSeen ? items.filter((i) => !seenByMe(i)) : items

  if (items.length === 0) {
    return (
      <div className="grid__empty">
        La watchlist du foyer est vide. Ouvre la fiche d’un film ou d’un morceau et clique sur «
        Watchlist » : tous les profils le verront ici.
      </div>
    )
  }

  return (
    <div className="watchlist">
      <div className="watchlist__bar">
        <span className="watchlist__count">
          {items.length} titre{items.length > 1 ? 's' : ''} ·{' '}
          {items.filter((i) => !seenByMe(i)).length} à voir pour toi
        </span>
        <button
          className="btn--ghost"
          aria-pressed={hideSeen}
          onClick={() => setHideSeen((h) => !h)}
        >
          {hideSeen ? 'Afficher tout' : 'Masquer ce que j’ai vu'}
        </button>
      </div>

      {shown.length === 0 && (
        <div className="grid__empty">Tu as tout vu. Les autres ont peut-être encore à faire.</div>
      )}

      <ul className="watchlist__list">
        {shown.map((item) => (
          <WatchlistRow
            key={item.mediaId}
            item={item}
            author={item.addedBy === null ? null : (byId.get(item.addedBy) ?? null)}
            seenBy={item.seenBy.flatMap((s) => {
              const p = byId.get(s.profileId)
              return p ? [p] : []
            })}
            mine={seenByMe(item)}
            onOpenDetail={() => onOpenDetail(item.media)}
            onPlay={() => onPlay(item.media)}
            onRemove={() => onRemove(item.media)}
          />
        ))}
      </ul>
    </div>
  )
}

function WatchlistRow({
  item,
  author,
  seenBy,
  mine,
  onOpenDetail,
  onPlay,
  onRemove
}: {
  item: WatchlistItem
  author: Profile | null
  seenBy: Profile[]
  mine: boolean
  onOpenDetail: () => void
  onPlay: () => void
  onRemove: () => void
}): React.JSX.Element {
  const m = item.media
  const thumb = m.metadata?.posterPath ?? m.metadata?.thumbnailPath ?? null
  const kind = m.type === 'audio' ? 'Musique' : 'Vidéo'
  const extra = m.type === 'audio' ? m.metadata?.artist : m.metadata?.year
  return (
    <li className={`watchlist__row ${mine ? 'watchlist__row--seen' : ''}`}>
      <button className="watchlist__thumb" onClick={onOpenDetail} tabIndex={-1} aria-hidden="true">
        {thumb ? (
          <img src={toMediaUrl(thumb)} alt="" loading="lazy" />
        ) : (
          <span>{m.type === 'audio' ? '♪' : '▶'}</span>
        )}
      </button>

      <div className="watchlist__main">
        <button className="watchlist__title" onClick={onOpenDetail}>
          {m.title}
        </button>
        <p className="watchlist__meta">
          {[kind, extra, fmtDuration(m.duration)].filter(Boolean).join(' · ')}
        </p>
        <p className="watchlist__origin">
          {author ? (
            <>
              <ProfileAvatar profile={author} size="sm" />
              Proposé par <strong>{author.name}</strong>
            </>
          ) : (
            <>Proposé par un profil supprimé</>
          )}
          <span className="watchlist__date"> · {dateFmt.format(item.addedAt * 1000)}</span>
        </p>
      </div>

      <div className="watchlist__seen">
        {seenBy.length === 0 ? (
          <span className="watchlist__nobody">Personne ne l’a vu</span>
        ) : (
          <>
            <span className="watchlist__seen-label">✓ Vu par</span>
            <span className="watchlist__avatars">
              {seenBy.map((p) => (
                <span key={p.id} title={p.name} className="watchlist__seen-by">
                  <ProfileAvatar profile={p} size="sm" />
                  <span className="watchlist__seen-name">{p.name}</span>
                </span>
              ))}
            </span>
          </>
        )}
      </div>

      <div className="watchlist__actions">
        <button onClick={onPlay}>▶ Lire</button>
        <button className="btn--ghost" onClick={onRemove} title="Retirer pour tout le foyer">
          Retirer
        </button>
      </div>
    </li>
  )
}
