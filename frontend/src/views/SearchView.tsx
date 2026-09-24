import type { MediaWithMetadata } from '@shared/models'
import { Grid } from '@frontend/components/Grid'
import { MediaList } from '@frontend/components/MediaList'
import { tileOf } from './HomeView'
import './SearchView.css'

interface Props {
  results: MediaWithMetadata[]
  search: string
  currentKey: string | null
  onOpenDetail: (m: MediaWithMetadata) => void
  onPlay: (m: MediaWithMetadata, queue: MediaWithMetadata[]) => void
  onEnqueue: (m: MediaWithMetadata) => void
  onPlayNext: (m: MediaWithMetadata) => void
}

/** Résultats de recherche groupés par type : vidéos en grille, musique en liste. */
export function SearchView({
  results,
  search,
  currentKey,
  onOpenDetail,
  onPlay,
  onEnqueue,
  onPlayNext
}: Props): React.JSX.Element {
  const videos = results.filter((m) => m.type === 'video')
  const tracks = results.filter((m) => m.type === 'audio')

  if (results.length === 0) {
    return (
      <div className="grid__empty">
        Aucun résultat pour « {search} ». Essaie un titre, un artiste, un album ou un nom de
        fichier.
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
