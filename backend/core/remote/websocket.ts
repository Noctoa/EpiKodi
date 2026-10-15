import { createHash, randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'

/**
 * Serveur WebSocket minimal (RFC 6455), côté texte seulement : de quoi pousser l'état du lecteur
 * à un téléphone et recevoir ses commandes, sans dépendance supplémentaire. Le client est une
 * page que l'on écrit nous-mêmes, donc on n'a besoin ni des extensions (compression), ni des
 * trames binaires, ni de la négociation de sous-protocole.
 */

/** Concaténé à la clé du client pour calculer la réponse du handshake (RFC 6455 §4.2.2). */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa
} as const

/** Au-delà, la trame est refusée : un message de télécommande tient en quelques centaines d'octets. */
export const MAX_PAYLOAD = 64 * 1024

export function acceptKey(clientKey: string): string {
  return createHash('sha1')
    .update(clientKey + GUID)
    .digest('base64')
}

/** Réponse à écrire sur la socket pour accepter la bascule en WebSocket. */
export function handshakeResponse(clientKey: string): string {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(clientKey)}`,
    '',
    ''
  ].join('\r\n')
}

export interface Frame {
  fin: boolean
  opcode: number
  payload: Buffer
}

export interface DecodeResult {
  frames: Frame[]
  /** Trame incomplète à conserver pour le prochain paquet TCP */
  rest: Buffer
  /** Violation du protocole : la connexion doit être fermée */
  error?: string
}

/**
 * Extrait les trames complètes d'un tampon. Les trames du client sont toujours masquées
 * (RFC 6455 §5.1) : une trame en clair est une erreur de protocole, pas un cas à tolérer.
 */
export function decodeFrames(buffer: Buffer, maxPayload = MAX_PAYLOAD): DecodeResult {
  const frames: Frame[] = []
  let off = 0

  while (off + 2 <= buffer.length) {
    const masked = (buffer[off + 1] & 0x80) !== 0
    let length = buffer[off + 1] & 0x7f
    let header = 2

    if (length === 126) {
      if (off + 4 > buffer.length) break
      length = buffer.readUInt16BE(off + 2)
      header = 4
    } else if (length === 127) {
      if (off + 10 > buffer.length) break
      const big = buffer.readBigUInt64BE(off + 2)
      if (big > BigInt(maxPayload)) {
        return { frames, rest: buffer.subarray(off), error: 'trame trop grande' }
      }
      length = Number(big)
      header = 10
    }
    if (length > maxPayload) {
      return { frames, rest: buffer.subarray(off), error: 'trame trop grande' }
    }
    if (!masked) {
      return { frames, rest: buffer.subarray(off), error: 'trame client non masquée' }
    }
    if (off + header + 4 + length > buffer.length) break

    const key = buffer.subarray(off + header, off + header + 4)
    const start = off + header + 4
    const payload = Buffer.allocUnsafe(length)
    for (let i = 0; i < length; i++) payload[i] = buffer[start + i] ^ key[i & 3]

    frames.push({ fin: (buffer[off] & 0x80) !== 0, opcode: buffer[off] & 0x0f, payload })
    off = start + length
  }

  return { frames, rest: buffer.subarray(off) }
}

/** Sérialise une trame. Le serveur n'applique pas de masque ; `mask` sert aux tests et au client. */
export function encodeFrame(opcode: number, payload: Buffer, mask = false): Buffer {
  const length = payload.length
  const extended = length < 126 ? 0 : length < 65536 ? 2 : 8
  const header = Buffer.alloc(2 + extended + (mask ? 4 : 0))

  header[0] = 0x80 | opcode
  if (extended === 0) header[1] = length
  else if (extended === 2) {
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  if (!mask) return Buffer.concat([header, payload])

  header[1] |= 0x80
  const key = randomBytes(4)
  key.copy(header, 2 + extended)
  const body = Buffer.allocUnsafe(length)
  for (let i = 0; i < length; i++) body[i] = payload[i] ^ key[i & 3]
  return Buffer.concat([header, body])
}

export interface ConnectionHandlers {
  onMessage(text: string): void
  onClose(): void
}

/** Un téléphone connecté : messages texte, réponse aux ping, fermeture propre. */
export class WebSocketConnection {
  private buffer: Buffer = Buffer.alloc(0)
  /** Morceaux d'un message fragmenté, en attente de la trame `fin` */
  private fragments: Buffer[] = []
  private keepalive: ReturnType<typeof setInterval> | null = null
  private closed = false

  constructor(
    private readonly socket: Duplex,
    private readonly handlers: ConnectionHandlers,
    /** Un téléphone qui s'endort ne ferme pas sa socket : le ping détecte la coupure. */
    keepaliveMs = 30_000
  ) {
    socket.on('data', (chunk: Buffer) => this.consume(chunk))
    socket.on('error', () => this.finish())
    socket.on('close', () => this.finish())
    this.keepalive = setInterval(() => this.frame(OPCODE.ping, Buffer.alloc(0)), keepaliveMs)
  }

  private consume(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    const { frames, rest, error } = decodeFrames(this.buffer)
    this.buffer = rest

    for (const frame of frames) {
      switch (frame.opcode) {
        case OPCODE.close:
          return this.close()
        case OPCODE.ping:
          this.frame(OPCODE.pong, frame.payload)
          break
        case OPCODE.pong:
          break
        case OPCODE.continuation:
        case OPCODE.text:
          this.fragments.push(frame.payload)
          if (!frame.fin) break
          this.handlers.onMessage(Buffer.concat(this.fragments).toString('utf8'))
          this.fragments = []
          break
        default:
          // Binaire ou opcode inconnu : hors du protocole de la télécommande
          return this.close()
      }
    }
    if (error) this.close()
  }

  private frame(opcode: number, payload: Buffer): void {
    if (this.closed || this.socket.destroyed) return
    this.socket.write(encodeFrame(opcode, payload))
  }

  send(text: string): void {
    this.frame(OPCODE.text, Buffer.from(text, 'utf8'))
  }

  close(): void {
    if (this.closed) return
    this.frame(OPCODE.close, Buffer.alloc(0))
    this.socket.end()
    this.finish()
  }

  private finish(): void {
    if (this.closed) return
    this.closed = true
    if (this.keepalive) clearInterval(this.keepalive)
    this.keepalive = null
    this.handlers.onClose()
  }
}
