import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type EpiKodiApi, type OpenedMedia } from '../shared/ipc'

const api: EpiKodiApi = {
  openMediaDialog: () => ipcRenderer.invoke(IPC.openMediaDialog),
  onMediaOpened: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, media: OpenedMedia): void => cb(media)
    ipcRenderer.on(IPC.mediaOpened, listener)
    return () => ipcRenderer.removeListener(IPC.mediaOpened, listener)
  }
}

contextBridge.exposeInMainWorld('epikodi', api)
