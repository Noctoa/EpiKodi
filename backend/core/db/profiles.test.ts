import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  iptv,
  media,
  openDatabase,
  playback,
  playlists,
  podcasts,
  profiles,
  sources,
  type Database
} from '.'
import { migrate } from './database'

const episode = (n: number): podcasts.EpisodeInput => ({
  guid: `ep-${n}`,
  title: `Épisode ${n}`,
  description: null,
  audioUrl: `https://demo.example/${n}.mp3`,
  mime: 'audio/mpeg',
  size: null,
  duration: 60,
  publishedAt: 1_700_000_000 + n
})

const channel = (n: number): iptv.ChannelInput => ({
  key: `https://tv.example/${n}.m3u8`,
  name: `Chaîne ${n}`,
  streamUrl: `https://tv.example/${n}.m3u8`,
  logoUrl: null,
  group: null,
  epgId: null,
  userAgent: null,
  referrer: null,
  epgKey: null
})

describe('migration 14 : données existantes', () => {
  /**
   * Base telle qu'un utilisateur l'avait avant les profils (v13), remplie à la main en SQL : les
   * repositories, eux, parlent déjà le schéma suivant.
   */
  function legacyDatabase(): Database {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, 13)
    db.exec(`
      INSERT INTO sources (id, type, path, name) VALUES (1, 'local', '/v', 'Vidéos');
      INSERT INTO media (id, source_id, path, type, title, size, mtime) VALUES
        (1, 1, '/v/a.mkv', 'video', 'A', 1, 1),
        (2, 1, '/v/b.mkv', 'video', 'B', 1, 1);
      INSERT INTO playback_state (media_id, position, completed, favorite, play_count, last_played_at)
        VALUES (1, 754.5, 0, 1, 3, 1700000000), (2, 0, 1, 0, 1, 1700000100);
      INSERT INTO playlists (id, name) VALUES (1, 'Soirée');
      INSERT INTO playlist_items (playlist_id, media_id, position) VALUES (1, 2, 0), (1, 1, 1);
      INSERT INTO podcasts (id, feed_url, title) VALUES (1, 'https://demo.example/rss', 'Démo');
      INSERT INTO podcast_episodes (id, podcast_id, guid, title, audio_url, position, completed)
        VALUES (1, 1, 'g1', 'Un', 'https://demo.example/1.mp3', 42, 0),
               (2, 1, 'g2', 'Deux', 'https://demo.example/2.mp3', 0, 1),
               (3, 1, 'g3', 'Trois', 'https://demo.example/3.mp3', 0, 0);
      INSERT INTO iptv_sources (id, location, name) VALUES (1, 'https://tv.example/list.m3u', 'TV');
      INSERT INTO iptv_channels (id, source_id, channel_key, name, stream_url, favorite) VALUES
        (1, 1, 'k1', 'Une', 'https://tv.example/1', 1),
        (2, 1, 'k2', 'Deux', 'https://tv.example/2', 0);
      INSERT INTO settings (key, value) VALUES
        ('ui.theme', CAST('dark' AS BLOB)),
        ('iptv.lastChannel', CAST('1' AS BLOB)),
        ('remote.port', CAST('8765' AS BLOB));
    `)
    migrate(db)
    return db
  }

  it('crée un profil par défaut', () => {
    const db = legacyDatabase()
    expect(profiles.list(db)).toEqual([expect.objectContaining({ id: 1, avatar: null })])
  })

  it('rattache reprises et favoris au profil par défaut, intacts', () => {
    const db = legacyDatabase()
    expect(playback.get(db, 1, 1)).toEqual({
      mediaId: 1,
      position: 754.5,
      completed: false,
      favorite: true,
      playCount: 3,
      lastPlayedAt: 1700000000
    })
    expect(playback.get(db, 1, 2)).toMatchObject({ completed: true, playCount: 1 })
    expect(playback.favorites(db, 1).map((s) => s.mediaId)).toEqual([1])
  })

  it('garde les playlists et leur contenu ordonné', () => {
    const db = legacyDatabase()
    expect(playlists.list(db, 1).map((p) => p.name)).toEqual(['Soirée'])
    expect(playlists.items(db, 1, 1).map((m) => m.id)).toEqual([2, 1])
  })

  it('garde abonnements et écoute des podcasts', () => {
    const db = legacyDatabase()
    expect(podcasts.subscribed(db, 1).map((p) => p.id)).toEqual([1])
    const byId = new Map(podcasts.episodes(db, 1, 1).map((e) => [e.id, e]))
    expect(byId.get(1)).toMatchObject({ position: 42, completed: false })
    expect(byId.get(2)).toMatchObject({ position: 0, completed: true })
    expect(podcasts.unplayedCount(db, 1, 1)).toBe(2)
  })

  it('garde les chaînes favorites', () => {
    const db = legacyDatabase()
    expect(iptv.channels(db, { profileId: 1, favoritesOnly: true }).map((c) => c.id)).toEqual([1])
  })

  it('déplace les réglages personnels, laisse les autres', () => {
    const db = legacyDatabase()
    expect(profiles.getSetting(db, 1, 'ui.theme')).toBe('dark')
    expect(profiles.getSetting(db, 1, 'iptv.lastChannel')).toBe('1')
    const global = db.prepare('SELECT key FROM settings ORDER BY key').all()
    expect(global).toEqual([{ key: 'remote.port' }])
  })

  it('laisse les clés étrangères actives et cohérentes', () => {
    const db = legacyDatabase()
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // La cascade fonctionne encore sur la table reconstruite
    db.exec('DELETE FROM media WHERE id = 2')
    expect(playlists.items(db, 1, 1).map((m) => m.id)).toEqual([1])
  })
})

