import { useCallback, useEffect, useRef, useState } from 'react'
import './Grid.css'

export interface GridTile {
  key: string
  title: string
  subtitle?: string
  /** URL `media://` d'une miniature, ou null pour l'icône de repli */
  thumbnailUrl?: string | null
  /** Icône affichée faute de miniature */
  icon?: string
  /** Pastille en haut à droite (durée, nombre de pistes…) */
  badge?: string
  /** Vignette carrée (album, artiste) plutôt que 16:9 (vidéo) */
  square?: boolean
  highlight?: boolean
}

interface Props {
  tiles: GridTile[]
  onOpen: (key: string) => void
  /** Action secondaire (▶ au survol) : lecture directe sans passer par le détail */
  onPlay?: (key: string) => void
  empty?: React.ReactNode
}

/**
 * Grille responsive avec navigation clavier « salon » : flèches pour se déplacer,
 * Entrée pour ouvrir, P pour lire. Le nombre de colonnes est déduit de la mise en page réelle.
 */
export function Grid({ tiles, onOpen, onPlay, empty }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [focusState, setFocus] = useState(0)
  // La liste peut rétrécir (filtre, suppression) : on garde l'index dans les bornes au rendu
  const focus = Math.min(focusState, Math.max(0, tiles.length - 1))

  /** Colonnes = nombre de cartes partageant le `offsetTop` de la première. */
  const columns = useCallback((): number => {
    const items = ref.current?.querySelectorAll<HTMLElement>('.tile')
    if (!items || items.length === 0) return 1
    const top = items[0].offsetTop
    let n = 0
    for (const el of items) {
      if (el.offsetTop !== top) break
      n++
    }
    return Math.max(1, n)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const last = tiles.length - 1
      if (last < 0) return
      const cols = columns()
      const moves: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: cols,
        ArrowUp: -cols
      }
      if (e.key in moves) {
        e.preventDefault()
        setFocus((f) => Math.min(last, Math.max(0, f + moves[e.key])))
      } else if (e.key === 'Home') {
        e.preventDefault()
        setFocus(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setFocus(last)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onOpen(tiles[focus].key)
      } else if (e.key.toLowerCase() === 'p' && onPlay) {
        e.preventDefault()
        onPlay(tiles[focus].key)
      }
    },
    [tiles, focus, columns, onOpen, onPlay]
  )

  useEffect(() => {
    const el = ref.current?.querySelectorAll<HTMLElement>('.tile')[focus]
    if (el && ref.current?.contains(document.activeElement)) {
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [focus, tiles])

  if (tiles.length === 0) return <div className="grid__empty">{empty ?? 'Rien à afficher.'}</div>

  return (
    <div className="grid" ref={ref} onKeyDown={onKeyDown}>
      {tiles.map((t, i) => (
        <button
          key={t.key}
          className={`tile ${t.highlight ? 'tile--current' : ''}`}
          tabIndex={i === focus ? 0 : -1}
          onFocus={() => setFocus(i)}
          onClick={() => onOpen(t.key)}
          onDoubleClick={() => onPlay?.(t.key)}
        >
          <div className={`tile__thumb ${t.square ? 'tile__thumb--square' : ''}`}>
            {t.thumbnailUrl ? (
              <img src={t.thumbnailUrl} alt="" loading="lazy" />
            ) : (
              <span className="tile__icon">{t.icon ?? '▶'}</span>
            )}
            {t.badge && <span className="tile__badge">{t.badge}</span>}
            {onPlay && (
              <span
                className="tile__play"
                title="Lire"
                onClick={(e) => {
                  e.stopPropagation()
                  onPlay(t.key)
                }}
              >
                ▶
              </span>
            )}
          </div>
          <div className="tile__title" title={t.title}>
            {t.title}
          </div>
          {t.subtitle && <div className="tile__sub">{t.subtitle}</div>}
        </button>
      ))}
    </div>
  )
}
