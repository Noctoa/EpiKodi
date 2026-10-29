import type { LiveVariant } from '@shared/ipc'

/**
 * Le direct dans le lecteur : logique pure (aucun DOM, aucun React), testée unitairement.
 * Le lecteur s'en sert pour se reconnecter seul et décrire ce qu'il reçoit.
 */

/**
 * Tentatives de reconnexion avant d'abandonner. Avec les délais ci-dessous, la dernière part
 * environ 45 s après la coupure : de quoi traverser une box qui redémarre ou un Wi-Fi qui saute.
 */
export const MAX_RECONNECTS = 6

/** Une image figée plus longtemps que ça, lecture en cours, est un flux qui ne viendra plus. */
export const STALL_MS = 12_000

/**
 * Délai avant la n-ième tentative (0 pour la première) : 1, 2, 4, 8 s, puis 15 s. Croissant pour
 * ne pas marteler un serveur tombé, borné pour que le retour du réseau ne passe pas inaperçu
 * trop longtemps.
 */
export function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 15_000)
}

/** « 1080p · 4.2 Mb/s » : ce que le direct envoie vraiment, pas ce que la playlist annonce. */
export function liveStats(height: number, kbps: number): string | null {
  const parts = [
    height > 0 ? `${height}p` : null,
    kbps > 0 ? `${(kbps / 1000).toFixed(1)} Mb/s` : null
  ]
  return parts.filter(Boolean).join(' · ') || null
}

/** « 720p · 2.1 Mb/s », ou le débit seul quand la playlist ne donne pas la résolution. */
export function variantLabel(v: LiveVariant): string {
  const parts = [
    v.height ? `${v.height}p` : null,
    v.bandwidth ? `${(v.bandwidth / 1_000_000).toFixed(1)} Mb/s` : null
  ]
  return parts.filter(Boolean).join(' · ') || `Variante ${v.index + 1}`
}

/** La meilleure qualité en tête, comme dans tout menu de lecteur. */
export function sortVariants(variants: LiveVariant[]): LiveVariant[] {
  return [...variants].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
  )
}
