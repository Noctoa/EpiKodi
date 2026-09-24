import type { MediaWithMetadata } from '@shared/models'

export const UNKNOWN_ARTIST = 'Artiste inconnu'
export const UNKNOWN_ALBUM = 'Sans album'

export interface AlbumGroup {
  album: string
  artist: string
  year: number | null
  tracks: MediaWithMetadata[]
  /** Première pochette trouvée parmi les pistes */
  thumbnailPath: string | null
  duration: number
}

export interface ArtistGroup {
  artist: string
  albums: AlbumGroup[]
  trackCount: number
  thumbnailPath: string | null
}

const artistOf = (m: MediaWithMetadata): string =>
  m.metadata?.albumArtist?.trim() || m.metadata?.artist?.trim() || UNKNOWN_ARTIST
const albumOf = (m: MediaWithMetadata): string => m.metadata?.album?.trim() || UNKNOWN_ALBUM

/** Tri par numéro de piste puis titre, pour l'ordre de lecture d'un album. */
export function sortTracks(tracks: MediaWithMetadata[]): MediaWithMetadata[] {
  return [...tracks].sort(
    (a, b) =>
      (a.metadata?.track ?? 9999) - (b.metadata?.track ?? 9999) || a.title.localeCompare(b.title)
  )
}

/** Regroupe les pistes audio en artistes → albums → pistes (ordre alphabétique, inconnus en fin). */
export function groupByArtist(items: MediaWithMetadata[]): ArtistGroup[] {
  const byArtist = new Map<string, Map<string, MediaWithMetadata[]>>()
  for (const m of items) {
    if (m.type !== 'audio') continue
    const artist = artistOf(m)
    const album = albumOf(m)
    const albums = byArtist.get(artist) ?? new Map<string, MediaWithMetadata[]>()
    albums.set(album, [...(albums.get(album) ?? []), m])
    byArtist.set(artist, albums)
  }

  const groups: ArtistGroup[] = []
  for (const [artist, albums] of byArtist) {
    const albumGroups: AlbumGroup[] = []
    for (const [album, rawTracks] of albums) {
      const tracks = sortTracks(rawTracks)
      albumGroups.push({
        album,
        artist,
        year: tracks.find((t) => t.metadata?.year)?.metadata?.year ?? null,
        tracks,
        thumbnailPath:
          tracks.find((t) => t.metadata?.thumbnailPath)?.metadata?.thumbnailPath ?? null,
        duration: tracks.reduce((s, t) => s + (t.duration ?? 0), 0)
      })
    }
    albumGroups.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.album.localeCompare(b.album))
    groups.push({
      artist,
      albums: albumGroups,
      trackCount: albumGroups.reduce((s, a) => s + a.tracks.length, 0),
      thumbnailPath: albumGroups.find((a) => a.thumbnailPath)?.thumbnailPath ?? null
    })
  }
  return groups.sort(byNameWithUnknownLast((g) => g.artist, UNKNOWN_ARTIST))
}

export function albumsOf(groups: ArtistGroup[], artist: string): AlbumGroup[] {
  return groups.find((g) => g.artist === artist)?.albums ?? []
}

export function tracksOf(
  groups: ArtistGroup[],
  artist: string,
  album: string
): MediaWithMetadata[] {
  return albumsOf(groups, artist).find((a) => a.album === album)?.tracks ?? []
}

/** « Récemment ajoutés » : les derniers médias indexés, tous types confondus. */
export function recentlyAdded(items: MediaWithMetadata[], limit = 12): MediaWithMetadata[] {
  return [...items].sort((a, b) => b.addedAt - a.addedAt || b.id - a.id).slice(0, limit)
}

function byNameWithUnknownLast<T>(key: (v: T) => string, unknown: string) {
  return (a: T, b: T): number => {
    const ka = key(a)
    const kb = key(b)
    if (ka === unknown) return kb === unknown ? 0 : 1
    if (kb === unknown) return -1
    return ka.localeCompare(kb, 'fr', { sensitivity: 'base' })
  }
}
