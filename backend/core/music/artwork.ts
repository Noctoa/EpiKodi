import { titleSimilarity } from '../metadata/score'
import { downloadImage, getJson, Throttle, TransientError } from './http'

/**
 * Pochettes d'albums et photos d'artistes. Trois sources, aucune ne demande de clé :
 *
 * - **Cover Art Archive** : les pochettes de MusicBrainz, par identifiant d'album. C'est la voie
 *   directe quand la reconnaissance par empreinte a déjà donné cet identifiant.
 * - **Deezer** : une recherche par nom renvoie pochette (1000 px) et photo d'artiste. MusicBrainz
 *   n'a pas de photos d'artistes ; Deezer en a pour presque tous.
 * - **MusicBrainz** : recherche d'album par nom, en dernier recours, puis Cover Art Archive.
 *
 * Toute réponse est vérifiée par ressemblance des noms : un album introuvable ne doit pas
 * recevoir la pochette du premier résultat venu.
 */

/** Deezer tolère 50 requêtes en 5 secondes ; MusicBrainz exige une par seconde au plus. */
const deezer = new Throttle(150)
const musicbrainz = new Throttle(1100)
const covers = new Throttle(200)

/** Au-dessous, deux noms ne désignent pas la même chose. */
const SAME_NAME = 0.75

/**
 * « Discovery (Deluxe Edition) » et « Discovery » sont le même album, « Random Access Memories
 * (10th Anniversary) » aussi : les mentions d'édition entre parenthèses ne comptent pas.
 */
export function bareAlbum(title: string): string {
  const bare = title
    .replace(
      /[([][^)\]]*(edition|édition|remaster|deluxe|version|anniversary|bonus|expanded)[^)\]]*[)\]]/gi,
      ''
    )
    .trim()
  return bare || title
}

const sameAlbum = (a: string, b: string): boolean =>
  Math.max(titleSimilarity(a, b), titleSimilarity(bareAlbum(a), bareAlbum(b))) >= SAME_NAME
const sameArtist = (a: string, b: string): boolean => titleSimilarity(a, b) >= SAME_NAME

// ---- Deezer ----

interface DeezerAlbum {
  title: string
  cover_xl?: string
  cover_big?: string
  artist?: { name: string }
}

interface DeezerArtist {
  name: string
  picture_xl?: string
  picture_big?: string
  nb_fan?: number
}

/** Deezer répond 200 même en erreur, avec `{ error: { code: 4, message: "Quota…" } }`. */
type DeezerPage<T> = { data?: T[]; error?: { code?: number; message?: string } }

/** Sans photo, Deezer renvoie quand même une URL, vers une silhouette grise : « …/artist//… ». */
const realImage = (url: string | undefined): string | null =>
  url && !/\/images\/(artist|cover)\/\//.test(url) ? url : null

export function pickDeezerAlbum(
  page: DeezerPage<DeezerAlbum> | null,
  artist: string,
  album: string
): string | null {
  for (const candidate of page?.data ?? []) {
    if (!sameAlbum(candidate.title, album)) continue
    if (candidate.artist && !sameArtist(candidate.artist.name, artist)) continue
    const url = realImage(candidate.cover_xl ?? candidate.cover_big)
    if (url) return url
  }
  return null
}

/** Homonymes : à nom égal, l'artiste le plus écouté est presque toujours le bon. */
export function pickDeezerArtist(
  page: DeezerPage<DeezerArtist> | null,
  artist: string
): string | null {
  const candidates = (page?.data ?? [])
    .filter((a) => sameArtist(a.name, artist))
    .sort(
      (a, b) =>
        titleSimilarity(b.name, artist) - titleSimilarity(a.name, artist) ||
        (b.nb_fan ?? 0) - (a.nb_fan ?? 0)
    )
  for (const candidate of candidates) {
    const url = realImage(candidate.picture_xl ?? candidate.picture_big)
    if (url) return url
  }
  return null
}

async function deezerSearch<T>(
  kind: 'album' | 'artist' | 'track',
  query: string
): Promise<DeezerPage<T> | null> {
  const url = `https://api.deezer.com/search/${kind}?limit=10&q=${encodeURIComponent(query)}`
  const page = await getJson<DeezerPage<T>>(url, deezer)
  if (page?.error) throw new Error(`Deezer : ${page.error.message ?? 'erreur'}`)
  return page
}

interface DeezerTrack {
  id: number
  title: string
  artist?: { name: string }
  album?: { title: string }
}

/** « BBY MAMA (feat. X) » et « BBY MAMA » sont le même morceau. */
const sameTrack = (a: string, b: string): boolean => {
  const bare = (t: string): string => t.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || t
  return Math.max(titleSimilarity(a, b), titleSimilarity(bare(a), bare(b))) >= SAME_NAME
}

