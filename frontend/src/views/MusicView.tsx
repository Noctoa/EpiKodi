import { toMediaUrl } from '@shared/ipc'
import type { MediaWithMetadata } from '@shared/models'
import { Grid, type GridTile } from '@frontend/components/Grid'
import { MediaList } from '@frontend/components/MediaList'
import { fmtDuration } from '@frontend/format'
import type { AlbumGroup, ArtistGroup } from '@frontend/library/grouping'
import './MusicView.css'

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`

/** Niveau 1 : les artistes. */
export function ArtistsView({
  artists,
  onOpen
}: {
  artists: ArtistGroup[]
  onOpen: (artist: string) => void
}): React.JSX.Element {
  const tiles: GridTile[] = artists.map((a) => ({
    key: a.artist,
    title: a.artist,
    subtitle: `${plural(a.albums.length, 'album')} · ${plural(a.trackCount, 'piste')}`,
    thumbnailUrl: a.thumbnailPath ? toMediaUrl(a.thumbnailPath) : null,
    icon: '♪',
    square: true
  }))
  return (
    <Grid
      tiles={tiles}
      onOpen={onOpen}
      empty="Aucune musique indexée. Ajoute un dossier de musique dans Sources."
    />
  )
}

/** Niveau 2 : les albums d'un artiste. */
export function AlbumsView({
  albums,
  onOpen,
  onPlay
}: {
  albums: AlbumGroup[]
  onOpen: (album: string) => void
  onPlay: (album: string) => void
}): React.JSX.Element {
  const tiles: GridTile[] = albums.map((a) => ({
    key: a.album,
    title: a.album,
    subtitle: [a.year, plural(a.tracks.length, 'piste')].filter(Boolean).join(' · '),
    thumbnailUrl: a.thumbnailPath ? toMediaUrl(a.thumbnailPath) : null,
    icon: '♪',
    square: true,
    badge: fmtDuration(a.duration)
  }))
  return <Grid tiles={tiles} onOpen={onOpen} onPlay={onPlay} empty="Aucun album." />
}

/** Niveau 3 : les pistes d'un album. */
export function AlbumTracksView({
  album,
  currentKey,
  onPlay,
  onEnqueue,
  onPlayNext,
  onPlayAll,
  onOpenDetail
}: {
  album: AlbumGroup
  currentKey: string | null
  onPlay: (m: MediaWithMetadata) => void
  onEnqueue: (m: MediaWithMetadata) => void
  onPlayNext: (m: MediaWithMetadata) => void
  onPlayAll: () => void
  onOpenDetail: (m: MediaWithMetadata) => void
}): React.JSX.Element {
  return (
    <div className="album">
      <header className="album__head">
        <div className={`album__art ${album.thumbnailPath ? '' : 'album__art--empty'}`}>
          {album.thumbnailPath ? (
            <img src={toMediaUrl(album.thumbnailPath)} alt="" />
          ) : (
            <span>♪</span>
          )}
        </div>
        <div className="album__info">
          <h2>{album.album}</h2>
          <p className="album__byline">
            {[
              album.artist,
              album.year,
              plural(album.tracks.length, 'piste'),
              fmtDuration(album.duration)
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <button onClick={onPlayAll}>▶ Lire l'album</button>
        </div>
      </header>
      <MediaList
        items={album.tracks}
        onPlay={onPlay}
        onEnqueue={onEnqueue}
        onPlayNext={onPlayNext}
        onOpenDetail={onOpenDetail}
        currentKey={currentKey}
        showTrackNumbers
      />
    </div>
  )
}
