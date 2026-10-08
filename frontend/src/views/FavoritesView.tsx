import type { MediaWithMetadata } from '@shared/models'
import { Grid } from '@frontend/components/Grid'
import { MediaList } from '@frontend/components/MediaList'
import { tileOf } from './HomeView'

interface Props {
  items: MediaWithMetadata[]
  currentKey: string | null
  onOpenDetail: (m: MediaWithMetadata) => void
  onPlay: (m: MediaWithMetadata, queue: MediaWithMetadata[]) => void
  onEnqueue: (m: MediaWithMetadata) => void
  onPlayNext: (m: MediaWithMetadata) => void
}

/** Favoris : vidéos en grille, musique en liste, comme dans les résultats de recherche. */
export function FavoritesView({
  items,
  currentKey,
  onOpenDetail,
  onPlay,
  onEnqueue,
  onPlayNext
}: Props): React.JSX.Element {
  const videos = items.filter((m) => m.type === 'video')
  const tracks = items.filter((m) => m.type === 'audio')

  if (items.length === 0) {
    return (
      <div className="grid__empty">
        Aucun favori. Ouvre un média et clique sur l’étoile pour le retrouver ici.
      </div>
    )
  }

  return (
    <div className="search-results">
      {videos.length > 0 && (
        <section>
          <h3 className="search-results__section">Vidéos · {videos.length}</h3>
          <Grid
            tiles={videos.map((m) => tileOf(m, currentKey))}
            onOpen={(k) => onOpenDetail(videos.find((m) => String(m.id) === k)!)}
            onPlay={(k) =>
              onPlay(
                videos.find((m) => String(m.id) === k)!,
                videos
              )
            }
          />
        </section>
      )}
      {tracks.length > 0 && (
        <section>
          <h3 className="search-results__section">Musique · {tracks.length}</h3>
          <MediaList
            items={tracks}
            currentKey={currentKey}
            onPlay={(m) => onPlay(m, tracks)}
            onEnqueue={onEnqueue}
            onPlayNext={onPlayNext}
            onOpenDetail={onOpenDetail}
          />
        </section>
      )}
    </div>
  )
}
