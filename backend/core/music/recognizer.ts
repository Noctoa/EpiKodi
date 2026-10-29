import { basename } from 'node:path'
import { media, music, type Database } from '../db'
import { normalizeTitle } from '../metadata/score'
import { fingerprint, lookup } from './acoustid'
import { bareAlbum, findAlbumCover, findArtistImage, findTrackAlbum } from './artwork'
import { guessFromFileName, stripArtistPrefix } from './filename'
import { artworkFileName, KeyRejectedError, TransientError } from './http'

/**
 * Reconnaissance et habillage de la musique, morceau par morceau, en tâche de fond :
 *
 * 1. Un morceau sans artiste ou sans album dans ses tags est reconnu à son empreinte sonore
 *    (AcoustID) ; les tags manquants sont complétés, jamais ceux que l'utilisateur a écrits.
 * 2. À défaut, l'artiste et le titre sont lus dans le nom du fichier (« Artiste - Titre.mp3 »).
 * 3. Un morceau dont on connaît l'artiste et le titre, mais pas l'album, le retrouve sur Deezer.
 * 4. Son album reçoit une pochette et son artiste une photo, cherchées une fois pour toutes
 *    les pistes qui les partagent.
 *
 * Le tri par artiste puis par album se fait ensuite tout seul : la vue Musique regroupe déjà
 * les pistes selon ces tags.
 */

export interface MusicContext {
  /** Dossier où sont mises en cache pochettes et photos */
  artDir: string
  /** Clé AcoustID ; sans elle, pas de reconnaissance, mais les pochettes restent cherchées */
  acoustidKey: () => string | null
  /** fpcalc est installé */
  canFingerprint: () => Promise<boolean>
  /** Recherche de pochettes et photos en ligne autorisée */
  online: () => boolean
  /** Localisateur en base → chemin ou URL lisible par fpcalc (fichiers SMB) */
  resolveUrl: (locator: string) => Promise<string>
}

/** « Jul feat. Valouzz » → « Jul » : la photo est celle de l'artiste principal. */
export const primaryArtist = (name: string): string =>
  name.split(/\s+(?:feat\.?|ft\.?|featuring|x)\s+/i)[0].trim() || name

/** Ces « artistes » n'ont pas de photo : ce sont des compilations. */
const VARIOUS = /^(various( artists)?|artistes? divers|va|compilation)$/i

export const albumKey = (artist: string, album: string): string =>
  `${normalizeTitle(primaryArtist(artist))}|${normalizeTitle(bareAlbum(album))}`
export const artistKey = (artist: string): string => normalizeTitle(primaryArtist(artist))

async function albumCover(
  db: Database,
  ctx: MusicContext,
  artist: string,
  album: string,
  releaseGroupId: string | null
): Promise<string | null> {
  const key = albumKey(artist, album)
  const cached = music.artwork(db, 'album', key)
  if (cached) return cached.imagePath
  const found = await findAlbumCover(
    primaryArtist(artist),
    album,
    releaseGroupId,
    ctx.artDir,
    artworkFileName('album', key)
  )
  if (!found) console.log(`[music] pas de pochette pour « ${artist} — ${album} »`)
  if (found === 'retry') {
    music.saveArtwork(db, {
      kind: 'album',
      key,
      name: `${artist} — ${album}`,
      imagePath: null,
      source: null,
      mbid: releaseGroupId,
      retrySoon: true
    })
    return null
  }
  music.saveArtwork(db, {
    kind: 'album',
    key,
    name: `${artist} — ${album}`,
    imagePath: found?.path ?? null,
    source: found?.source ?? null,
    mbid: found?.mbid ?? releaseGroupId
  })
  return found?.path ?? null
}

async function artistImage(
  db: Database,
  ctx: MusicContext,
  artist: string
): Promise<string | null> {
  if (VARIOUS.test(artist.trim())) return null
  const key = artistKey(artist)
  if (!key) return null
  const cached = music.artwork(db, 'artist', key)
  if (cached) return cached.imagePath
  const name = primaryArtist(artist)
  const found = await findArtistImage(name, ctx.artDir, artworkFileName('artist', key))
  if (!found) console.log(`[music] pas de photo pour « ${name} »`)
  music.saveArtwork(db, {
    kind: 'artist',
    key,
    name,
    imagePath: found?.path ?? null,
    source: found?.source ?? null,
    mbid: null
  })
  return found?.path ?? null
}

export interface TrackOutcome {
  /** Reconnu par son empreinte */
  recognized: boolean
  /** Artiste et titre lus dans le nom du fichier */
  fromFileName?: boolean
  /** Album retrouvé d'après l'artiste et le titre */
  albumFound?: boolean
  poster: boolean
  backdrop: boolean
}

/**
 * Traite un morceau. Une panne réseau remonte (`TransientError`) sans marquer le morceau : il
 * sera repris au prochain passage. Tout le reste le marque comme traité.
 */
