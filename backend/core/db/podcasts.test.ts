import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, podcasts, type Database } from '.'
import type { EpisodeInput } from './repositories/podcasts'

let db: Database
let id: number

const INFO = {
  title: 'Radio Démo',
  description: 'Un podcast',
  author: 'Équipe',
  website: 'https://demo.example',
  imageUrl: 'https://demo.example/cover.jpg'
}

const ep = (n: number, extra: Partial<EpisodeInput> = {}): EpisodeInput => ({
  guid: `ep-${n}`,
  title: `Épisode ${n}`,
  description: `Description ${n}`,
  audioUrl: `https://demo.example/${n}.mp3`,
  mime: 'audio/mpeg',
  size: 1000 * n,
  duration: 60 * n,
  publishedAt: 1_700_000_000 + n * 86_400,
  ...extra
})

beforeEach(() => {
  db = openDatabase(':memory:')
  id = podcasts.upsert(db, 'https://demo.example/rss', INFO).id
})

describe('abonnements', () => {
  it('crée puis met à jour sans dupliquer', () => {
    expect(podcasts.list(db)).toHaveLength(1)
    const again = podcasts.upsert(db, 'https://demo.example/rss', {
      ...INFO,
      title: 'Nouveau titre'
    })
    expect(again.id).toBe(id)
    expect(podcasts.list(db)).toHaveLength(1)
    expect(podcasts.get(db, id)?.title).toBe('Nouveau titre')
  })

  it('ne perd pas une information déjà connue si le flux l’omet', () => {
    podcasts.upsert(db, 'https://demo.example/rss', {
      title: 'T',
      description: null,
      author: null,
      website: null,
      imageUrl: null
    })
    expect(podcasts.get(db, id)).toMatchObject({ description: 'Un podcast', author: 'Équipe' })
  })

  it('mémorise l’échec du dernier rafraîchissement', () => {
    podcasts.markFetched(db, id, 'HTTP 404')
    expect(podcasts.get(db, id)?.lastError).toBe('HTTP 404')
    podcasts.markFetched(db, id)
    expect(podcasts.get(db, id)?.lastError).toBeNull()
    expect(podcasts.get(db, id)?.lastFetchAt).toBeGreaterThan(0)
  })

  it('se désabonner supprime les épisodes', () => {
    podcasts.upsertEpisodes(db, id, [ep(1), ep(2)])
    podcasts.remove(db, id)
    expect(podcasts.count(db, id)).toBe(0)
  })
})

describe('épisodes', () => {
  it('compte les nouveaux épisodes et ignore les connus', () => {
    expect(podcasts.upsertEpisodes(db, id, [ep(1), ep(2)])).toBe(2)
    expect(podcasts.upsertEpisodes(db, id, [ep(1), ep(2), ep(3)])).toBe(1)
    expect(podcasts.count(db, id)).toBe(3)
  })

  it('les rend du plus récent au plus ancien', () => {
    podcasts.upsertEpisodes(db, id, [ep(1), ep(3), ep(2)])
    expect(podcasts.episodes(db, id).map((e) => e.title)).toEqual([
      'Épisode 3',
      'Épisode 2',
      'Épisode 1'
    ])
  })

  it('un rafraîchissement ne réinitialise ni la progression ni le téléchargement', () => {
    podcasts.upsertEpisodes(db, id, [ep(1)])
    const [episode] = podcasts.episodes(db, id)
    podcasts.saveProgress(db, episode.id, 120)
    podcasts.setLocalPath(db, episode.id, '/tmp/1.mp3')

    podcasts.upsertEpisodes(db, id, [ep(1, { title: 'Titre corrigé' })])
    const after = podcasts.episode(db, episode.id)!
    expect(after.title).toBe('Titre corrigé')
    expect(after.position).toBe(120)
    expect(after.localPath).toBe('/tmp/1.mp3')
  })

  it('retrouve un épisode par son URL distante ou par sa copie locale', () => {
    podcasts.upsertEpisodes(db, id, [ep(1)])
    const [episode] = podcasts.episodes(db, id)
    expect(podcasts.episodeByUrl(db, 'https://demo.example/1.mp3')?.id).toBe(episode.id)
    podcasts.setLocalPath(db, episode.id, '/tmp/1.mp3')
    expect(podcasts.episodeByUrl(db, '/tmp/1.mp3')?.id).toBe(episode.id)
    expect(podcasts.episodeByUrl(db, 'https://ailleurs/x.mp3')).toBeNull()
  })
})

describe('état de lecture', () => {
  beforeEach(() => podcasts.upsertEpisodes(db, id, [ep(1), ep(2), ep(3)]))

  it('mémorise la position sans toucher à l’état « lu »', () => {
    const [episode] = podcasts.episodes(db, id)
    podcasts.saveProgress(db, episode.id, 42.5)
    expect(podcasts.episode(db, episode.id)).toMatchObject({ position: 42.5, completed: false })
  })

  it('marquer lu remet la position à zéro, marquer non lu la conserve', () => {
    const [episode] = podcasts.episodes(db, id)
    podcasts.saveProgress(db, episode.id, 300)
    podcasts.setCompleted(db, episode.id, true)
    expect(podcasts.episode(db, episode.id)).toMatchObject({ completed: true, position: 0 })
    podcasts.setCompleted(db, episode.id, false)
    expect(podcasts.episode(db, episode.id)?.completed).toBe(false)
  })

  it('compte les épisodes non écoutés', () => {
    expect(podcasts.unplayedCount(db, id)).toBe(3)
    const [first] = podcasts.episodes(db, id)
    podcasts.setCompleted(db, first.id, true)
    expect(podcasts.unplayedCount(db, id)).toBe(2)
  })

  it('la fin de lecture marque l’épisode comme écouté', () => {
    const [episode] = podcasts.episodes(db, id)
    podcasts.saveProgress(db, episode.id, 60, true)
    expect(podcasts.episode(db, episode.id)?.completed).toBe(true)
  })
})
