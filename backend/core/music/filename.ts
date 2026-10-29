/**
 * Artiste et titre d'un morceau sans tags, d'après son nom de fichier. Un mp3 téléchargé depuis
 * YouTube n'a souvent aucun tag (seulement `encoder: Lavf`) mais s'appelle presque toujours
 * « Artiste - Titre (Clip officiel).mp3 ». Pure, testée.
 */

/** Mentions ajoutées par les plateformes, qui ne font pas partie du titre. */
const NOISE =
  /\s*[([](?:[^)\]]*\b(?:official|officiel|officielle|clip|video|vidéo|audio|lyrics?|paroles|visuali[sz]er|hd|hq|4k|explicit)\b[^)\]]*)[)\]]/gi

/** « 01 - », « 01. », « 1) » en tête : un numéro de piste, pas un artiste. */
const TRACK_NUMBER = /^\d{1,3}\s*(?:[-.)_]\s*)/

/** Le séparateur doit être entouré d'espaces : « Jay-Z », « AC-DC » ne sont pas coupés. */
const SEPARATOR = /\s+[-–—]\s+/

export interface FileGuess {
  artist: string
  title: string
}

const clean = (value: string): string => value.replace(NOISE, '').replace(/\s+/g, ' ').trim()

export function guessFromFileName(fileName: string): FileGuess | null {
  const base = fileName.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' ')
  const parts = clean(base).replace(TRACK_NUMBER, '').split(SEPARATOR)
  if (parts.length < 2) return null
  const artist = parts[0].trim()
  const title = parts.slice(1).join(' - ').trim()
  if (!artist || !title || /^\d+$/.test(artist)) return null
  return { artist, title }
}

/**
 * « INO CASABLANCA - BUENA ONDA », avec l'artiste en tag : le titre répète l'artiste, on l'en
 * retire. Un titre qui ne commence pas par l'artiste est laissé tel quel.
 */
export function stripArtistPrefix(title: string, artist: string): string {
  const guess = guessFromFileName(`${title}.mp3`)
  if (!guess) return clean(title) || title
  const norm = (s: string): string => s.normalize('NFC').toLowerCase()
  return norm(guess.artist).startsWith(norm(artist).split(',')[0].trim()) ? guess.title : title
}
