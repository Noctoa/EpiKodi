/**
 * Devine ce qu'un fichier contient à partir de son nom. Les fichiers réels sont bruités :
 * « Inception.2010.1080p.BluRay.x264-GROUPE.mkv », « The.Office.S03E12.FRENCH.HDTV.avi ».
 * Tout est pur et testé ; aucun appel réseau ici.
 */

export type GuessKind = 'movie' | 'tv'

export interface Guess {
  kind: GuessKind
  /** Titre nettoyé, prêt pour une recherche */
  title: string
  year: number | null
  season: number | null
  episode: number | null
}

/** Marqueurs de qualité, de source, de codec et de langue à retirer du titre. */
const NOISE = [
  // résolution et format
  '\\d{3,4}[pi]',
  '[24]k',
  'uhd',
  'hdr10?',
  'dolby ?vision',
  'dv',
  'sdr',
  '10bits?',
  '8bits?',
  // source
  'blu-?ray',
  'bd-?rip',
  'brrip',
  'web-?dl',
  'web-?rip',
  'webrip',
  'hd-?tv',
  'hdtv',
  'dvd-?rip',
  'dvdscr',
  'bdremux',
  'remux',
  'cam',
  'ts',
  'r5',
  'hdlight',
  'hqcam',
  // codecs
  'x ?26[45]',
  'h ?26[45]',
  'hevc',
  'avc',
  'xvid',
  'divx',
  'aac\\d?',
  'ac-?3',
  'eac-?3',
  'dts(-hd)?',
  'truehd',
  'mp3',
  'flac',
  'opus',
  'atmos',
  '\\d\\.\\d(ch)?',
  '(2|5|7)\\.(0|1)',
  // langue et sous-titres
  'multi',
  'vf[fqi]?',
  'vo(st(fr)?)?',
  'vostfr',
  'french',
  'truefrench',
  'english',
  'eng',
  'subfrench',
  'dubbed',
  'subbed',
  'fansub',
  'vf2',
  'japanese',
  'korean',
  'italian',
  'spanish',
  'german',
  'chinese',
  'russian',
  'portuguese',
  'latino',
  'ita',
  'jap',
  // divers
  'extended',
  'unrated',
  'directors? cut',
  'remastered',
  'integrale',
  'complete',
  'repack',
  'proper',
  'internal',
  'limited',
  'imax'
]

const NOISE_RE = new RegExp(`\\b(?:${NOISE.join('|')})\\b`, 'gi')

/** `S03E12`, `3x12`, `S03.E12`, `saison 3 episode 12` */
const SEASON_EPISODE = [
  /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i,
  /\b(\d{1,2})x(\d{1,3})\b/i,
  /\bsaison[\s._-]*(\d{1,2})[\s._-]*(?:episode|ep)[\s._-]*(\d{1,3})\b/i,
  /\bseason[\s._-]*(\d{1,2})[\s._-]*(?:episode|ep)[\s._-]*(\d{1,3})\b/i
]

/** Année plausible pour un film : du cinéma muet à l'an prochain. */
function plausibleYear(value: string): number | null {
  const year = Number(value)
  return year >= 1888 && year <= new Date().getFullYear() + 1 ? year : null
}

/** Sépare les mots quel que soit le séparateur employé (points, tirets, underscores). */
function normalizeSeparators(input: string): string {
  return input
    .replace(/[._]+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function cleanTitle(raw: string): string {
  return normalizeSeparators(raw)
    .replace(/\s*-\s*$/, '')
    .replace(/^[\s\-–—]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Analyse un nom de fichier (sans son extension de préférence) et, si fourni, le nom du dossier
 * parent — souvent plus propre que le fichier lui-même (« Inception (2010)/film.mkv »).
 */
export function guessFromFilename(filename: string, parentDir?: string): Guess {
  const base = filename.replace(/\.[a-z0-9]{2,4}$/i, '')

  // 1. Les crochets contiennent presque toujours un groupe de release ou une qualité
  let work = base
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\b(?:1080p|720p|web|blu)\b[^)]*\)/gi, ' ')

  // 2. Série ? La première correspondance saison/épisode gagne et coupe le titre
  for (const pattern of SEASON_EPISODE) {
    const match = pattern.exec(work)
    if (!match) continue
    // « Une.Serie.2019.S02E10 » : l'année appartient à la série, pas à son titre
    const head = stripNoise(work.slice(0, match.index))
    const title = cleanTitle(head.replace(/\s*\(?\b(1[89]\d{2}|20\d{2})\b\)?\s*$/, ''))
    return {
      kind: 'tv',
      title: title || cleanTitle(stripNoise(parentDir ?? '')) || base,
      year: findYear(work),
      season: Number(match[1]),
      episode: Number(match[2])
    }
  }

  // 3. Film : l'année marque la fin du titre. On ne s'arrête pas au premier groupe de quatre
  // chiffres, qui peut appartenir au titre lui-même (« Blade Runner 2049 »), mais à la première
  // valeur qui soit une année plausible.
  let year: number | null = null
  for (const match of work.matchAll(/[([\s._-](\d{4})(?=[)\]\s._-]|$)/g)) {
    const candidate = plausibleYear(match[1])
    if (candidate === null) continue
    year = candidate
    work = work.slice(0, match.index)
    break
  }

  let title = cleanTitle(stripNoise(work))
  let finalYear = year

  // 4. Le dossier parent est souvent mieux nommé que le fichier (« Inception (2010)/film.mkv ») :
  // on le préfère quand il porte une année absente du fichier, ou quand le titre tiré du nom de
  // fichier est inexploitable.
  const parentYear = parentDir ? findYear(parentDir) : null
  const uninformative = title.length < 2 || /^\d+$/.test(title)
  if (parentDir && (uninformative || (parentYear !== null && year === null))) {
    const parentTitle = cleanTitle(stripNoise(parentDir.replace(/[([]?\b\d{4}\b[)\]]?/, ' ')))
    if (parentTitle.length >= 2) {
      title = parentTitle
      finalYear = parentYear
    }
  }

  return { kind: 'movie', title: title || base, year: finalYear, season: null, episode: null }
}

function stripNoise(input: string): string {
  return (
    normalizeSeparators(input)
      .replace(NOISE_RE, ' ')
      // un groupe de release colle souvent au dernier tiret : « ... - GROUPE »
      .replace(/\s-\s[A-Za-z0-9]+$/, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
}

function findYear(input: string): number | null {
  for (const match of input.matchAll(/(?<![\d])(\d{4})(?![\d])/g)) {
    const year = plausibleYear(match[1])
    if (year) return year
  }
  return null
}

/** Clé de recherche lisible : « Inception (2010) », « The Office S03E12 ». */
export function describeGuess(guess: Guess): string {
  if (guess.kind === 'tv') {
    const code =
      guess.season !== null && guess.episode !== null
        ? ` S${String(guess.season).padStart(2, '0')}E${String(guess.episode).padStart(2, '0')}`
        : ''
    return `${guess.title}${code}`
  }
  return guess.year ? `${guess.title} (${guess.year})` : guess.title
}
