import { useCallback, useState } from 'react'
import type { PlaylistSummary } from '@shared/ipc'
import type { MediaWithMetadata } from '@shared/models'
import { MediaList } from '@frontend/components/MediaList'
import { fmtDuration } from '@frontend/format'
import './PlaylistsView.css'

interface ListProps {
  playlists: PlaylistSummary[]
  onOpen: (p: PlaylistSummary) => void
  onCreate: (name: string) => Promise<void>
  onImport: () => Promise<string | null>
}

/** Niveau 1 : les playlists, avec création et import M3U. */
export function PlaylistsView({
  playlists,
  onOpen,
  onCreate,
  onImport
}: ListProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!name.trim()) return
      await onCreate(name.trim())
      setName('')
    },
    [name, onCreate]
  )

  return (
    <div className="playlists">
      <div className="playlists__head">
        <form onSubmit={create}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom d'une nouvelle playlist"
          />
          <button type="submit" disabled={!name.trim()}>
            Créer
          </button>
        </form>
        <button
          className="btn--ghost"
          onClick={() => void onImport().then((m) => setMessage(m))}
          title="Importer un fichier .m3u"
        >
          ↥ Importer
        </button>
      </div>
      {message && <p className="playlists__message">{message}</p>}

      {playlists.length === 0 ? (
        <div className="grid__empty">
          Aucune playlist. Crée-en une ci-dessus, ou importe un fichier <code>.m3u</code> existant.
        </div>
      ) : (
        <ul className="playlists__list">
          {playlists.map((p) => (
            <li key={p.id}>
              <button className="playlist-card" onClick={() => onOpen(p)}>
                <span className="playlist-card__icon">☰</span>
                <span className="playlist-card__text">
                  <span className="playlist-card__name">{p.name}</span>
                  <span className="playlist-card__meta">
                    {p.count} média(s)
                    {p.duration > 0 && ` · ${fmtDuration(p.duration)}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface DetailProps {
  playlist: PlaylistSummary
  items: MediaWithMetadata[]
  currentKey: string | null
  onPlay: (m: MediaWithMetadata) => void
  onPlayAll: () => void
  onRemoveItem: (m: MediaWithMetadata) => void
  onReorder: (mediaIds: number[]) => void
  onRename: (name: string) => void
  onDelete: () => void
  onExport: () => void
}

/** Niveau 2 : le contenu d'une playlist, réordonnable par glisser-déposer. */
export function PlaylistView({
  playlist,
  items,
  currentKey,
  onPlay,
  onPlayAll,
  onRemoveItem,
  onReorder,
  onRename,
  onDelete,
  onExport
}: DetailProps): React.JSX.Element {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(playlist.name)

  const drop = useCallback(
    (to: number) => {
      if (dragFrom === null || dragFrom === to) return
      const ordre = items.map((m) => m.id)
      const [deplace] = ordre.splice(dragFrom, 1)
      ordre.splice(to, 0, deplace)
      onReorder(ordre)
    },
    [dragFrom, items, onReorder]
  )

  return (
    <div className="playlist">
      <header className="playlist__head">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onRename(name)
              setRenaming(false)
            }}
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit">Renommer</button>
          </form>
        ) : (
          <div className="playlist__title">
            <h2>{playlist.name}</h2>
            <span className="playlist__meta">
              {items.length} média(s)
              {playlist.duration > 0 && ` · ${fmtDuration(playlist.duration)}`}
            </span>
          </div>
        )}
        <div className="playlist__actions">
          {items.length > 0 && <button onClick={onPlayAll}>▶ Tout lire</button>}
          <button className="btn--ghost" onClick={() => setRenaming((r) => !r)}>
            Renommer
          </button>
          <button className="btn--ghost" onClick={onExport} title="Exporter au format .m3u">
            ↧ Exporter
          </button>
          <button className="btn--ghost btn--danger" onClick={onDelete}>
            Supprimer
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="grid__empty">
          Playlist vide. Depuis la bibliothèque, utilise le bouton <strong>☰</strong> d’un média
          pour l’ajouter ici.
        </div>
      ) : (
        <ol className="playlist__items">
          {items.map((m, i) => (
            <li
              key={m.id}
              className={[
                'playlist-item',
                dragOver === i && dragFrom !== i ? 'playlist-item--over' : ''
              ].join(' ')}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(i)
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => {
                drop(i)
                setDragFrom(null)
                setDragOver(null)
              }}
              onDragEnd={() => {
                setDragFrom(null)
                setDragOver(null)
              }}
            >
              <span className="playlist-item__grip" title="Glisser pour réordonner">
                ⋮⋮
              </span>
              <span className="playlist-item__rank">{i + 1}</span>
              <div className="playlist-item__body">
                <MediaList
                  items={[m]}
                  currentKey={currentKey}
                  onPlay={onPlay}
                  onEnqueue={undefined}
                />
              </div>
              <button
                className="media-item__action"
                onClick={() => onRemoveItem(m)}
                title="Retirer de la playlist"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
