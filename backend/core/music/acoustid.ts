import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { USER_AGENT } from '../net'
import { KeyRejectedError, Throttle, TransientError } from './http'

const exec = promisify(execFile)

/**
 * Reconnaissance d'un morceau à son empreinte sonore, à la manière de Shazam mais avec des
 * outils ouverts : Chromaprint (`fpcalc`) calcule l'empreinte en local, AcoustID la retrouve et
 * renvoie l'enregistrement MusicBrainz correspondant — titre, artiste, album.
 */

/** Chemin de `fpcalc` (paquet chromaprint) ; surchargeable comme ceux de ffmpeg. */
export const fpcalc = { bin: 'fpcalc' }

/** Les deux premières minutes suffisent à AcoustID ; au-delà, le calcul est plus long pour rien. */
const FINGERPRINT_SECONDS = 120
/** Sous ce score, AcoustID hésite : mieux vaut un fichier sans tags qu'un fichier mal tagué. */
export const MIN_SCORE = 0.8
const API = 'https://api.acoustid.org/v2/lookup'
const throttle = new Throttle(350)

export async function fpcalcAvailable(): Promise<boolean> {
  try {
    await exec(fpcalc.bin, ['-version'])
    return true
  } catch {
    return false
  }
}

export interface Fingerprint {
  duration: number
  fingerprint: string
}

/** Empreinte d'un fichier local ou d'une URL (fpcalc lit ce que lit ffmpeg). */
export async function fingerprint(input: string): Promise<Fingerprint> {
  const { stdout } = await exec(
    fpcalc.bin,
    ['-json', '-length', String(FINGERPRINT_SECONDS), input],
    {
      maxBuffer: 1024 * 1024,
      timeout: 60_000
    }
  )
  const parsed = JSON.parse(stdout) as Partial<Fingerprint>
  if (!parsed.fingerprint || !parsed.duration) throw new Error('empreinte vide')
  return { duration: parsed.duration, fingerprint: parsed.fingerprint }
}

// ---- réponse d'AcoustID (meta=recordings releasegroups releases tracks) ----

interface Artist {
  name: string
  joinphrase?: string
}

interface Release {
  date?: { year?: number }
  mediums?: { position?: number; tracks?: { position?: number }[] }[]
}

interface ReleaseGroup {
  id: string
  title?: string
  type?: string
  secondarytypes?: string[]
  artists?: Artist[]
  releases?: Release[]
}

interface Recording {
  id: string
  title?: string
  artists?: Artist[]
  releasegroups?: ReleaseGroup[]
}

export interface LookupResponse {
  status: string
  error?: { code?: number; message?: string }
  results?: { score: number; recordings?: Recording[] }[]
}

/** Ce que la reconnaissance apprend d'un morceau ; chaque champ peut manquer. */
export interface Recognition {
  recordingId: string
  score: number
  title: string
  artist: string
  album: string | null
  albumArtist: string | null
  releaseGroupId: string | null
  year: number | null
  track: number | null
}

/** « Jul », « feat. », « Valouzz » → « Jul feat. Valouzz » : MusicBrainz découpe les crédits. */
export const credit = (artists: Artist[] | undefined): string =>
  (artists ?? [])
    .map((a, i, list) => a.name + (i < list.length - 1 ? (a.joinphrase ?? ', ') : ''))
    .join('')
    .trim()

/**
 * Un même enregistrement figure sur l'album, le single, trois compilations et un live. On veut
 * l'album studio : un album « pur » d'abord, puis un album à type secondaire (bande originale,
 * compilation), puis un EP, puis un single.
 */
function rank(group: ReleaseGroup): number {
  const secondary = group.secondarytypes?.length ?? 0
  switch (group.type) {
    case 'Album':
      return secondary === 0 ? 0 : group.secondarytypes!.includes('Compilation') ? 2 : 1
    case 'EP':
      return 3
    case 'Single':
      return 4
    default:
      return 5
  }
}

const firstYear = (group: ReleaseGroup): number | null => {
  const years = (group.releases ?? [])
    .map((r) => r.date?.year)
    .filter((y): y is number => typeof y === 'number' && y > 1800)
  return years.length > 0 ? Math.min(...years) : null
}

/** Position du morceau dans l'album : AcoustID ne liste dans `tracks` que celui reconnu. */
const trackNumber = (group: ReleaseGroup): number | null => {
  for (const release of group.releases ?? []) {
    for (const medium of release.mediums ?? []) {
      const position = medium.tracks?.[0]?.position
      if (typeof position === 'number') return position
    }
  }
  return null
}

/** Choisit, dans une réponse d'AcoustID, l'enregistrement et l'album à retenir. Pure, testée. */
export function pickRecognition(response: LookupResponse): Recognition | null {
  const results = [...(response.results ?? [])].sort((a, b) => b.score - a.score)
  for (const result of results) {
    if (result.score < MIN_SCORE) return null
    // Plusieurs enregistrements partagent parfois une empreinte (remasters) : le plus documenté
    // — celui qui figure sur le plus d'albums — est le plus sûr.
    const recordings = (result.recordings ?? [])
      .filter((r) => r.title && credit(r.artists))
      .sort((a, b) => (b.releasegroups?.length ?? 0) - (a.releasegroups?.length ?? 0))
    const recording = recordings[0]
    if (!recording) continue

    const group =
      [...(recording.releasegroups ?? [])]
        .filter((g) => g.title)
        .sort((a, b) => rank(a) - rank(b) || (firstYear(a) ?? 9999) - (firstYear(b) ?? 9999))[0] ??
      null
    return {
      recordingId: recording.id,
      score: result.score,
      title: recording.title!,
      artist: credit(recording.artists),
      album: group?.title ?? null,
      albumArtist: group ? credit(group.artists) || null : null,
      releaseGroupId: group?.id ?? null,
      year: group ? firstYear(group) : null,
      track: group ? trackNumber(group) : null
    }
  }
  return null
}

/** Interroge AcoustID. Une clé refusée est une erreur franche ; une panne, une erreur passagère. */
export async function lookup(clientKey: string, print: Fingerprint): Promise<Recognition | null> {
  await throttle.wait()
  // POST : une empreinte de deux minutes dépasse la longueur raisonnable d'une URL
  const body = new URLSearchParams({
    client: clientKey,
    format: 'json',
    meta: 'recordings releasegroups releases tracks compress',
    duration: String(Math.round(print.duration)),
    fingerprint: print.fingerprint
  })
  let response: LookupResponse
  try {
    // Pas fetchWithTimeout : une erreur d'AcoustID arrive en HTTP 400 avec son explication dans
    // le corps, qu'il faut lire pour distinguer une clé refusée d'une empreinte illisible.
    const res = await fetch(API, {
      method: 'POST',
      body,
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000)
    })
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
    response = (await res.json()) as LookupResponse
  } catch (err) {
    throw new TransientError(`AcoustID : ${(err as Error).message}`)
  }
  if (response.status !== 'ok') {
    // Codes documentés : 4 = clé d'application invalide, 3 = empreinte invalide, 14 = trop de requêtes
    const code = response.error?.code
    const message = response.error?.message ?? 'réponse inattendue'
    if (code === 4 || /api key/i.test(message)) throw new KeyRejectedError('clé AcoustID refusée')
    if (code === 14) throw new TransientError(`AcoustID : ${message}`)
    throw new Error(`AcoustID : ${message}`)
  }
  return pickRecognition(response)
}
