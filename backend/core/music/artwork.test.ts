import { describe, expect, it } from 'vitest'
import {
  bareAlbum,
  pickDeezerAlbum,
  pickDeezerArtist,
  pickDeezerTrack,
  pickReleaseGroup
} from './artwork'

const cover = (hash: string): string =>
  `https://cdn-images.dzcdn.net/images/cover/${hash}/1000x1000-000000-80-0-0.jpg`

describe('bareAlbum', () => {
  it('retire les mentions d’édition, pas le reste des parenthèses', () => {
    expect(bareAlbum('Discovery (Deluxe Edition)')).toBe('Discovery')
    expect(bareAlbum('Random Access Memories [10th Anniversary Edition]')).toBe(
      'Random Access Memories'
    )
    expect(bareAlbum('(What’s the Story) Morning Glory?')).toBe('(What’s the Story) Morning Glory?')
  })
})

describe('pickDeezerAlbum', () => {
  it('prend l’album dont le titre et l’artiste correspondent', () => {
    const page = {
      data: [
        { title: 'Discovery Channel Hits', cover_xl: cover('a'), artist: { name: 'Various' } },
        { title: 'Discovery', cover_xl: cover('b'), artist: { name: 'Daft Punk' } }
      ]
    }
    expect(pickDeezerAlbum(page, 'Daft Punk', 'Discovery')).toBe(cover('b'))
  })

  it('reconnaît une réédition sous un autre nom d’édition', () => {
    const page = {
      data: [
        { title: 'Discovery (Remastered)', cover_xl: cover('c'), artist: { name: 'Daft Punk' } }
      ]
    }
    expect(pickDeezerAlbum(page, 'Daft Punk', 'Discovery (Deluxe Edition)')).toBe(cover('c'))
  })

  it('ne donne pas la pochette d’un autre artiste pour un album homonyme', () => {
    const page = { data: [{ title: 'Discovery', cover_xl: cover('d'), artist: { name: 'ELO' } }] }
    expect(pickDeezerAlbum(page, 'Daft Punk', 'Discovery')).toBeNull()
  })

  it('ignore l’image par défaut que Deezer renvoie faute de pochette', () => {
    const page = {
      data: [
        {
          title: 'Discovery',
          cover_xl: 'https://cdn-images.dzcdn.net/images/cover//1000x1000-000000-80-0-0.jpg',
          artist: { name: 'Daft Punk' }
        }
      ]
    }
    expect(pickDeezerAlbum(page, 'Daft Punk', 'Discovery')).toBeNull()
    expect(pickDeezerAlbum(null, 'Daft Punk', 'Discovery')).toBeNull()
  })
})

describe('pickDeezerArtist', () => {
  const picture = (hash: string): string =>
    `https://cdn-images.dzcdn.net/images/artist/${hash}/1000x1000-000000-80-0-0.jpg`

  it('départage des homonymes par leur popularité', () => {
    const page = {
      data: [
        { name: 'Jul', picture_xl: picture('petit'), nb_fan: 120 },
        { name: 'JUL', picture_xl: picture('marseille'), nb_fan: 4_000_000 },
        { name: 'Julien Doré', picture_xl: picture('dore'), nb_fan: 900_000 }
      ]
    }
    expect(pickDeezerArtist(page, 'Jul')).toBe(picture('marseille'))
  })

  it('n’attribue pas la photo d’un nom approchant', () => {
    expect(
      pickDeezerArtist({ data: [{ name: 'Julien Doré', picture_xl: picture('dore') }] }, 'Jul')
    ).toBeNull()
  })

  it('ignore la silhouette des artistes sans photo', () => {
    const page = {
      data: [
        {
          name: 'Yuka Tsujiyoko',
          picture_xl: 'https://cdn-images.dzcdn.net/images/artist//1000x1000.jpg'
        }
      ]
    }
    expect(pickDeezerArtist(page, 'Yuka Tsujiyoko')).toBeNull()
  })
})

describe('pickReleaseGroup', () => {
  it('ne retient un résultat de MusicBrainz que s’il ressemble à ce qu’on cherche', () => {
    const groups = [
      { id: 'faux', title: 'Discovery', score: 100, 'artist-credit': [{ name: 'ELO' }] },
      { id: 'bon', title: 'Discovery', score: 98, 'artist-credit': [{ name: 'Daft Punk' }] }
    ]
    expect(pickReleaseGroup(groups, 'Daft Punk', 'Discovery')).toBe('bon')
    expect(pickReleaseGroup(groups, 'Daft Punk', 'Homework')).toBeNull()
  })
})

describe('pickDeezerTrack', () => {
  const page = {
    data: [
      {
        id: 1,
        title: 'PANAFRI',
        artist: { name: 'Ino Casablanca' },
        album: { title: 'EXTASIAAAAA' }
      },
      {
        id: 2,
        title: 'PAPA CASA',
        artist: { name: 'Ino Casablanca' },
        album: { title: 'EXTASIAAAAA' }
      }
    ]
  }

  it('retrouve l’album du bon morceau, même avec un invité dans l’artiste', () => {
    expect(pickDeezerTrack(page, 'Ino Casablanca, Naïka', 'PAPA CASA')).toEqual({
      trackId: 2,
      album: 'EXTASIAAAAA',
      albumArtist: 'Ino Casablanca'
    })
  })

  it('refuse un morceau d’un autre artiste ou au titre différent', () => {
    expect(pickDeezerTrack(page, 'Jul', 'PAPA CASA')).toBeNull()
    expect(pickDeezerTrack(page, 'Ino Casablanca', 'BBY MAMA')).toBeNull()
  })
})