describe('cloisonnement entre profils', () => {
  let db: Database
  let a: number
  let b: number
  let film: number

  beforeEach(() => {
    db = openDatabase(':memory:')
    a = 1
    b = profiles.create(db, 'Invité').id
    const source = sources.create(db, { type: 'local', path: '/v', name: 'Vidéos' })
    film = media.upsert(db, {
      sourceId: source.id,
      path: '/v/film.mkv',
      type: 'video',
      title: 'Film',
      size: 1,
      mtime: 1
    }).id
  })

  it('deux profils ont des reprises indépendantes sur le même fichier', () => {
    playback.savePosition(db, a, film, 600)
    playback.savePosition(db, b, film, 42)
    expect(playback.get(db, a, film)?.position).toBe(600)
    expect(playback.get(db, b, film)?.position).toBe(42)
    expect(playback.inProgress(db, a).map((s) => s.position)).toEqual([600])
  })

  it('les favoris et le filtre « non vus » sont propres au profil', () => {
    playback.setFavorite(db, a, film, true)
    playback.savePosition(db, a, film, 0, true)
    expect(playback.favorites(db, b)).toEqual([])
    expect(media.count(db, { unwatched: true, profileId: a })).toBe(0)
    expect(media.count(db, { unwatched: true, profileId: b })).toBe(1)
  })

  it('la bibliothèque reste commune', () => {
    expect(media.list(db, { profileId: a })).toEqual(media.list(db, { profileId: b }))
  })

  it('une playlist est invisible et intouchable depuis un autre profil', () => {
    const p = playlists.create(db, a, 'À moi')
    playlists.addItem(db, a, p.id, film)

    expect(playlists.list(db, b)).toEqual([])
    expect(playlists.get(db, b, p.id)).toBeNull()
    expect(playlists.items(db, b, p.id)).toEqual([])

    playlists.rename(db, b, p.id, 'Volée')
    playlists.removeItem(db, b, p.id, film)
    expect(playlists.remove(db, b, p.id)).toBe(false)
    expect(playlists.get(db, a, p.id)?.name).toBe('À moi')
    expect(playlists.items(db, a, p.id).map((m) => m.id)).toEqual([film])
  })

  it('abonnements et écoute des podcasts sont séparés, le flux partagé', () => {
    const feed = podcasts.upsert(db, 'https://demo.example/rss', {
      title: 'Démo',
      description: null,
      author: null,
      website: null,
      imageUrl: null
    })
    podcasts.upsertEpisodes(db, feed.id, [episode(1), episode(2)])
    podcasts.subscribe(db, a, feed.id)

    expect(podcasts.subscribed(db, b)).toEqual([])
    podcasts.subscribe(db, b, feed.id)
    expect(podcasts.count(db, feed.id)).toBe(2)

    const [first] = podcasts.episodes(db, a, feed.id)
    podcasts.saveProgress(db, a, first.id, 30)
    podcasts.setCompleted(db, b, first.id, true)
    expect(podcasts.episode(db, first.id, a)).toMatchObject({ position: 30, completed: false })
    expect(podcasts.episode(db, first.id, b)).toMatchObject({ position: 0, completed: true })
    expect(podcasts.unplayedCount(db, a, feed.id)).toBe(2)
    expect(podcasts.unplayedCount(db, b, feed.id)).toBe(1)

    podcasts.unsubscribe(db, a, feed.id)
    expect(podcasts.orphans(db)).toEqual([])
    podcasts.unsubscribe(db, b, feed.id)
    expect(podcasts.orphans(db).map((p) => p.id)).toEqual([feed.id])
  })

  it('les chaînes favorites sont propres au profil', () => {
    const src = iptv.upsertSource(db, 'https://tv.example/list.m3u', 'TV')
    iptv.syncChannels(db, src.id, [channel(1), channel(2)])
    const second = iptv.channels(db, { profileId: a })[1]
    iptv.setFavorite(db, a, second.id, true)

    expect(iptv.channels(db, { profileId: a })[0].id).toBe(second.id)
    expect(iptv.channels(db, { profileId: b, favoritesOnly: true })).toEqual([])
    expect(iptv.channel(db, second.id, b)?.favorite).toBe(false)
  })

  it('les réglages personnels ne se mélangent pas', () => {
    profiles.setSetting(db, a, 'ui.theme', 'light')
    expect(profiles.getSetting(db, b, 'ui.theme')).toBeNull()
    profiles.setSetting(db, a, 'ui.theme', null)
    expect(profiles.getSetting(db, a, 'ui.theme')).toBeNull()
  })

  it('supprimer un profil emporte ses données, pas celles des autres', () => {
    playback.savePosition(db, a, film, 10)
    playback.savePosition(db, b, film, 20)
    playlists.create(db, b, 'Invité')
    profiles.setSetting(db, b, 'ui.theme', 'dark')

    profiles.remove(db, b)
    expect(profiles.get(db, b)).toBeNull()
    expect(playback.get(db, b, film)).toBeNull()
    expect(db.prepare('SELECT COUNT(*) AS n FROM playlists').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM profile_settings').get()).toEqual({ n: 0 })
    expect(playback.get(db, a, film)?.position).toBe(10)
  })

  it('refuse de supprimer le dernier profil', () => {
    profiles.remove(db, b)
    expect(() => profiles.remove(db, a)).toThrow(/dernier profil/)
  })

  it('renomme et change l’avatar indépendamment', () => {
    profiles.update(db, b, { avatar: 'icon:fox' })
    profiles.update(db, b, { name: 'Léa' })
    expect(profiles.get(db, b)).toMatchObject({ name: 'Léa', avatar: 'icon:fox' })
    profiles.update(db, b, { avatar: null })
    expect(profiles.get(db, b)?.avatar).toBeNull()
  })
})