export async function processTrack(
  db: Database,
  id: number,
  ctx: MusicContext,
  { recognize = true } = {}
): Promise<TrackOutcome> {
  const outcome: TrackOutcome = { recognized: false, poster: false, backdrop: false }
  const item = media.get(db, id)
  if (!item || item.type !== 'audio') return outcome
  const meta = media.getMetadata(db, id)
  let releaseGroupId: string | null = null

  // 1. L'empreinte, pour un morceau sans artiste ou sans album
  const key = ctx.acoustidKey()
  if (recognize && (!meta?.artist || !meta?.album) && key && (await ctx.canFingerprint())) {
    const found = await lookup(key, await fingerprint(await ctx.resolveUrl(item.path)))
    console.log(
      found
        ? `[music] « ${item.title} » reconnu : ${found.artist} — ${found.title}` +
            ` (${found.album ?? 'sans album'}, score ${found.score.toFixed(2)})`
        : `[music] « ${item.title} » : inconnu d'AcoustID`
    )
    if (found) {
      outcome.recognized = true
      media.setMetadata(db, id, {
        artist: meta?.artist ?? found.artist,
        album: meta?.album ?? found.album,
        albumArtist: meta?.albumArtist ?? (meta?.album ? null : found.albumArtist),
        year: meta?.year ?? found.year,
        track: meta?.track ?? found.track,
        externalId: `musicbrainz:recording:${found.recordingId}`
      })
      // Sans artiste, le titre est presque toujours le nom du fichier : le vrai le remplace
      if (!meta?.artist) media.markProbed(db, id, { title: found.title })
      // L'identifiant d'album ne vaut que si c'est bien l'album retenu
      if (!meta?.album) releaseGroupId = found.releaseGroupId
    }
  }

  // 2. Le nom du fichier : « Artiste - Titre.mp3 », la forme des téléchargements YouTube
  let current = media.getMetadata(db, id)
  let title = media.get(db, id)!.title
  if (!current?.artist) {
    const guess = guessFromFileName(basename(item.path))
    if (guess) {
      media.setMetadata(db, id, { artist: guess.artist })
      media.markProbed(db, id, { title: guess.title })
      title = guess.title
      outcome.fromFileName = true
    }
  } else if (!outcome.recognized) {
    // « INO CASABLANCA - BUENA ONDA » tagué Ino Casablanca : l'artiste n'a rien à faire au titre
    const stripped = stripArtistPrefix(title, current.artist)
    if (stripped !== title) {
      media.markProbed(db, id, { title: stripped })
      title = stripped
    }
  }

  // 3. L'album d'après l'artiste et le titre, quand ni les tags ni l'empreinte ne l'ont donné
  current = media.getMetadata(db, id)
  if (ctx.online() && current?.artist && !current.album) {
    const found = await findTrackAlbum(current.artist, title)
    if (found) {
      media.setMetadata(db, id, {
        album: found.album,
        albumArtist: current.albumArtist ?? found.albumArtist,
        ...(!current.externalId && { externalId: `deezer:track:${found.trackId}` })
      })
      outcome.albumFound = true
    }
    console.log(
      found
        ? `[music] « ${current.artist} — ${title} » : album ${found.album}`
        : `[music] « ${current.artist} — ${title} » : album introuvable`
    )
  }

  current = media.getMetadata(db, id)
  const artist = current?.albumArtist || current?.artist || null
  const album = current?.album || null

  if (ctx.online()) {
    const poster = artist && album ? await albumCover(db, ctx, artist, album, releaseGroupId) : null
    const backdrop = artist ? await artistImage(db, ctx, artist) : null
    media.setMetadata(db, id, {
      ...(poster && { posterPath: poster }),
      ...(backdrop && { backdropPath: backdrop })
    })
    outcome.poster = poster !== null
    outcome.backdrop = backdrop !== null
  }

  media.markIdentified(db, id)
  return outcome
}

export interface RecognizerOptions extends MusicContext {
  onDone?: (mediaId: number) => void
  onIdle?: () => void
}

/**
 * File de traitement de la musique. Un morceau à la fois : les services limitent la cadence de
 * toute façon, et les pistes d'un même album profitent ainsi de la pochette déjà trouvée.
 */
export class MusicRecognizer {
  private queue: number[] = []
  private queued = new Set<number>()
  private running = false
  /** Dernière erreur notable, montrée dans les Paramètres */
  lastError: string | null = null
  private keyRejected = false

  constructor(
    private db: Database,
    private opts: RecognizerOptions
  ) {}

  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0)
  }

  enqueuePending(): void {
    for (const id of music.pendingTracks(this.db)) {
      if (!this.queued.has(id)) {
        this.queued.add(id)
        this.queue.push(id)
      }
    }
    void this.pump()
  }

  /** La clé a changé : on lui laisse sa chance. */
  keyChanged(): void {
    this.keyRejected = false
    this.lastError = null
  }

  stop(): void {
    this.queue = []
    this.queued.clear()
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    let done = 0
    while (this.queue.length > 0) {
      const id = this.queue.shift()!
      try {
        await this.process(id)
        done++
      } catch (err) {
        const message = (err as Error).message
        if (err instanceof TransientError) {
          // Hors ligne ou service saturé : on s'arrête là, rien n'est marqué, tout sera repris
          console.warn(`[music] interrompu : ${message}`)
          this.lastError = message
          this.stop()
          break
        }
        console.warn(`[music] morceau ${id} : ${message}`)
        media.markIdentified(this.db, id)
      } finally {
        this.queued.delete(id)
      }
      this.opts.onDone?.(id)
    }
    this.running = false
    if (done > 0) console.log(`[music] ${done} morceau(x) traité(s)`)
    this.opts.onIdle?.()
  }

  private async process(id: number): Promise<void> {
    try {
      await processTrack(this.db, id, this.opts, { recognize: !this.keyRejected })
    } catch (err) {
      if (!(err instanceof KeyRejectedError)) throw err
      // Les morceaux suivants ne seront plus reconnus, mais recevront quand même leurs pochettes
      console.warn(`[music] ${err.message} : reconnaissance suspendue`)
      this.keyRejected = true
      this.lastError = err.message
      await processTrack(this.db, id, this.opts, { recognize: false })
    }
  }
}
