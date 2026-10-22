/**
 * Messages échangés entre l'application et le process qui héberge un plugin. Les deux côtés
 * importent ce fichier : le protocole est typé une seule fois, pour les deux.
 */
import type { PluginManifest } from './manifest'

/** Résultat d'une recherche renvoyé par un plugin fournisseur de métadonnées. */
export interface PluginMatch {
  externalId: string
  kind: 'movie' | 'tv'
  title: string
  originalTitle?: string | null
  year?: number | null
  overview?: string | null
  rating?: number | null
  posterUrl?: string | null
  backdropUrl?: string | null
  genres?: string[]
  cast?: string[]
  runtime?: number | null
}

/**
 * Un élément listé par une entrée de menu : une jaquette de jeu, un flux, une station… Le
 * plugin décide de ce qu'il met dedans, l'application l'affiche dans sa grille habituelle.
 */
export interface PluginItem {
  id: string
  title: string
  subtitle?: string | null
  /** Image en `data:` — un plugin n'a pas de dossier servi par l'application */
  thumbnail?: string | null
  /** Caractère affiché faute de vignette */
  icon?: string | null
  /** Pastille en coin de vignette : durée, format, année… */
  badge?: string | null
}

/** Application → plugin. */
export type ToPlugin =
  | { type: 'activate'; manifest: PluginManifest; dir: string }
  | { type: 'deactivate' }
  /** Événement de cycle de vie : « media:scanned », « media:played »… */
  | { type: 'event'; name: string; payload: unknown }
  /** Appel d'une fonction fournie par le plugin, avec réponse attendue */
  | { type: 'call'; callId: number; method: PluginMethod; args: unknown[] }

/** Plugin → application. */
export type FromPlugin =
  | { type: 'ready'; provides: { metadataProvider: boolean; menu: MenuItem[] } }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'failed'; message: string }
  | { type: 'result'; callId: number; value: unknown }
  | { type: 'call-error'; callId: number; message: string }

/**
 * Fonctions qu'un plugin peut exposer. `items` liste le contenu d'une entrée de menu,
 * `activate` déclenche ce que le plugin fait d'un élément (lancer un émulateur, ouvrir un flux).
 */
export type PluginMethod = 'search' | 'details' | 'items' | 'activate'

export interface MenuItem {
  id: string
  label: string
  icon?: string
}
