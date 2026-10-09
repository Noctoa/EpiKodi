/**
 * Import et export de playlists au format M3U étendu — le format d'échange que lisent VLC,
 * Kodi et la plupart des lecteurs. Pure et testé : aucun accès disque ici.
 */

export interface M3uEntry {
  /** Chemin ou URL du média, tel qu'écrit dans le fichier */
  path: string
  /** Secondes ; -1 quand la durée est inconnue, par convention du format */
  duration: number | null
  title: string | null
}

const HEADER = '#EXTM3U'

const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim()

export function serializeM3u(entries: M3uEntry[]): string {
  const lines = [HEADER]
  for (const entry of entries) {
    const duration = entry.duration === null ? -1 : Math.round(entry.duration)
    if (entry.title) lines.push(`#EXTINF:${duration},${oneLine(entry.title)}`)
    lines.push(entry.path)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Analyse un fichier M3U. Tolérant : les commentaires inconnus sont ignorés, une ligne
 * `#EXTINF` sans média qui suive est abandonnée, et l'absence d'en-tête n'est pas fatale
 * (beaucoup de fichiers M3U simples n'en ont pas).
 */
export function parseM3u(content: string): M3uEntry[] {
  const entries: M3uEntry[] = []
  let pending: { duration: number | null; title: string | null } | null = null

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#')) {
      const extinf = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)\s*(?:,(.*))?$/i.exec(line)
      if (extinf) {
        const seconds = Number(extinf[1])
        pending = {
          duration: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
          title: extinf[2]?.trim() || null
        }
      }
      continue // tout autre commentaire est ignoré
    }

    entries.push({ path: line, duration: pending?.duration ?? null, title: pending?.title ?? null })
    pending = null
  }
  return entries
}

/** Nom de fichier sûr pour l'export : « Ma playlist ! » → « Ma playlist.m3u ». */
export function playlistFileName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base || 'playlist'}.m3u`
}

/**
 * Fait correspondre les lignes d'un fichier M3U aux médias de la bibliothèque, par chemin.
 * Importer une playlist n'indexe rien : une entrée dont le fichier est absent est comptée
 * comme introuvable, pas ajoutée.
 */
export function matchEntries(
  entries: M3uEntry[],
  byPath: Map<string, number>
): { mediaIds: number[]; missing: string[] } {
  const mediaIds: number[] = []
  const missing: string[] = []
  const vus = new Set<number>()

  for (const entry of entries) {
    const id = byPath.get(entry.path)
    if (id === undefined) {
      missing.push(entry.path)
      continue
    }
    // Un même média listé deux fois n'est ajouté qu'une seule fois
    if (vus.has(id)) continue
    vus.add(id)
    mediaIds.push(id)
  }
  return { mediaIds, missing }
}
