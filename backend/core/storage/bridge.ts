import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { AddressInfo } from 'node:net'
import type { Readable } from 'node:stream'
import type { ByteRange, StorageStat } from './types'

export interface BridgeHandlers {
  read(locator: string, range?: ByteRange): Promise<Readable>
  stat(locator: string): Promise<StorageStat>
}

export interface Bridge {
  /** URL http:// locale donnant accès à un fichier, quelle que soit sa source. */
  url(locator: string): string
  close(): void
}

const encode = (locator: string): string => Buffer.from(locator, 'utf8').toString('base64url')
const decode = (segment: string): string => Buffer.from(segment, 'base64url').toString('utf8')

/**
 * ffmpeg et ffprobe ne savent pas lire `smb://`. Ce petit serveur, lié à 127.0.0.1 sur un port
 * éphémère et protégé par un jeton aléatoire, leur présente n'importe quelle source derrière une
 * URL `http://`, en relayant les requêtes Range pour que le saut reste possible.
 */
export function startBridge(handlers: BridgeHandlers): Promise<Bridge> {
  const token = randomBytes(16).toString('hex')

  const server: Server = createServer((req, res) => {
    const [, reqToken, encoded] = (req.url ?? '').split('/')
    if (reqToken !== token || !encoded) {
      res.writeHead(403).end()
      return
    }
    const locator = decode(encoded)

    void (async () => {
      try {
        const { size } = await handlers.stat(locator)
        const match = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
        const start = match?.[1] ? Number(match[1]) : 0
        const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1

        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' }).end()
          return
        }
        const stream = await handlers.read(locator, match ? { start, end } : undefined)
        res.writeHead(match ? 206 : 200, {
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Content-Length': match ? end - start + 1 : size,
          ...(match && { 'Content-Range': `bytes ${start}-${end}/${size}` })
        })
        stream.pipe(res)
        res.on('close', () => stream.destroy())
      } catch {
        if (!res.headersSent) res.writeHead(502).end()
        else res.end()
      }
    })()
  })

  return new Promise((resolve) => {
    // 127.0.0.1 uniquement : le pont n'est jamais exposé au réseau
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: (locator) => `http://127.0.0.1:${port}/${token}/${encode(locator)}`,
        close: () => server.close()
      })
    })
  })
}
