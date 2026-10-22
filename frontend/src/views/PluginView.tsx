import { useCallback, useEffect, useState } from 'react'
import type { PluginItem } from '@shared/ipc'
import { Grid } from '@frontend/components/Grid'
import { errorMessage } from '@frontend/format'
import './PluginView.css'

interface Props {
  pluginId: string
  menuId: string
  /** Nom de l'extension, affiché quand quelque chose ne va pas de son côté */
  pluginName: string
  title: string
}

/**
 * Écran apporté par une extension. L'application n'en connaît pas le contenu : elle demande la
 * liste au plugin, l'affiche dans la grille habituelle, et lui renvoie l'élément validé. Ce que
 * « ouvrir » signifie — lancer un émulateur, démarrer un flux — ne regarde que le plugin.
 */
export function PluginView({ pluginId, menuId, pluginName, title }: Props): React.JSX.Element {
  const [items, setItems] = useState<PluginItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** Incrémenté par « Rafraîchir » : le contenu d'une extension peut changer hors de l'application */
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.epikodi
      .pluginsItems(pluginId, menuId)
      .then((listed) => {
        if (cancelled) return
        setItems(listed)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setItems([])
        setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [pluginId, menuId, revision])

  const activate = useCallback(
    async (itemId: string) => {
      setBusy(itemId)
      setError(null)
      try {
        await window.epikodi.pluginsActivate(pluginId, menuId, itemId)
      } catch (err) {
        setError(errorMessage(err))
      }
      setBusy(null)
    },
    [pluginId, menuId]
  )

  if (items === null) return <p className="settings__loading">Chargement…</p>

  return (
    <div className="plugin-view">
      <div className="plugin-view__bar">
        <span className="settings__hint">
          {items.length} élément(s) · fourni par {pluginName}
          {busy && ' · ouverture en cours…'}
        </span>
        <button className="btn--ghost" onClick={() => setRevision((r) => r + 1)}>
          Rafraîchir
        </button>
      </div>

      {error && <p className="plugin-view__error">{error}</p>}

      <Grid
        tiles={items.map((i) => ({
          key: i.id,
          title: i.title,
          subtitle: i.subtitle ?? undefined,
          thumbnailUrl: i.thumbnail ?? null,
          icon: i.icon ?? '⬚',
          badge: i.badge ?? undefined,
          square: true
        }))}
        onOpen={(key) => void activate(key)}
        empty={`« ${title} » n'a rien à afficher pour le moment. Vérifie la configuration de l'extension ${pluginName}.`}
      />
    </div>
  )
}