export interface TrackAlbum {
  trackId: number
  album: string
  /** L'artiste principal selon Deezer : « Ino Casablanca » pour « Ino Casablanca, Naïka » */
  albumArtist: string
}

export function pickDeezerTrack(
  page: DeezerPage<DeezerTrack> | null,
  artist: string,
  title: string
): TrackAlbum | null {
  for (const t of page?.data ?? []) {
    if (!t.album?.title || !t.artist?.name) continue
    if (!sameTrack(t.title, title) || !sameArtist(t.artist.name, artist)) continue
    return { trackId: t.id, album: t.album.title, albumArtist: t.artist.name }
  }
  return null
}

/** Album d'un morceau dont on ne connaît que l'artiste et le titre. */
export async function findTrackAlbum(artist: string, title: string): Promise<TrackAlbum | null> {
  // La syntaxe avancée de Deezer (artist:"…" track:"…") ne renvoie souvent rien : texte libre
  return pickDeezerTrack(
    await deezerSearch<DeezerTrack>('track', `${artist} ${title}`),
    artist,
    title
  )
}

// ---- MusicBrainz ----

interface MbReleaseGroup {
  id: string
  title: string
  score?: number
  'primary-type'?: string
  'artist-credit'?: { name: string; joinphrase?: string }[]
}

/** Les guillemets et opérateurs de Lucene, échappés pour une recherche exacte. */
const lucene = (value: string): string => value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1')

export function pickReleaseGroup(
  groups: MbReleaseGroup[] | undefined,
  artist: string,
  album: string
): string | null {
  const match = (groups ?? []).find(
    (g) =>
      (g.score ?? 100) >= 80 &&
      sameAlbum(g.title, album) &&
      sameArtist(
        (g['artist-credit'] ?? []).map((c) => c.name + (c.joinphrase ?? '')).join(''),
        artist
      )
  )
  return match?.id ?? null
}

async function musicbrainzReleaseGroup(artist: string, album: string): Promise<string | null> {
  const query = `releasegroup:"${lucene(bareAlbum(album))}" AND artist:"${lucene(artist)}"`
  const url = `https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=${encodeURIComponent(query)}`
  const page = await getJson<{ 'release-groups'?: MbReleaseGroup[] }>(url, musicbrainz)
  return pickReleaseGroup(page?.['release-groups'], artist, album)
}

// ---- recherche ----

export interface FoundImage {
  path: string
  source: 'coverartarchive' | 'deezer'
  /** Identifiant MusicBrainz de l'album, quand on le connaît */
  mbid: string | null
}

const coverArtUrl = (releaseGroupId: string): string =>
  `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`

/**
 * Pochette d'un album, téléchargée dans `dir` sous `fileName`. null quand aucune source ne la
 * connaît, « retry » quand l'une d'elles n'a pas pu répondre ; une panne réseau remonte en
 * `TransientError`.
 */
export async function findAlbumCover(
  artist: string,
  album: string,
  releaseGroupId: string | null,
  dir: string,
  fileName: string
): Promise<FoundImage | 'retry' | null> {
  if (releaseGroupId) {
    const path = await downloadImage(coverArtUrl(releaseGroupId), dir, fileName, covers)
    if (path) return { path, source: 'coverartarchive', mbid: releaseGroupId }
  }

  const fromDeezer = pickDeezerAlbum(
    await deezerSearch<DeezerAlbum>('album', `${artist} ${bareAlbum(album)}`),
    artist,
    album
  )
  if (fromDeezer) {
    const path = await downloadImage(fromDeezer, dir, fileName, covers)
    if (path) return { path, source: 'deezer', mbid: releaseGroupId }
  }

  if (!releaseGroupId) {
    let found: string | null
    try {
      found = await musicbrainzReleaseGroup(artist, album)
    } catch (err) {
      // MusicBrainz sature souvent (503) : ce dernier recours ne doit pas arrêter toute la file,
      // seulement remettre cet album à plus tard
      if (err instanceof TransientError) return 'retry'
      throw err
    }
    if (found) {
      const path = await downloadImage(coverArtUrl(found), dir, fileName, covers)
      if (path) return { path, source: 'coverartarchive', mbid: found }
    }
  }
  return null
}

/** Photo d'un artiste, depuis Deezer. */
export async function findArtistImage(
  artist: string,
  dir: string,
  fileName: string
): Promise<FoundImage | null> {
  const url = pickDeezerArtist(await deezerSearch<DeezerArtist>('artist', artist), artist)
  if (!url) return null
  const path = await downloadImage(url, dir, fileName, covers)
  return path ? { path, source: 'deezer', mbid: null } : null
}
