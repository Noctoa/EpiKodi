import { useCallback, useEffect, useState } from 'react'
import { toImageUrl, toMediaUrl, type IptvImport } from '@shared/ipc'
import type { IptvChannel, IptvSource } from '@shared/models'
import { Grid } from '@frontend/components/Grid'
import { errorMessage } from '@frontend/format'
import { useDebounced } from '@frontend/hooks'
import './IptvView.css'

interface Props {
  /** Lance une chaîne : la vue ne sait pas lire, elle confie le flux au lecteur. */
  onWatch: (channel: IptvChannel) => void
  /** Le nombre de chaînes alimente le compteur de la barre latérale. */
  onCountChange: (count: number) => void
}

/** Épingler se fait à la souris sur la vignette, ou avec cette touche au clavier et à la manette. */
const FAVORITE_ACTION = { icon: '★', title: 'Épingler en favori', key: 'f' }

/** Au-delà, l'écran n'est plus parcourable : on filtre, on ne fait pas défiler dix mille vignettes. */
const PAGE = 400

const logoOf = (c: IptvChannel): string | null =>
  c.logoPath ? toMediaUrl(c.logoPath) : c.logoUrl ? toImageUrl(c.logoUrl) : null

/** Première liste à ajouter : sans source, la section n'a rien à montrer. */
function AddSource({
  onAdded,
  compact
}: {
  onAdded: (r: IptvImport) => void
  compact?: boolean
}): React.JSX.Element {
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!location.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.epikodi.iptvAdd(location.trim())
      if (result.error) setError(result.error)
      else {
        setLocation('')
        onAdded(result)
      }
    } catch (err) {
      setError(errorMessage(err))
    }
    setBusy(false)
  }

  return (
    <div className={`iptv-add ${compact ? 'iptv-add--compact' : ''}`}>
      {!compact && (
        <p className="iptv-add__intro">
          Une liste de chaînes est un fichier M3U : l’adresse d’un fournisseur, ou un fichier sur le
          disque. Les chaînes sont mémorisées, pas les flux — rien n’est téléchargé.
        </p>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="https://exemple.org/chaines.m3u ou /home/moi/chaines.m3u"
          aria-label="Adresse ou fichier de la liste de chaînes"
        />
        <button disabled={busy || !location.trim()}>{busy ? 'Chargement…' : 'Ajouter'}</button>
      </form>
      {error && <p className="iptv__error">{error}</p>}
      {!compact && (
        <p className="settings__hint">
          Pour essayer&nbsp;: <code>https://iptv-org.github.io/iptv/countries/fr.m3u</code>
        </p>
      )}
    </div>
  )
}

/**
 * Les chaînes en direct. Le filtrage est fait par la base et non en mémoire : une liste publique
 * en compte des milliers, et les garder toutes côté interface pour en afficher trente n'aurait
 * pas de sens.
 */
export function IptvView({ onWatch, onCountChange }: Props): React.JSX.Element {
  const [sources, setSources] = useState<IptvSource[] | null>(null)
  const [channels, setChannels] = useState<IptvChannel[]>([])
  const [groups, setGroups] = useState<{ group: string; count: number }[]>([])
  const [last, setLast] = useState<IptvChannel | null>(null)

  const [sourceId, setSourceId] = useState<number | undefined>()
  const [group, setGroup] = useState<string | undefined>()
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  /** Incrémenté par tout ce qui change le contenu : ajout, rafraîchissement, favori */
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.epikodi.iptvSources(), window.epikodi.iptvLastChannel()]).then(
      ([listed, lastSeen]) => {
        if (cancelled) return
        setSources(listed)
        setLast(lastSeen)
        // Une source retirée ne doit pas laisser derrière elle un filtre qui ne vise plus rien
        setSourceId((id) => (id !== undefined && !listed.some((s) => s.id === id) ? undefined : id))
      }
    )
    return () => {
      cancelled = true
    }
  }, [revision])

  useEffect(() => {
    let cancelled = false
    void window.epikodi.iptvGroups(sourceId).then((g) => !cancelled && setGroups(g))
    return () => {
      cancelled = true
    }
  }, [sourceId, revision])

  useEffect(() => {
    let cancelled = false
    void window.epikodi
      .iptvChannels({ sourceId, group, search: debounced, favoritesOnly, limit: PAGE })
      .then((listed) => {
        if (cancelled) return
        setChannels(listed)
        onCountChange(listed.length)
      })
    return () => {
      cancelled = true
    }
  }, [sourceId, group, debounced, favoritesOnly, revision, onCountChange])

  const watch = useCallback(
    (channel: IptvChannel) => {
      void window.epikodi.iptvSetLastChannel(channel.id)
      setLast(channel)
      onWatch(channel)
    },
    [onWatch]
  )

  const toggleFavorite = useCallback(async (channel: IptvChannel) => {
    await window.epikodi.iptvFavorite(channel.id, !channel.favorite)
    setRevision((r) => r + 1)
  }, [])

  const refresh = useCallback(async (id: number) => {
    setBusy(true)
    setMessage(null)
    const result = await window.epikodi.iptvRefresh(id)
    setMessage(
      result.error
        ? `« ${result.name} » : ${result.error}`
        : `« ${result.name} » : ${result.total} chaîne(s), ${result.added} nouvelle(s)` +
            (result.missing > 0 ? `, ${result.missing} disparue(s)` : '')
    )
    setBusy(false)
    setRevision((r) => r + 1)
  }, [])

  const remove = useCallback(async (source: IptvSource) => {
    setBusy(true)
    await window.epikodi.iptvRemove(source.id)
    setMessage(`« ${source.name} » retirée.`)
    setBusy(false)
    setRevision((r) => r + 1)
  }, [])

  if (sources === null) return <p className="settings__loading">Chargement…</p>

  if (sources.length === 0) {
    return (
      <div className="iptv">
        <AddSource onAdded={() => setRevision((r) => r + 1)} />
      </div>
    )
  }

  const current = sources.find((s) => s.id === sourceId)
  const byId = new Map(channels.map((c) => [String(c.id), c]))

  return (
    <div className="iptv">
      <div className="iptv__bar">
        {sources.length > 1 && (
          <label className="filters__field">
            Liste
            <select
              value={sourceId ?? ''}
              onChange={(e) => {
                setSourceId(e.target.value ? Number(e.target.value) : undefined)
                // Les rubriques ne sont pas les mêmes d'une liste à l'autre : garder le filtre
                // précédent laisserait un écran vide sans qu'on comprenne pourquoi.
                setGroup(undefined)
              }}
            >
              <option value="">Toutes</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="filters__field">
          Rubrique
          <select value={group ?? ''} onChange={(e) => setGroup(e.target.value || undefined)}>
            <option value="">Toutes</option>
            {groups.map((g) => (
              <option key={g.group} value={g.group}>
                {g.group} ({g.count})
              </option>
            ))}
          </select>
        </label>

        <input
          className="iptv__search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Chercher une chaîne…"
          aria-label="Chercher une chaîne"
        />

        <button
          className={favoritesOnly ? '' : 'btn--ghost'}
          onClick={() => setFavoritesOnly((f) => !f)}
          aria-pressed={favoritesOnly}
          title="N’afficher que les favorites"
        >
          ★ Favorites
        </button>

        <span className="iptv__spacer" />

        {last && (
          <button className="btn--ghost" onClick={() => watch(last)} title="Dernière chaîne vue">
            ↻ {last.name}
          </button>
        )}
      </div>

      <Grid
        tiles={channels.map((c) => ({
          key: String(c.id),
          title: c.name,
          subtitle: c.group ?? undefined,
          thumbnailUrl: logoOf(c),
          icon: '⊡',
          badge: c.favorite ? '★' : undefined,
          square: true,
          highlight: last?.id === c.id
        }))}
        onOpen={(key) => {
          const channel = byId.get(key)
          if (channel) watch(channel)
        }}
        onPlay={(key) => {
          const channel = byId.get(key)
          if (channel) void toggleFavorite(channel)
        }}
        action={FAVORITE_ACTION}
        empty={
          favoritesOnly
            ? 'Aucune favorite pour le moment. Épingle une chaîne avec ★ ou la touche F.'
            : 'Aucune chaîne ne correspond à ce filtre.'
        }
      />

      <div className="iptv__sources">
        <h3 className="home__section">Listes de chaînes</h3>
        <ul>
          {sources.map((s) => (
            <li key={s.id}>
              <div className="iptv__source-main">
                <strong>{s.name}</strong>
                <span className="settings__hint">
                  {' '}
                  · {s.channelCount} chaîne(s)
                  {s.missingCount > 0 && ` · ${s.missingCount} disparue(s)`}
                </span>
                <div className="settings__hint">{s.location}</div>
                {s.lastError && <div className="iptv__error">{s.lastError}</div>}
              </div>
              <button className="btn--ghost" disabled={busy} onClick={() => void refresh(s.id)}>
                Rafraîchir
              </button>
              <button
                className="btn--ghost btn--danger"
                disabled={busy}
                onClick={() => void remove(s)}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>

        <AddSource compact onAdded={() => setRevision((r) => r + 1)} />
        {message && <p className="settings__message">{message}</p>}
        {current?.lastError && <p className="iptv__error">{current.lastError}</p>}
      </div>
    </div>
  )
}
