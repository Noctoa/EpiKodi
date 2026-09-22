import { describe, expect, it } from 'vitest'
import type { MediaWithMetadata } from '@shared/models'
import { albumOrder, fromMedia } from './items'

const media = (
  id: number,
  title: string,
  album: string | null,
  track: number | null
): MediaWithMetadata =>
  ({
    id,
    sourceId: 1,
    path: `/${id}.mp3`,
    type: 'audio',
    title,
    size: 1,
    mtime: 1,
    duration: 100,
    probedAt: 1,
    addedAt: 1,
    updatedAt: 1,
    metadata: album
      ? ({ album, track, artist: 'A', thumbnailPath: null } as MediaWithMetadata['metadata'])
      : null
  }) as MediaWithMetadata

describe('albumOrder', () => {
  it('trie par album, numéro de piste puis titre ; sans album à la fin', () => {
    const sorted = albumOrder([
      media(1, 'Zed', null, null),
      media(2, 'Piste 2', 'Homework', 2),
      media(3, 'Piste 1', 'Homework', 1),
      media(4, 'Alpha', 'Discovery', 1),
      media(5, 'Alone', null, null)
    ])
    expect(sorted.map((m) => m.id)).toEqual([4, 3, 2, 5, 1])
  })
})

describe('fromMedia', () => {
  it('construit un élément de file avec artiste et pochette', () => {
    const q = fromMedia(media(7, 'T', 'Alb', 1))
    expect(q).toMatchObject({
      key: 'media:7',
      title: 'T',
      artist: 'A',
      album: 'Alb',
      duration: 100
    })
    expect(q.url).toBe('media://local/%2F7.mp3')
  })
})
