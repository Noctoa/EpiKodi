import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import { parseCommand, type RemoteCommand, type RemoteState } from '@shared/remote'
import { REMOTE_DENIED, REMOTE_PAGE } from './page'
import { handshakeResponse, WebSocketConnection } from './websocket'

/**
 * Serveur de télécommande : sert la page mobile, expose l'état du lecteur et reçoit les commandes.
 * Il tourne dans le process principal, qui est le seul à pouvoir parler à la fois au réseau et à
 * la fenêtre. Désactivé par défaut, et protégé par un jeton exigé sur chaque requête.
 */

/** Corps d'une commande : quelques dizaines d'octets suffisent, on refuse au-delà. */
const MAX_BODY = 4096

export interface RemoteServerOptions {
  port: number
  token: string
  /** Commande validée, à appliquer au lecteur */
  onCommand(command: RemoteCommand): void
  /** État courant, envoyé à un client qui vient de se connecter */
  state(): RemoteState
  /** Nombre de télécommandes connectées, pour l'affichage dans les Paramètres */
  onClientsChanged?(count: number): void
}

export class RemoteServer {
  private readonly server: Server
  private readonly clients = new Set<WebSocketConnection>()
  private listening = false

  constructor(private readonly options: RemoteServerOptions) {
    this.server = createServer((req, res) => this.route(req, res))
    this.server.on('upgrade', (req, socket) => this.upgrade(req, socket as Duplex))
    // Un téléphone qui s'endort laisse des sockets ouvertes : elles ne doivent pas s'accumuler
    this.server.keepAliveTimeout = 10_000
  }

  /** Écoute sur toutes les interfaces : le téléphone est sur le même Wi-Fi, pas sur la machine. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const fail = (err: Error): void => reject(err)
      this.server.once('error', fail)
      this.server.listen(this.options.port, '0.0.0.0', () => {
        this.server.removeListener('error', fail)
        this.listening = true
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    for (const client of [...this.clients]) client.close()
    this.clients.clear()
    if (!this.listening) return
    this.listening = false
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  /** Port réellement attribué : le port 0 laisse le système en choisir un (tests). */
  get boundPort(): number {
    const info = this.server.address()
    return info && typeof info === 'object' ? info.port : 0
  }

  get clientCount(): number {
    return this.clients.size
  }

  /** Pousse le nouvel état à toutes les télécommandes connectées. */
  broadcast(state: RemoteState): void {
    if (this.clients.size === 0) return
    const message = JSON.stringify({ type: 'state', state })
    for (const client of this.clients) client.send(message)
  }

  private authorized(req: IncomingMessage): boolean {
    return sameToken(tokenOf(req), this.options.token)
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0]
    res.setHeader('Cache-Control', 'no-store')

    if (!this.authorized(req)) {
      if (path === '/') return send(res, 401, 'text/html; charset=utf-8', REMOTE_DENIED)
      return sendJson(res, 401, { error: 'jeton invalide' })
    }

    if (req.method === 'GET' && path === '/') {
      return send(res, 200, 'text/html; charset=utf-8', REMOTE_PAGE)
    }
    if (req.method === 'GET' && path === '/api/state') {
      return sendJson(res, 200, this.options.state())
    }
    if (req.method === 'POST' && path === '/api/command') {
      return this.readCommand(req, res)
    }
    sendJson(res, 404, { error: 'route inconnue' })
  }

  private readCommand(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        sendJson(res, 413, { error: 'corps trop grand' })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      const command = parseJsonCommand(Buffer.concat(chunks).toString('utf8'))
      if (!command) return sendJson(res, 400, { error: 'commande inconnue' })
      this.options.onCommand(command)
      sendJson(res, 200, this.options.state())
    })
  }

  private upgrade(req: IncomingMessage, socket: Duplex): void {
    const key = req.headers['sec-websocket-key']
    const path = (req.url ?? '/').split('?')[0]
    if (path !== '/ws' || typeof key !== 'string' || !this.authorized(req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }

    socket.write(handshakeResponse(key))
    const client: WebSocketConnection = new WebSocketConnection(socket, {
      onMessage: (text) => {
        const command = parseJsonCommand(text)
        if (command) this.options.onCommand(command)
      },
      onClose: () => {
        this.clients.delete(client)
        this.options.onClientsChanged?.(this.clients.size)
      }
    })
    this.clients.add(client)
    this.options.onClientsChanged?.(this.clients.size)
    // La télécommande doit s'afficher à jour sans attendre le prochain changement d'état
    client.send(JSON.stringify({ type: 'state', state: this.options.state() }))
  }
}

function parseJsonCommand(text: string): RemoteCommand | null {
  try {
    return parseCommand(JSON.parse(text))
  } catch {
    return null
  }
}

/** Jeton de la requête : paramètre `t` (celui de l'URL donnée au téléphone) ou en-tête Bearer. */
export function tokenOf(req: Pick<IncomingMessage, 'url' | 'headers'>): string {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const query = url.searchParams.get('t') ?? url.searchParams.get('token')
  if (query) return query
  const header = req.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}

/** Comparaison à temps constant : un jeton ne doit pas se deviner à la milliseconde près. */
export function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Adresses à saisir sur le téléphone. On ignore `localhost` (inutile depuis un autre appareil) et
 * l'IPv6, dont la saisie à la main est inhumaine.
 */
export function remoteUrls(port: number, token: string): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${port}/?t=${token}`)
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body))
}
