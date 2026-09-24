import { toMediaUrl } from '@shared/ipc'
import type { LibraryStats } from '@shared/ipc'
import type { MediaWithMetadata } from '@shared/models'
import { Grid, type GridTile } from '@frontend/components/Grid'
import { fmtDuration } from '@frontend/format'
import { recentlyAdded } from '@frontend/library/grouping'
import './HomeView.css'

interface Props {
  items: MediaWithMetadata[]
  stats: LibraryStats | null
  onOpen: (id: number) => void
  onPlay: (id: number) => void
  onAddSource: () => void
}

export function tileOf(m: MediaWithMetadata, currentKey?: string | null): GridTile {
  const md = m.metadata
  const isAudio = m.type === 'audio'
  return {
    key: String(m.id),
    title: m.title,
    subtitle: isAudio ? [md?.artist, md?.album].filter(Boolean).join(' · ') || 'Audio' : undefined,
    thumbnailUrl: md?.thumbnailPath ? toMediaUrl(md.thumbnailPath) : null,
    icon: isAudio ? '♪' : '▶',
    badge: m.probedAt === null ? 'analyse…' : fmtDuration(m.duration),
    square: isAudio,
    highlight: currentKey === `media:${m.id}`
  }
}

export function HomeView({ items, stats, onOpen, onPlay, onAddSource }: Props): React.JSX.Element {
  const recent = recentlyAdded(items, 12)

  if (items.length === 0) {
    return (
      <div className="home__welcome">
        <h2>Bienvenue dans EpiKodi</h2>
        <p>
          Ta bibliothèque est vide. Ajoute un dossier contenant des vidéos ou de la musique : les
          fichiers sont indexés, analysés et prêts à lire en quelques secondes.
        </p>
        <button onClick={onAddSource}>+ Ajouter un dossier</button>
      </div>
    )
  }

  return (
    <div className="home">
      {stats && (
        <div className="home__stats">
          <span>
            <strong>{stats.videos}</strong> vidéo(s)
          </span>
          <span>
            <strong>{stats.audio}</strong> piste(s)
          </span>
          <span>
            <strong>{stats.sources}</strong> source(s)
          </span>
        </div>
      )}
      <h3 className="home__section">Récemment ajoutés</h3>
      <Grid
        tiles={recent.map((m) => tileOf(m))}
        onOpen={(k) => onOpen(Number(k))}
        onPlay={(k) => onPlay(Number(k))}
      />
    </div>
  )
}
