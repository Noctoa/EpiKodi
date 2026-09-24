import { describe, expect, it } from 'vitest'
import type { MediaWithMetadata } from '@shared/models'
import {
  albumsOf,
  groupByArtist,
  recentlyAdded,
  sortTracks,
  tracksOf,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST
} from './grouping'

let seq = 0
const track = (
  title: string,
  meta: Partial<NonNullable<MediaWithMetadata['metadata']>> | null,
  addedAt = ++seq
): MediaWithMetadata =>
  ({
    id: ++seq,
    sourceId: 1,
    path: `/${title}.mp3`,
    type: 'audio',
    title,
    size: 1,
    mtime: 1,
    duration: 100,
    probedAt: 1,
    addedAt,
    updatedAt: 1,
    metadata: meta as MediaWithMetadata['metadata']
  }) as MediaWithMetadata

const video = (title: string): MediaWithMetadata => ({ ...track(title, null), type: 'video' })

describe('groupByArtist', () => {
  const items = [
    track('One More Time', {
      artist: 'Daft Punk',
      album: 'Discovery',
      year: 2001,
      track: 1,
      thumbnailPath: '/a.jpg'
    }),
    track('Aerodynamic', { artist: 'Daft Punk', album: 'Discovery', year: 2001, track: 2 }),
    track('Da Funk', { artist: 'Daft Punk', album: 'Homework', year: 1997, track: 1 }),
    track('Perdu', null),
    track('Feat', {
      artist: 'Guest',
      albumArtist: 'Daft Punk',
      album: 'Discovery',
      year: 2001,
      track: 3
    }),
    video('Un film')
  ]

  it('ignore les vidéos et regroupe par artiste puis album', () => {
    const groups = groupByArtist(items)
    expect(groups.map((g) => g.artist)).toEqual(['Daft Punk', UNKNOWN_ARTIST])
    expect(groups[0].trackCount).toBe(4)
    expect(groups[0].albums.map((a) => a.album)).toEqual(['Homework', 'Discovery']) // par année
  })

  it('utilise albumArtist en priorité pour les featurings', () => {
    const disco = tracksOf(groupByArtist(items), 'Daft Punk', 'Discovery')
    expect(disco.map((t) => t.title)).toEqual(['One More Time', 'Aerodynamic', 'Feat'])
  })

  it('range les pistes sans tags dans « Artiste inconnu » / « Sans album »', () => {
    const unknown = groupByArtist(items).at(-1)!
    expect(unknown.albums[0].album).toBe(UNKNOWN_ALBUM)
    expect(unknown.albums[0].tracks.map((t) => t.title)).toEqual(['Perdu'])
  })

  it('remonte pochette, année et durée de l’album', () => {
    const [disco] = albumsOf(groupByArtist(items), 'Daft Punk').filter(
      (a) => a.album === 'Discovery'
    )
    expect(disco).toMatchObject({ year: 2001, thumbnailPath: '/a.jpg', duration: 300 })
  })
})

describe('sortTracks', () => {
  it('trie par numéro de piste, les sans-numéro à la fin par titre', () => {
    const sorted = sortTracks([
      track('Zeta', { track: null }),
      track('Deux', { track: 2 }),
      track('Alpha', { track: null }),
      track('Un', { track: 1 })
    ])
    expect(sorted.map((t) => t.title)).toEqual(['Un', 'Deux', 'Alpha', 'Zeta'])
  })
})

describe('recentlyAdded', () => {
  it('renvoie les derniers ajoutés, limités', () => {
    const items = [track('a', null, 10), track('b', null, 30), track('c', null, 20)]
    expect(recentlyAdded(items, 2).map((m) => m.title)).toEqual(['b', 'c'])
  })
})
