import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { media, music, openDatabase, sources, type Database } from '../db'
import { Throttle } from './http'
import { MusicRecognizer, primaryArtist, processTrack, type MusicContext } from './recognizer'

// L'empreinte demande un vrai morceau : on la simule, le reste de la chaîne est réel
vi.mock('./acoustid', async (original) => ({
  ...(await original<typeof import('./acoustid')>()),
  fingerprint: vi.fn(async () => ({ duration: 320, fingerprint: 'AQAA' }))
}))

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const DEEZER_COVER = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000.jpg'
const DEEZER_PHOTO = 'https://cdn-images.dzcdn.net/images/artist/def/1000x1000.jpg'

/** Ce que répondent les services, selon l'URL demandée. */
type Route = (url: string, init?: RequestInit) => Response | null
let routes: Route[]
let calls: string[]

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const image = (): Response => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })

const acoustid: Route = (url) =>
  url.startsWith('https://api.acoustid.org/')
    ? json({
        status: 'ok',
        results: [
          {
            score: 0.95,
            recordings: [
              {
                id: 'rec-1',
                title: 'Digital Love',
                artists: [{ name: 'Daft Punk' }],
                releasegroups: [
                  {
                    id: 'rg-discovery',
                    title: 'Discovery',
                    type: 'Album',
                    artists: [{ name: 'Daft Punk' }],
                    releases: [
                      {
                        date: { year: 2001 },
                        mediums: [{ position: 1, tracks: [{ position: 3 }] }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      })
    : null
const coverArchive: Route = (url) =>
  url === 'https://coverartarchive.org/release-group/rg-discovery/front-500' ? image() : null
const deezer: Route = (url) => {
  if (url.startsWith('https://api.deezer.com/search/album'))
    return json({
      data: [{ title: 'Discovery', cover_xl: DEEZER_COVER, artist: { name: 'Daft Punk' } }]
    })
  if (url.startsWith('https://api.deezer.com/search/artist'))
    return json({ data: [{ name: 'Daft Punk', picture_xl: DEEZER_PHOTO, nb_fan: 10 }] })
  if (url === DEEZER_COVER || url === DEEZER_PHOTO) return image()
  return null
}

let db: Database
let dir: string
let key: string | null
let ctx: MusicContext

const track = (path: string, tags: Parameters<typeof media.setMetadata>[2] = {}): number => {
  const source =
    sources.list(db)[0] ?? sources.create(db, { type: 'local', path: '/musique', name: 'Musique' })
  const m = media.upsert(db, {
    sourceId: source.id,
    path,
    type: 'audio',
    title: 'piste_03',
    size: 1,
    mtime: 1
  })
  media.setMetadata(db, m.id, tags)
  media.markProbed(db, m.id)
  return m.id
}

beforeEach(async () => {
  Throttle.enabled = false
  db = openDatabase(':memory:')
  dir = await mkdtemp(join(tmpdir(), 'epikodi-music-'))
  key = 'cle-de-test'
  routes = [acoustid, coverArchive, deezer]
  calls = []
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    for (const route of routes) {
      const res = route(url, init)
      if (res) return res
    }
    return new Response('introuvable', { status: 404 })
  })
  ctx = {
    artDir: dir,
    acoustidKey: () => key,
    canFingerprint: async () => true,
    online: () => true,
    resolveUrl: async (l) => l
  }
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

describe('processTrack', () => {
  it('reconnaît un morceau sans tags et le range dans son album', async () => {
    const id = track('/musique/piste_03.mp3')
    expect(await processTrack(db, id, ctx)).toEqual({
      recognized: true,
      poster: true,
      backdrop: true
    })

    const item = media.get(db, id)!
    const meta = media.getMetadata(db, id)!
    expect(item.title).toBe('Digital Love')
    expect(meta).toMatchObject({
      artist: 'Daft Punk',
      album: 'Discovery',
      albumArtist: 'Daft Punk',
      year: 2001,
      track: 3,
      externalId: 'musicbrainz:recording:rec-1'
    })
    // La pochette vient de l'album reconnu, sans recherche par nom
    expect(calls).not.toContainEqual(expect.stringContaining('search/album'))
    expect(await readFile(meta.posterPath!)).toEqual(JPEG)
    expect(meta.backdropPath).not.toBeNull()
    expect(item.identifiedAt).not.toBeNull()
  })

  it('ne touche pas aux tags écrits par l’utilisateur', async () => {
    const id = track('/musique/a.mp3', {
      artist: 'Daft Punk',
      album: null,
      year: 1999
    })
    await processTrack(db, id, ctx)
    expect(media.getMetadata(db, id)).toMatchObject({
      artist: 'Daft Punk',
      album: 'Discovery',
      year: 1999
    })
    // L'artiste était connu : le titre aussi, on ne le remplace pas
    expect(media.get(db, id)!.title).toBe('piste_03')
  })

  it('n’interroge pas AcoustID pour un morceau déjà tagué, et cherche sa pochette par nom', async () => {
    const id = track('/musique/b.mp3', { artist: 'Daft Punk', album: 'Discovery' })
    expect(await processTrack(db, id, ctx)).toMatchObject({ recognized: false, poster: true })
    expect(calls).not.toContainEqual(expect.stringContaining('acoustid'))
    expect(calls).toContainEqual(expect.stringContaining('search/album'))
  })

  it('cherche la pochette d’un album une seule fois pour toutes ses pistes', async () => {
    const ids = [1, 2, 3].map((n) =>
      track(`/musique/${n}.mp3`, { artist: 'Daft Punk', album: 'Discovery' })
    )
    for (const id of ids) await processTrack(db, id, ctx)
    expect(calls.filter((u) => u.includes('search/album'))).toHaveLength(1)
    expect(calls.filter((u) => u.includes('search/artist'))).toHaveLength(1)
    const posters = ids.map((id) => media.getMetadata(db, id)!.posterPath)
    expect(new Set(posters).size).toBe(1)
  })

  it('se souvient d’un album introuvable, pour ne pas réinterroger les services', async () => {
    routes = []
    const id = track('/musique/c.mp3', { artist: 'Inconnu', album: 'Démo' })
    expect(await processTrack(db, id, ctx)).toMatchObject({ poster: false, backdrop: false })
    const count = calls.length
    await processTrack(db, track('/musique/d.mp3', { artist: 'Inconnu', album: 'Démo' }), ctx)
    expect(calls).toHaveLength(count)
    // Les Paramètres disent lesquels, plutôt qu'un « 0 pochette » sans explication
    expect(music.stats(db).notFound).toEqual(['Inconnu — Démo', 'Inconnu'])
  })

  it('remet au lendemain un album que MusicBrainz, saturé, n’a pas pu chercher', async () => {
    routes = [
      (url) =>
        url.startsWith('https://musicbrainz.org/')
          ? json({ error: 'The MusicBrainz web server is currently busy.' }, 503)
          : null
    ]
    const id = track('/musique/l.mp3', { artist: 'Inconnu', album: 'Démo' })
    // Le morceau est traité, la file n'est pas arrêtée
    expect(await processTrack(db, id, ctx)).toMatchObject({ poster: false })
    expect(calls.filter((u) => u.includes('musicbrainz'))).toHaveLength(3)

    const now = Math.floor(Date.now() / 1000)
    // Un mois d'attente pour un vrai « introuvable », un jour pour une source saturée
    expect(music.forgetMisses(db, now - music.MISS_TTL_SECONDS)).toBe(0)
    // La photo de l'artiste, elle, est un vrai « introuvable » : seul l'album est oublié
    expect(music.forgetMisses(db, now + 86400 - music.MISS_TTL_SECONDS + 60)).toBe(1)
    expect(music.pendingTracks(db)).toEqual([id])
  })

  it('garde les pochettes sans clé AcoustID, et attend la clé pour les morceaux sans tags', async () => {
    key = null
    const untagged = track('/musique/e.mp3')
    const tagged = track('/musique/f.mp3', { artist: 'Daft Punk', album: 'Discovery' })
    await processTrack(db, untagged, ctx)
    await processTrack(db, tagged, ctx)
    expect(media.getMetadata(db, tagged)!.posterPath).not.toBeNull()
    expect(media.getMetadata(db, untagged)!.artist).toBeNull()
    expect(music.stats(db).unrecognized).toBe(1)

    // La clé arrive : seul le morceau sans tags est repris
    expect(music.requeueUntagged(db)).toBe(1)
    expect(music.pendingTracks(db)).toEqual([untagged])
  })

  it('n’envoie rien quand la recherche en ligne est désactivée et la clé absente', async () => {
    key = null
    ctx.online = () => false
    await processTrack(
      db,
      track('/musique/g.mp3', { artist: 'Daft Punk', album: 'Discovery' }),
      ctx
    )
    expect(calls).toEqual([])
  })
})

describe('processTrack, morceaux téléchargés sans tags', () => {
  const ino: Route = (url) => {
    if (url.startsWith('https://api.deezer.com/search/track'))
      return json({
        data: [
          {
            id: 42,
            title: 'PAPA CASA',
            artist: { name: 'Ino Casablanca' },
            album: { title: 'EXTASIAAAAA' }
          }
        ]
      })
    return null
  }

  it('lit l’artiste dans le nom du fichier, puis retrouve l’album sur Deezer', async () => {
    key = null
    routes = [ino, deezer]
    const id = track('/musique/Ino Casablanca, Naïka - PAPA CASA.mp3')
    expect(await processTrack(db, id, ctx)).toMatchObject({ fromFileName: true, albumFound: true })
    expect(media.get(db, id)!.title).toBe('PAPA CASA')
    expect(media.getMetadata(db, id)).toMatchObject({
      artist: 'Ino Casablanca, Naïka',
      // Rangé sous l'artiste principal, avec ses autres morceaux
      albumArtist: 'Ino Casablanca',
      album: 'EXTASIAAAAA',
      externalId: 'deezer:track:42'
    })
    expect(music.stats(db)).toMatchObject({ recognized: 1, unrecognized: 0 })
  })

  it('garde l’artiste lu dans le nom même sans réseau, sans inventer d’album', async () => {
    key = null
    ctx.online = () => false
    const id = track('/musique/Ino Casablanca - BBY MAMA.mp3')
    await processTrack(db, id, ctx)
    expect(media.getMetadata(db, id)).toMatchObject({ artist: 'Ino Casablanca', album: null })
    expect(calls).toEqual([])
  })

  it('retire l’artiste répété dans le titre tagué', async () => {
    key = null
    routes = [ino]
    const id = track('/musique/x.mp3', { artist: 'Ino Casablanca' })
    media.markProbed(db, id, { title: 'INO CASABLANCA - PAPA CASA' })
    await processTrack(db, id, ctx)
    expect(media.get(db, id)!.title).toBe('PAPA CASA')
    expect(media.getMetadata(db, id)!.album).toBe('EXTASIAAAAA')
  })
})

describe('MusicRecognizer', () => {
  const drain = (recognizer: MusicRecognizer): Promise<void> =>
    new Promise((resolve) => {
      ;(recognizer as unknown as { opts: { onIdle: () => void } }).opts.onIdle = resolve
      recognizer.enqueuePending()
    })

  it('s’arrête hors ligne sans rien marquer, pour tout reprendre plus tard', async () => {
    const ids = [track('/musique/h.mp3', { artist: 'A', album: 'B' }), track('/musique/i.mp3')]
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const recognizer = new MusicRecognizer(db, { ...ctx })
    await drain(recognizer)
    expect(music.pendingTracks(db)).toEqual(ids)
    expect(recognizer.lastError).toMatch(/fetch failed/)
  })

  it('continue avec les pochettes quand la clé AcoustID est refusée', async () => {
    routes = [
      (url) =>
        url.startsWith('https://api.acoustid.org/')
          ? json({ status: 'error', error: { code: 4, message: 'invalid API key' } }, 400)
          : null,
      deezer
    ]
    const untagged = track('/musique/j.mp3')
    const tagged = track('/musique/k.mp3', { artist: 'Daft Punk', album: 'Discovery' })
    const recognizer = new MusicRecognizer(db, { ...ctx })
    await drain(recognizer)
    expect(recognizer.lastError).toBe('clé AcoustID refusée')
    // Une seule tentative : la clé n'est pas réessayée pour chaque morceau
    expect(calls.filter((u) => u.includes('acoustid'))).toHaveLength(1)
    expect(media.getMetadata(db, tagged)!.posterPath).not.toBeNull()
    expect(music.pendingTracks(db)).toEqual([])
    expect(media.getMetadata(db, untagged)!.artist).toBeNull()
  })
})

describe('primaryArtist', () => {
  it('garde l’artiste principal d’un featuring', () => {
    expect(primaryArtist('Jul feat. Valouzz')).toBe('Jul')
    expect(primaryArtist('Jul ft Valouzz')).toBe('Jul')
    expect(primaryArtist('Simon & Garfunkel')).toBe('Simon & Garfunkel')
  })
})
