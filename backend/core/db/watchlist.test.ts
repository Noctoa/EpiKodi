import { beforeEach, describe, expect, it } from 'vitest'
import { media, openDatabase, playback, profiles, sources, watchlist, type Database } from '.'

let db: Database
let a: number
let b: number
let film: number
let serie: number

beforeEach(() => {
  db = openDatabase(':memory:')
  a = 1
  b = profiles.create(db, 'Invité').id
  const source = sources.create(db, { type: 'local', path: '/v', name: 'Vidéos' })
  const add = (path: string): number =>
    media.upsert(db, { sourceId: source.id, path, type: 'video', title: path, size: 1, mtime: 1 })
      .id
  film = add('/v/film.mkv')
  serie = add('/v/serie.mkv')
})

describe('watchlist du foyer', () => {
  it('un ajout depuis un profil est visible de tous, avec son auteur', () => {
    watchlist.add(db, a, film)
    expect(watchlist.list(db)).toEqual([
      { mediaId: film, addedBy: a, addedAt: expect.any(Number), seenBy: [] }
    ])
    // La liste ne dépend d'aucun profil : c'est la même pour B
    expect(watchlist.has(db, film)).toBe(true)
  })

  it('un second ajout ne change pas l’auteur d’origine', () => {
    watchlist.add(db, a, film)
    watchlist.add(db, b, film)
    expect(watchlist.list(db)).toHaveLength(1)
    expect(watchlist.list(db)[0].addedBy).toBe(a)
  })

  it('marque « vu » le profil qui termine le média, et lui seul', () => {
    watchlist.add(db, a, film)
    watchlist.markSeen(db, b, film)
    expect(watchlist.list(db)[0].seenBy).toEqual([{ profileId: b, seenAt: expect.any(Number) }])
  })

  it('ignore la fin d’un média absent de la liste', () => {
    watchlist.markSeen(db, a, serie)
    expect(watchlist.list(db)).toEqual([])
  })

  it('reprend ce que chacun avait déjà terminé au moment de l’ajout', () => {
    playback.savePosition(db, b, film, 0, true)
    playback.savePosition(db, a, film, 300)
    watchlist.add(db, a, film)
    expect(watchlist.list(db)[0].seenBy.map((s) => s.profileId)).toEqual([b])
  })

  it('le retrait efface aussi les « vu »', () => {
    watchlist.add(db, a, film)
    watchlist.markSeen(db, a, film)
    expect(watchlist.remove(db, film)).toBe(true)
    expect(watchlist.list(db)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM shared_watchlist_seen').get()).toEqual({ n: 0 })
  })

  it('l’entrée survit à la suppression de son auteur', () => {
    watchlist.add(db, b, film)
    watchlist.markSeen(db, b, film)
    profiles.remove(db, b)
    expect(watchlist.list(db)).toEqual([
      { mediaId: film, addedBy: null, addedAt: expect.any(Number), seenBy: [] }
    ])
  })

  it('un média supprimé de la bibliothèque quitte la liste', () => {
    watchlist.add(db, a, film)
    media.remove(db, film)
    expect(watchlist.list(db)).toEqual([])
  })
})
