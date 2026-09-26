import { useCallback, useEffect, useState } from 'react'
import {
  toMediaUrl,
  type EpisodeDownload,
  type PodcastSearchResult,
  type PodcastWithCounts
} from '@shared/ipc'
import type { PodcastEpisode } from '@shared/models'
import { Grid, type GridTile } from '@frontend/components/Grid'
import { fmtDuration, fmtSize } from '@frontend/format'
import './PodcastsView.css'

const fmtDate = (ts: number | null): string =>
  ts === null ? '' : new Date(ts * 1000).toLocaleDateString('fr-FR', { dateStyle: 'medium' })

/** Formulaire d'abonnement : par URL de flux, ou par recherche dans l'annuaire public. */
function AddPodcast({
  onSubscribe
}: {
  onSubscribe: (url: string) => Promise<string | null>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<PodcastSearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const value = term.trim()
      if (!value) return
      setBusy(true)
      setError(null)
      // Une adresse s'ajoute directement ; un mot-clé passe par l'annuaire
      if (/^https?:\/\//i.test(value)) {
        const err = await onSubscribe(value)
        setBusy(false)
        if (err) return setError(err)
        setOpen(false)
        setTerm('')
        return
      }
      try {
        setResults(await window.epikodi.podcastsSearch(value))
      } catch (err) {
        setError((err as Error).message)
      }
      setBusy(false)
    },
    [term, onSubscribe]
  )

  const add = useCallback(
    async (feedUrl: string) => {
      setBusy(true)
      const err = await onSubscribe(feedUrl)
      setBusy(false)
      if (err) return setError(err)
      setOpen(false)
      setTerm('')
      setResults([])
    },
    [onSubscribe]
  )

  if (!open) return <button onClick={() => setOpen(true)}>+ Ajouter un podcast</button>

  return (
    <div className="add-podcast">
      <form onSubmit={submit}>
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Nom d'un podcast, ou adresse d'un flux RSS"
        />
        <button type="submit" disabled={busy || !term.trim()}>
          {busy ? '…' : /^https?:\/\//i.test(term) ? "S'abonner" : 'Rechercher'}
        </button>
        <button type="button" className="btn--ghost" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </form>
      {error && <p className="add-podcast__error">{error}</p>}
      {results.length > 0 && (
        <ul className="add-podcast__results">
          {results.map((r) => (
            <li key={r.feedUrl}>
              {r.imageUrl && <img src={r.imageUrl} alt="" loading="lazy" />}
              <span className="add-podcast__info">
                <span className="add-podcast__title">{r.title}</span>
                <span className="add-podcast__author">
                  {[r.author, r.episodeCount && `${r.episodeCount} épisodes`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <button className="btn--ghost" disabled={busy} onClick={() => void add(r.feedUrl)}>
                S'abonner
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ListProps {
  podcasts: PodcastWithCounts[]
  onOpen: (p: PodcastWithCounts) => void
  onSubscribe: (url: string) => Promise<string | null>
}

/** Niveau 1 : les abonnements. */
export function PodcastsView({ podcasts, onOpen, onSubscribe }: ListProps): React.JSX.Element {
  const tiles: GridTile[] = podcasts.map((p) => ({
    key: String(p.id),
    title: p.title,
    subtitle: [p.author, `${p.episodeCount} épisodes`].filter(Boolean).join(' · '),
    thumbnailUrl: p.imagePath ? toMediaUrl(p.imagePath) : p.imageUrl,
    icon: '◉',
    square: true,
    badge: p.unplayed > 0 ? `${p.unplayed} à écouter` : undefined
  }))

  return (
    <div className="podcasts">
      <div className="podcasts__head">
        <AddPodcast onSubscribe={onSubscribe} />
        {podcasts.some((p) => p.lastError) && (
          <span className="podcasts__warn">
            ⚠ {podcasts.filter((p) => p.lastError).length} flux injoignable(s)
          </span>
        )}
      </div>
      <Grid
        tiles={tiles}
        onOpen={(key) => onOpen(podcasts.find((p) => String(p.id) === key)!)}
        empty="Aucun abonnement. Cherche un podcast par son nom, ou colle l'adresse d'un flux RSS."
      />
    </div>
  )
}

interface EpisodesProps {
  podcast: PodcastWithCounts
  episodes: PodcastEpisode[]
  downloads: Record<number, EpisodeDownload>
  currentKey: string | null
  onPlay: (e: PodcastEpisode) => void
  onDownload: (e: PodcastEpisode) => void
  onRemoveDownload: (e: PodcastEpisode) => void
  onToggleCompleted: (e: PodcastEpisode) => void
  onRefresh: () => void
  onUnsubscribe: () => void
}

/** Niveau 2 : les épisodes d'un abonnement. */
export function PodcastEpisodesView({
  podcast,
  episodes,
  downloads,
  currentKey,
  onPlay,
  onDownload,
  onRemoveDownload,
  onToggleCompleted,
  onRefresh,
  onUnsubscribe
}: EpisodesProps): React.JSX.Element {
  return (
    <div className="podcast">
      <header className="podcast__head">
        <div className="podcast__cover">
          {podcast.imagePath || podcast.imageUrl ? (
            <img
              src={podcast.imagePath ? toMediaUrl(podcast.imagePath) : podcast.imageUrl!}
              alt=""
            />
          ) : (
            <span>◉</span>
          )}
        </div>
        <div className="podcast__info">
          <h2>{podcast.title}</h2>
          {podcast.author && <p className="podcast__author">{podcast.author}</p>}
          {podcast.description && <p className="podcast__description">{podcast.description}</p>}
          {podcast.lastError && (
            <p className="podcast__error">Dernier rafraîchissement échoué : {podcast.lastError}</p>
          )}
          <div className="podcast__actions">
            <button className="btn--ghost" onClick={onRefresh}>
              ↻ Rafraîchir
            </button>
            <button className="btn--ghost btn--danger" onClick={onUnsubscribe}>
              Se désabonner
            </button>
          </div>
        </div>
      </header>

      <ul className="episodes">
        {episodes.map((e) => {
          const download = downloads[e.id]
          const downloading = download && !download.done
          const progress = e.duration && e.position > 0 ? (e.position / e.duration) * 100 : 0
          return (
            <li
              key={e.id}
              className={[
                'episode',
                e.completed ? 'episode--completed' : '',
                currentKey === `episode:${e.id}` ? 'episode--current' : ''
              ].join(' ')}
            >
              <button
                className="episode__play"
                onClick={() => onPlay(e)}
                title={e.position > 0 ? `Reprendre à ${fmtDuration(e.position)}` : 'Lire'}
              >
                ▶
              </button>
              <div className="episode__body">
                <div className="episode__title">{e.title}</div>
                <div className="episode__meta">
                  {[
                    fmtDate(e.publishedAt),
                    e.duration ? fmtDuration(e.duration) : null,
                    e.localPath ? 'hors ligne' : null,
                    e.completed ? 'écouté' : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {e.description && <p className="episode__description">{e.description}</p>}
                {progress > 0 && !e.completed && (
                  <div className="episode__progress">
                    <div style={{ width: `${Math.min(100, progress)}%` }} />
                  </div>
                )}
                {downloading && (
                  <div className="episode__progress episode__progress--download">
                    <div
                      style={{
                        width: `${download.total ? (download.received / download.total) * 100 : 0}%`
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="episode__actions">
                <button
                  className="media-item__action"
                  onClick={() => onToggleCompleted(e)}
                  title={e.completed ? 'Marquer comme non écouté' : 'Marquer comme écouté'}
                >
                  {e.completed ? '↺' : '✓'}
                </button>
                {e.localPath ? (
                  <button
                    className="media-item__action"
                    onClick={() => onRemoveDownload(e)}
                    title={`Supprimer la copie${e.size ? ` (${fmtSize(e.size)})` : ''}`}
                  >
                    ✕
                  </button>
                ) : (
                  <button
                    className="media-item__action"
                    disabled={downloading}
                    onClick={() => onDownload(e)}
                    title="Télécharger pour écouter hors ligne"
                  >
                    {downloading ? '…' : '↓'}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Charge les épisodes d'un abonnement, en rechargeant quand il change. */
export function useEpisodes(podcastId: number | null): [PodcastEpisode[], () => void] {
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (podcastId === null) return
    let cancelled = false
    window.epikodi.podcastsEpisodes(podcastId).then((list) => {
      if (!cancelled) setEpisodes(list)
    })
    return () => {
      cancelled = true
    }
  }, [podcastId, tick])

  return [episodes, useCallback(() => setTick((t) => t + 1), [])]
}
