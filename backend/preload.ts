import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type EpiKodiApi,
  type EpisodeDownload,
  type LibraryChanged,
  type OpenedMedia,
  type ScanProgress
} from '../shared/ipc'

const api: EpiKodiApi = {
  openMediaDialog: () => ipcRenderer.invoke(IPC.openMediaDialog),
  libraryStats: () => ipcRenderer.invoke(IPC.libraryStats),
  sourcesList: () => ipcRenderer.invoke(IPC.sourcesList),
  sourcesAdd: () => ipcRenderer.invoke(IPC.sourcesAdd),
  sourcesAddNetwork: (url, password) => ipcRenderer.invoke(IPC.sourcesAddNetwork, url, password),
  sourcesAvailability: () => ipcRenderer.invoke(IPC.sourcesAvailability),
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
  mediaFacets: () => ipcRenderer.invoke(IPC.mediaFacets),
  systemFfmpeg: () => ipcRenderer.invoke(IPC.systemFfmpeg),
  systemInfo: () => ipcRenderer.invoke(IPC.systemInfo),
  metadataStatus: () => ipcRenderer.invoke(IPC.metadataStatus),
  metadataSetKey: (key) => ipcRenderer.invoke(IPC.metadataSetKey, key),
  metadataSuggest: (mediaId, query) => ipcRenderer.invoke(IPC.metadataSuggest, mediaId, query),
  metadataApply: (mediaId, externalId) =>
    ipcRenderer.invoke(IPC.metadataApply, mediaId, externalId),
  playlistsList: () => ipcRenderer.invoke(IPC.playlistsList),
  playlistsCreate: (name) => ipcRenderer.invoke(IPC.playlistsCreate, name),
  playlistsRename: (id, name) => ipcRenderer.invoke(IPC.playlistsRename, id, name),
  playlistsRemove: (id) => ipcRenderer.invoke(IPC.playlistsRemove, id),
  playlistsItems: (id) => ipcRenderer.invoke(IPC.playlistsItems, id),
  playlistsAdd: (playlistId, mediaId) => ipcRenderer.invoke(IPC.playlistsAdd, playlistId, mediaId),
  playlistsRemoveItem: (playlistId, mediaId) =>
    ipcRenderer.invoke(IPC.playlistsRemoveItem, playlistId, mediaId),
  playlistsReorder: (playlistId, mediaIds) =>
    ipcRenderer.invoke(IPC.playlistsReorder, playlistId, mediaIds),
  playlistsExport: (id) => ipcRenderer.invoke(IPC.playlistsExport, id),
  playlistsImport: () => ipcRenderer.invoke(IPC.playlistsImport),
  favoritesToggle: (mediaId) => ipcRenderer.invoke(IPC.favoritesToggle, mediaId),
  favoritesList: () => ipcRenderer.invoke(IPC.favoritesList),
  playbackSave: (mediaId, position, completed) =>
    ipcRenderer.invoke(IPC.playbackSave, mediaId, position, completed),
  playbackState: (mediaId) => ipcRenderer.invoke(IPC.playbackState, mediaId),
  playbackContinue: () => ipcRenderer.invoke(IPC.playbackContinue),
  themesList: () => ipcRenderer.invoke(IPC.themesList),
  themesSelect: (id) => ipcRenderer.invoke(IPC.themesSelect, id),
  pluginsList: () => ipcRenderer.invoke(IPC.pluginsList),
  pluginsSetEnabled: (id, enabled) => ipcRenderer.invoke(IPC.pluginsSetEnabled, id, enabled),
  podcastsList: () => ipcRenderer.invoke(IPC.podcastsList),
  podcastsEpisodes: (id) => ipcRenderer.invoke(IPC.podcastsEpisodes, id),
  podcastsSubscribe: (url) => ipcRenderer.invoke(IPC.podcastsSubscribe, url),
  podcastsRefresh: (id) => ipcRenderer.invoke(IPC.podcastsRefresh, id),
  podcastsRefreshAll: () => ipcRenderer.invoke(IPC.podcastsRefreshAll),
  podcastsRemove: (id) => ipcRenderer.invoke(IPC.podcastsRemove, id),
  podcastsSearch: (term) => ipcRenderer.invoke(IPC.podcastsSearch, term),
  episodeDownload: (id) => ipcRenderer.invoke(IPC.episodeDownload, id),
  episodeRemoveDownload: (id) => ipcRenderer.invoke(IPC.episodeRemoveDownload, id),
  episodeProgress: (id, position, completed) =>
    ipcRenderer.invoke(IPC.episodeProgress, id, position, completed),
  episodeCompleted: (id, completed) => ipcRenderer.invoke(IPC.episodeCompleted, id, completed),
  onEpisodeDownload: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, p: EpisodeDownload): void => cb(p)
    ipcRenderer.on(IPC.episodeDownloadProgress, listener)
    return () => ipcRenderer.removeListener(IPC.episodeDownloadProgress, listener)
  },
  playerPlan: (path) => ipcRenderer.invoke(IPC.playerPlan, path),
  playerSubtitles: (path) => ipcRenderer.invoke(IPC.playerSubtitles, path),
  playerSubtitleVtt: (path, track) => ipcRenderer.invoke(IPC.playerSubtitleVtt, path, track),
  onMediaOpened: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, media: OpenedMedia): void => cb(media)
    ipcRenderer.on(IPC.mediaOpened, listener)
    return () => ipcRenderer.removeListener(IPC.mediaOpened, listener)
  }
}

contextBridge.exposeInMainWorld('epikodi', api)
