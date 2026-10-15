/**
 * Protocole de la télécommande, partagé par les trois process : l'application pousse son état,
 * le téléphone (ou la manette) renvoie des commandes. Les commandes arrivent du réseau : elles
 * sont toujours revalidées par `parseCommand` avant d'être appliquées.
 */

/** Port par défaut du serveur de télécommande. */
export const REMOTE_DEFAULT_PORT = 8723

/** Ce qui joue : le lecteur vidéo plein cadre, la file audio, ou rien. */
export type RemoteSource = 'none' | 'video' | 'audio'

export interface RemoteState {
  source: RemoteSource
  playing: boolean
  title: string | null
  /** Artiste, album ou nom de fichier : la deuxième ligne affichée sur le téléphone */
  subtitle: string | null
  /** Secondes */
  position: number
  /** Secondes ; 0 si inconnue */
  duration: number
  /** Entre 0 et 1 */
  volume: number
  muted: boolean
  /** Titre de la vue affichée dans l'application, pour se repérer à distance */
  view: string
}

export const REMOTE_IDLE: RemoteState = {
  source: 'none',
  playing: false,
  title: null,
  subtitle: null,
  position: 0,
  duration: 0,
  volume: 1,
  muted: false,
  view: ''
}

/** Touches de navigation d'une télécommande classique. */
export type RemoteKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'home'

export const REMOTE_KEYS: readonly RemoteKey[] = [
  'up',
  'down',
  'left',
  'right',
  'ok',
  'back',
  'home'
]

/** Commandes sans paramètre. */
const SIMPLE = ['toggle', 'play', 'pause', 'stop', 'next', 'prev', 'mute'] as const

export type RemoteCommand =
  | { type: (typeof SIMPLE)[number] }
  | { type: 'seek'; position: number }
  | { type: 'seek-by'; delta: number }
  | { type: 'volume'; value: number }
  | { type: 'key'; key: RemoteKey }

/** Un saut relatif reste raisonnable : au-delà, c'est un `seek` absolu qu'il faut envoyer. */
const MAX_SEEK_BY = 600

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * Valide une commande reçue en JSON. Renvoie `null` si elle est inconnue ou mal formée : le
 * serveur répond alors 400 sans rien transmettre au lecteur.
 */
export function parseCommand(raw: unknown): RemoteCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const cmd = raw as Record<string, unknown>
  const type = cmd['type']
  if (typeof type !== 'string') return null
  const simple = SIMPLE.find((s) => s === type)
  if (simple) return { type: simple }

  switch (type) {
    case 'seek': {
      const position = finite(cmd['position'])
      return position === null ? null : { type: 'seek', position: Math.max(0, position) }
    }
    case 'seek-by': {
      const delta = finite(cmd['delta'])
      return delta === null
        ? null
        : { type: 'seek-by', delta: clamp(delta, -MAX_SEEK_BY, MAX_SEEK_BY) }
    }
    case 'volume': {
      const value = finite(cmd['value'])
      return value === null ? null : { type: 'volume', value: clamp(value, 0, 1) }
    }
    case 'key': {
      const key = REMOTE_KEYS.find((k) => k === cmd['key'])
      return key ? { type: 'key', key } : null
    }
    default:
      return null
  }
}

/** Message poussé aux clients connectés en WebSocket. */
export interface RemoteMessage {
  type: 'state'
  state: RemoteState
}

/** État du serveur, tel qu'affiché dans les Paramètres. */
export interface RemoteStatus {
  /** Réglage de l'utilisateur ; faux par défaut */
  enabled: boolean
  port: number
  /** Jeton d'appairage : il fait partie de l'URL à ouvrir sur le téléphone */
  token: string
  /** Le serveur écoute vraiment (faux si le port est déjà pris, voir `error`) */
  running: boolean
  /** Adresses à ouvrir sur le téléphone, une par interface réseau */
  urls: string[]
  /** Télécommandes connectées en WebSocket */
  clients: number
  error: string | null
}
