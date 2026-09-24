import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  AUDIO_EXTENSIONS,
  IPC,
  VIDEO_EXTENSIONS,
  toMediaUrl,
  type MediaListQuery,
  type OpenedMedia,
  type SubtitleTrack,
  type SystemInfo
} from '../shared/ipc'
import {
  addSource,
  cancelScan,
  databasePath,
  enrichPending,
  getFfmpegStatus,
  closeLibrary,
  libraryStats,
  listMedia,
  mediaFacets,
  listSources,
  openLibrary,
  removeSource,
  scanAllSources,
  startScan,
  thumbnailDir
} from './library'
import { registerMediaProtocol, registerMediaSchemePrivileges } from './media-protocol'
import { listSubtitles, loadSubtitleVtt } from './core/subtitles'

registerMediaSchemePrivileges()
// Expose HTMLMediaElement.audioTracks (choix VF/VO) : API Chromium encore derrière un flag
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks')

/** `epikodi --open <fichier>` ou `epikodi <fichier>` : lecture directe au démarrage. */
function mediaFromArgv(argv: string[]): OpenedMedia | null {
  const args = argv.slice(is.dev ? 2 : 1).filter((a) => !a.startsWith('--') || a === '--open')
  const idx = args.indexOf('--open')
  const candidate = idx >= 0 ? args[idx + 1] : args.at(-1)
  if (!candidate) return null
  const path = resolve(candidate)
  if (!existsSync(path)) return null
  return { path, name: basename(path), url: toMediaUrl(path) }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    title: 'EpiKodi',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const initial = mediaFromArgv(process.argv)
  win.webContents.on('did-finish-load', () => {
    if (initial) win.webContents.send(IPC.mediaOpened, initial)
    scanAllSources((p) => win.webContents.send(IPC.scanProgress, p))
    enrichPending()
  })
  if (is.dev) {
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`)
    })
    // Crochet e2e : EPIKODI_E2E=script.js → exécuté dans la fenêtre, résultat sur stdout
    const e2e = process.env['EPIKODI_E2E']
    if (e2e) {
      win.webContents.once('did-finish-load', () => {
        void win.webContents
          .executeJavaScript(readFileSync(e2e, 'utf8'))
          .then((r) => console.log('[e2e]', JSON.stringify(r)))
          .catch((err) => console.log('[e2e] ERROR', String(err)))
          .finally(() => app.quit())
      })
    }
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
  ipcMain.handle(IPC.libraryStats, () => libraryStats())

  ipcMain.handle(IPC.sourcesList, () => listSources())
  ipcMain.handle(IPC.sourcesAdd, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Ajouter un dossier à la bibliothèque',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const source = addSource(result.filePaths[0])
    startScan(source.id, (p) => event.sender.send(IPC.scanProgress, p))
    return source
  })
  ipcMain.handle(IPC.sourcesRemove, (_, id: number) => removeSource(id))
  ipcMain.handle(IPC.sourcesScan, (event, id: number) =>
    startScan(id, (p) => event.sender.send(IPC.scanProgress, p))
  )
  ipcMain.handle(IPC.sourcesCancelScan, (_, id: number) => cancelScan(id))
  ipcMain.handle(IPC.mediaList, (_, query?: MediaListQuery) => listMedia(query))
  ipcMain.handle(IPC.mediaFacets, () => mediaFacets())
  ipcMain.handle(IPC.systemFfmpeg, () => getFfmpegStatus())
  ipcMain.handle(IPC.systemInfo, async (): Promise<SystemInfo> => ({
    version: app.getVersion(),
    databasePath: databasePath(),
    thumbnailDir: thumbnailDir(),
    ffmpeg: await getFfmpegStatus()
  }))
  ipcMain.handle(IPC.playerSubtitles, (_, path: string) => listSubtitles(path))
  ipcMain.handle(IPC.playerSubtitleVtt, (_, path: string, track: SubtitleTrack) =>
    loadSubtitleVtt(path, track)
  )

  ipcMain.handle(IPC.openMediaDialog, async (): Promise<OpenedMedia | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Ouvrir un média',
      properties: ['openFile'],
      filters: [
        { name: 'Médias', extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] },
        { name: 'Vidéos', extensions: VIDEO_EXTENSIONS },
        { name: 'Audio', extensions: AUDIO_EXTENSIONS },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    return { path, name: basename(path), url: toMediaUrl(path) }
  })
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('fr.epitech.epikodi')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  openLibrary()
  registerMediaProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => closeLibrary())
