/** Navigation entre les vues : état pur, avec pile d'historique pour le bouton « Retour ». */

export type View =
  | { name: 'home' }
  | { name: 'videos' }
  | { name: 'music' }
  | { name: 'artist'; artist: string }
  | { name: 'album'; artist: string; album: string }
  | { name: 'podcasts' }
  | { name: 'sources' }
  | { name: 'settings' }
  | { name: 'detail'; mediaId: number }
  | { name: 'search' }
  | { name: 'podcast'; podcastId: number; title: string }

/** Entrées de la barre latérale, dans l'ordre d'affichage. */
export const SECTIONS = [
  { name: 'home', label: 'Accueil', icon: '⌂' },
  { name: 'videos', label: 'Vidéos', icon: '▶' },
  { name: 'music', label: 'Musique', icon: '♪' },
  { name: 'podcasts', label: 'Podcasts', icon: '◉' },
  { name: 'sources', label: 'Sources', icon: '⌸' },
  { name: 'settings', label: 'Paramètres', icon: '⚙' }
] as const satisfies readonly { name: View['name']; label: string; icon: string }[]

export type SectionName = (typeof SECTIONS)[number]['name']

export interface NavState {
  /** Vue courante en tête ; les suivantes sont l'historique */
  stack: View[]
}

export const initialNav: NavState = { stack: [{ name: 'home' }] }

export const currentView = (n: NavState): View => n.stack[0]

/** Section de la barre latérale à surligner pour la vue courante. */
export function activeSection(view: View): SectionName {
  switch (view.name) {
    case 'artist':
    case 'album':
      return 'music'
    case 'podcast':
      return 'podcasts'
    case 'detail':
    case 'search':
      return 'home'
    default:
      return view.name
  }
}

/** Empile une vue (le retour ramènera à la précédente). */
export function push(n: NavState, view: View): NavState {
  return { stack: [view, ...n.stack] }
}

/** Remplace la vue courante sans grossir l'historique (clic dans la barre latérale). */
export function navigate(_n: NavState, view: View): NavState {
  const root: View = { name: 'home' }
  return view.name === 'home' ? { stack: [root] } : { stack: [view, root] }
}

export function back(n: NavState): NavState {
  return n.stack.length > 1 ? { stack: n.stack.slice(1) } : n
}

export const canGoBack = (n: NavState): boolean => n.stack.length > 1

/** Titre affiché en tête de la zone de contenu. */
export function viewTitle(view: View, mediaTitle?: string): string {
  switch (view.name) {
    case 'home':
      return 'Accueil'
    case 'videos':
      return 'Vidéos'
    case 'music':
      return 'Musique'
    case 'artist':
      return view.artist
    case 'album':
      return view.album
    case 'podcasts':
      return 'Podcasts'
    case 'sources':
      return 'Sources'
    case 'settings':
      return 'Paramètres'
    case 'detail':
      return mediaTitle ?? 'Détail'
    case 'search':
      return 'Recherche'
    case 'podcast':
      return view.title
  }
}
