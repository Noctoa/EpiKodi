import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import {
  REMOTE_IDLE,
  type RemoteCommand,
  type RemoteState,
  type RemoteStatus
} from '../shared/remote'
import { RemoteServer, remoteUrls } from './core/remote/server'
import { remoteConfig, rotateRemoteToken, setRemoteEnabled, setRemotePort } from './library'

/**
 * Cycle de vie de la télécommande côté process principal. Il est le seul à voir à la fois le
 * réseau et la fenêtre : le serveur lui pousse les commandes, qu'il relaie au lecteur par IPC, et
 * le lecteur lui renvoie son état, qu'il diffuse aux téléphones connectés.
 */

let server: RemoteServer | null = null
let state: RemoteState = REMOTE_IDLE
let error: string | null = null

export function remoteStatus(): RemoteStatus {
  const { enabled, port, token } = remoteConfig()
  return {
    enabled,
    port,
    token,
    running: server !== null,
    urls: server ? remoteUrls(port, token) : [],
    clients: server?.clientCount ?? 0,
    error
  }
}

function notify(): void {
  const status = remoteStatus()
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.remoteChanged, status)
}

/** La commande part à la fenêtre active : c'est elle qui a le lecteur à l'écran. */
function dispatch(command: RemoteCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send(IPC.remoteCommand, command)
}

/** Démarre, arrête ou redémarre le serveur selon les réglages enregistrés. */
export async function applyRemoteSettings(): Promise<RemoteStatus> {
  if (server) {
    await server.stop()
    server = null
  }
  error = null

  const { enabled, port, token } = remoteConfig()
  if (!enabled) {
    notify()
    return remoteStatus()
  }

  const next = new RemoteServer({
    port,
    token,
    state: () => state,
    onCommand: dispatch,
    onClientsChanged: notify
  })
  try {
    await next.start()
    server = next
    console.log(`[remote] télécommande en écoute sur le port ${port}`)
  } catch (err) {
    error =
      (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `Le port ${port} est déjà utilisé : choisis-en un autre.`
        : (err as Error).message
    console.warn(`[remote] démarrage impossible : ${error}`)
  }
  // La fenêtre ne publie son état que lorsque le serveur écoute : il faut qu'elle l'apprenne
  notify()
  return remoteStatus()
}

export function registerRemoteIpc(): void {
  ipcMain.handle(IPC.remoteStatus, () => remoteStatus())
  ipcMain.handle(IPC.remoteSetEnabled, (_, enabled: boolean) => {
    setRemoteEnabled(enabled)
    return applyRemoteSettings()
  })
  ipcMain.handle(IPC.remoteSetPort, (_, port: number) => {
    setRemotePort(port)
    return applyRemoteSettings()
  })
  ipcMain.handle(IPC.remoteRotateToken, () => {
    rotateRemoteToken()
    return applyRemoteSettings()
  })
  // Fire-and-forget : l'état arrive une fois par seconde, une réponse ne servirait à rien
  ipcMain.on(IPC.remotePublish, (_, next: RemoteState) => {
    state = next
    server?.broadcast(next)
  })
}

export async function stopRemote(): Promise<void> {
  await server?.stop()
  server = null
}
