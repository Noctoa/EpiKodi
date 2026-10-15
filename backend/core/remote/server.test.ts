import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REMOTE_IDLE, type RemoteCommand, type RemoteState } from '@shared/remote'
import { RemoteServer, remoteUrls, sameToken } from './server'

const TOKEN = 'jeton-de-test'

const STATE: RemoteState = {
  ...REMOTE_IDLE,
  source: 'video',
  playing: true,
  title: 'Film.mkv',
  position: 42,
  duration: 120,
  view: 'Vidéos'
}

let server: RemoteServer
let received: RemoteCommand[]
let base: string

beforeEach(async () => {
  received = []
  server = new RemoteServer({
    port: 0,
    token: TOKEN,
    state: () => STATE,
    onCommand: (command) => received.push(command)
  })
  await server.start()
  base = `http://127.0.0.1:${server.boundPort}`
})

afterEach(() => server.stop())

const get = (path: string): Promise<Response> => fetch(base + path)

const post = (path: string, body: unknown): Promise<Response> =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('jeton', () => {
  it('refuse une requête sans jeton', async () => {
    expect((await get('/api/state')).status).toBe(401)
    expect((await post('/api/command', { type: 'toggle' })).status).toBe(401)
    expect(received).toEqual([])
  })

  it('refuse un jeton faux et explique la marche à suivre sur la page', async () => {
    const page = await get('/?t=pas-le-bon')
    expect(page.status).toBe(401)
    expect(await page.text()).toContain('Paramètres')
  })

  it('accepte le jeton en paramètre ou en en-tête Bearer', async () => {
    expect((await get(`/api/state?t=${TOKEN}`)).status).toBe(200)
    const header = await fetch(`${base}/api/state`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(header.status).toBe(200)
  })

  it('compare à longueur constante sans se laisser avoir par un préfixe', () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true)
    expect(sameToken('jeton', TOKEN)).toBe(false)
    expect(sameToken(`${TOKEN}x`, TOKEN)).toBe(false)
    // Un jeton vide côté serveur n'autorise personne
    expect(sameToken('', '')).toBe(false)
  })
})

describe('API HTTP', () => {
  it('sert la page de télécommande', async () => {
    const page = await get(`/?t=${TOKEN}`)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(await page.text()).toContain('Télécommande EpiKodi')
  })

  it('expose l’état du lecteur', async () => {
    expect(await (await get(`/api/state?t=${TOKEN}`)).json()).toEqual(STATE)
  })

  it('transmet une commande valide et renvoie l’état', async () => {
    const res = await post(`/api/command?t=${TOKEN}`, { type: 'seek', position: 30 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(STATE)
    expect(received).toEqual([{ type: 'seek', position: 30 }])
  })

  it('rejette une commande inconnue sans rien transmettre', async () => {
    expect((await post(`/api/command?t=${TOKEN}`, { type: 'shutdown' })).status).toBe(400)
    expect((await post(`/api/command?t=${TOKEN}`, 'pas du json objet')).status).toBe(400)
    expect(received).toEqual([])
  })

  it('répond 404 sur une route inconnue', async () => {
    expect((await get(`/api/library?t=${TOKEN}`)).status).toBe(404)
  })
})

describe('WebSocket', () => {
  interface Remote {
    socket: WebSocket
    /** Prochain message reçu ; les messages arrivés avant l'appel sont mis de côté */
    next(): Promise<unknown>
  }

  function connect(token: string): Promise<Remote> {
    const socket = new WebSocket(`ws://127.0.0.1:${server.boundPort}/ws?t=${token}`)
    const pending: unknown[] = []
    const waiting: ((message: unknown) => void)[] = []
    socket.addEventListener('message', (e) => {
      const message = JSON.parse(e.data as string)
      const waiter = waiting.shift()
      if (waiter) waiter(message)
      else pending.push(message)
    })
    const next = (): Promise<unknown> =>
      pending.length > 0
        ? Promise.resolve(pending.shift())
        : new Promise((resolve) => waiting.push(resolve))

    return new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve({ socket, next }))
      socket.addEventListener('error', () => reject(new Error('connexion refusée')))
    })
  }

  it('envoie l’état courant dès la connexion', async () => {
    const remote = await connect(TOKEN)
    expect(await remote.next()).toEqual({ type: 'state', state: STATE })
    expect(server.clientCount).toBe(1)
    remote.socket.close()
  })

  it('diffuse les changements d’état aux clients connectés', async () => {
    const remote = await connect(TOKEN)
    await remote.next()
    server.broadcast({ ...STATE, playing: false })
    expect(await remote.next()).toMatchObject({ state: { playing: false } })
    remote.socket.close()
  })

  it('applique une commande reçue sur la socket, et ignore le reste', async () => {
    const remote = await connect(TOKEN)
    await remote.next()
    remote.socket.send(JSON.stringify({ type: 'toggle' }))
    remote.socket.send(JSON.stringify({ type: 'inconnue' }))
    remote.socket.send('pas du json')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(received).toEqual([{ type: 'toggle' }])
    remote.socket.close()
  })

  it('refuse une connexion sans jeton valide', async () => {
    await expect(connect('faux')).rejects.toThrow()
    expect(server.clientCount).toBe(0)
  })
})

describe('remoteUrls', () => {
  it('construit des adresses complètes, jeton compris', () => {
    for (const url of remoteUrls(8723, 'abc')) {
      expect(url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:8723\/\?t=abc$/)
    }
  })
})
