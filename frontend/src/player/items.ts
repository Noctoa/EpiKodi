import { toMediaUrl, type OpenedMedia } from '@shared/ipc'
import type { MediaWithMetadata } from '@shared/models'
import type { QueueItem } from './queue'

/** Média de la bibliothèque → élément de file. */
export function fromMedia(m: MediaWithMetadata): QueueItem {
  return {
    key: `media:${m.id}`,
    path: m.path,
    url: toMediaUrl(m.path),
    title: m.title,
    artist: m.metadata?.artist ?? m.metadata?.albumArtist ?? null,
    album: m.metadata?.album ?? null,
    duration: m.duration,
    thumbnailUrl: m.metadata?.thumbnailPath ? toMediaUrl(m.metadata.thumbnailPath) : null
  }
}

/** Fichier ouvert hors bibliothèque (dialogue, ligne de commande). */
export function fromOpened(o: OpenedMedia): QueueItem {
  return {
    key: `file:${o.path}`,
    path: o.path,
    url: o.url,
    title: o.name.replace(/\.[^.]+$/, ''),
    artist: null,
    album: null,
    duration: null,
    thumbnailUrl: null
  }
}

/**
 * Ordre "album" pour enchaîner une liste de pistes : par album, puis numéro de piste, puis titre.
 * Les pistes sans album vont à la fin, entre elles par titre.
 */
export function albumOrder(items: MediaWithMetadata[]): MediaWithMetadata[] {
  const k = (m: MediaWithMetadata): [string, number, string] => [
    m.metadata?.album ?? '￿',
    m.metadata?.track ?? 0,
    m.title
  ]
  return [...items].sort((a, b) => {
    const [aa, at, an] = k(a)
    const [ba, bt, bn] = k(b)
    return aa.localeCompare(ba) || at - bt || an.localeCompare(bn)
  })
}
