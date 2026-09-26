import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RemoteFileProvider } from './remote-file'

const CONTENU = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')

let server: Server
let base: string

/**
 * Deux comportements observés chez de vrais hébergeurs de podcasts :
 * `/ok` annonce correctement sa taille, `/head-menteur` répond 200 à HEAD avec un corps vide
 * et `content-length: 0` — il faut alors retrouver la taille via une requête Range.
 */
beforeAll(async () => {
  server = createServer((req, res) => {
    const menteur = req.url === '/head-menteur'
    if (req.method === 'HEAD') {
      if (menteur) {
        res
          .writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': 0 })
          .end()
      } else {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': CONTENU.length }).end()
      }
      return
    }
    const match = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Number(match[2]) : CONTENU.length - 1
      res
        .writeHead(206, {
          'Content-Type': 'audio/mpeg',
          'Content-Range': `bytes ${start}-${end}/${CONTENU.length}`,
          'Content-Length': end - start + 1
        })
        .end(CONTENU.subarray(start, end + 1))
      return
    }
    res
      .writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': CONTENU.length })
      .end(CONTENU)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

const lire = async (provider: RemoteFileProvider, range?: { start: number; end?: number }) => {
  const chunks: Buffer[] = []
  for await (const c of await provider.read('', range)) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

describe('RemoteFileProvider', () => {
  it('lit la taille annoncée quand le serveur est correct', async () => {
    const provider = new RemoteFileProvider(`${base}/ok`)
    expect((await provider.stat()).size).toBe(CONTENU.length)
  })

  it('retrouve la taille malgré un HEAD qui annonce un fichier vide', async () => {
    const provider = new RemoteFileProvider(`${base}/head-menteur`)
    expect((await provider.stat()).size).toBe(CONTENU.length)
  })

  it('lit une plage d’octets, ce qui permet le saut dans un épisode', async () => {
    const provider = new RemoteFileProvider(`${base}/ok`)
    expect((await lire(provider, { start: 10, end: 14 })).toString()).toBe('abcde')
    expect((await lire(provider)).toString()).toBe(CONTENU.toString())
  })

  it('signale un fichier injoignable sans lever', async () => {
    const provider = new RemoteFileProvider('http://127.0.0.1:1/absent.mp3')
    expect(await provider.available()).toBe(false)
  })

  it('ne se reconnaît que dans sa propre URL', () => {
    const provider = new RemoteFileProvider(`${base}/ok`)
    expect(provider.relative(`${base}/ok`)).toBe('')
    expect(provider.relative(`${base}/autre`)).toBeNull()
    expect(provider.ffmpegUrl()).toBe(`${base}/ok`)
  })
})
