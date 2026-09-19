import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type EpiKodiApi,
  type LibraryChanged,
  type OpenedMedia,
  type ScanProgress
} from '../shared/ipc'

const api: EpiKodiApi = {
  openMediaDialog: () => ipcRenderer.invoke(IPC.openMediaDialog),
  libraryStats: () => ipcRenderer.invoke(IPC.libraryStats),
  sourcesList: () => ipcRenderer.invoke(IPC.sourcesList),
  sourcesAdd: () => ipcRenderer.invoke(IPC.sourcesAdd),
  sourcesRemove: (id) => ipcRenderer.invoke(IPC.sourcesRemove, id),
  sourcesScan: (id) => ipcRenderer.invoke(IPC.sourcesScan, id),
  sourcesCancelScan: (id) => ipcRenderer.invoke(IPC.sourcesCancelScan, id),
  onScanProgress: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, p: ScanProgress): void => cb(p)
    ipcRenderer.on(IPC.scanProgress, listener)
    return () => ipcRenderer.removeListener(IPC.scanProgress, listener)
  },
  onLibraryChanged: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, e: LibraryChanged): void => cb(e)
    ipcRenderer.on(IPC.libraryChanged, listener)
    return () => ipcRenderer.removeListener(IPC.libraryChanged, listener)
  },
  mediaList: (query) => ipcRenderer.invoke(IPC.mediaList, query),
  systemFfmpeg: () => ipcRenderer.invoke(IPC.systemFfmpeg),
  playerSubtitles: (path) => ipcRenderer.invoke(IPC.playerSubtitles, path),
  playerSubtitleVtt: (path, track) => ipcRenderer.invoke(IPC.playerSubtitleVtt, path, track),
  onMediaOpened: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, media: OpenedMedia): void => cb(media)
    ipcRenderer.on(IPC.mediaOpened, listener)
    return () => ipcRenderer.removeListener(IPC.mediaOpened, listener)
  }
}

contextBridge.exposeInMainWorld('epikodi', api)
