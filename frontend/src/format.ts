/** Formatage partagé par les vues. */

export function fmtDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** Durée longue pour la vue détail : « 1 h 42 min », « 3 min 20 s ». */
export function fmtDurationLong(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  return `${m} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`
}

export const fmtSize = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} Go` : `${Math.round(bytes / 1e6)} Mo`

/** « 1080p », « 4K »… à partir de la hauteur */
export const fmtResolution = (h: number | null): string | null =>
  h === null ? null : h >= 2160 ? '4K' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : `${h}p`

export const fmtBitrate = (b: number | null): string | null =>
  b === null ? null : `${Math.round(b / 1000)} kb/s`
