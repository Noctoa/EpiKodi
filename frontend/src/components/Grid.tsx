import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { focusCursor } from '@frontend/focus'
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
  /**
   * Habillage de cette action secondaire. Toutes les grilles ne lisent pas : celle des chaînes
   * s'en sert pour épingler une favorite, et le symbole comme la touche doivent le dire.
   */
  action?: { icon: string; title: string; key: string }
  empty?: React.ReactNode
  /**
   * N'afficher que ce nombre de lignes pleines. Les cartes en trop ne sont pas rendues : une
   * rangée d'aperçu qui s'arrête au milieu d'une ligne se voit, et le nombre de colonnes dépend
   * de la largeur de la fenêtre comme du thème.
   */
  rows?: number
}

/**
 * Grille responsive avec navigation clavier « salon » : flèches pour se déplacer,
 * Entrée pour ouvrir, P pour lire. Le nombre de colonnes est déduit de la mise en page réelle.
 */
const PLAY: NonNullable<Props['action']> = { icon: '▶', title: 'Lire', key: 'p' }

export function Grid({
  tiles,
  onOpen,
  onPlay,
  empty,
  rows,
  action = PLAY
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [focusState, setFocus] = useState(0)
  /** Colonnes résolues par la mise en page ; 0 tant que rien n'est mesuré. */
  const [tracks, setTracks] = useState(0)

  /*
   * `auto-fill` décide du nombre de colonnes à partir de la largeur, pas du nombre de cartes :
   * la piste calculée reste donc juste même une fois la liste tronquée. Mesure avant peinture,
   * pour que la ligne coupée ne s'affiche jamais entière.
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!rows || !el) return
    const measure = (): void => {
      const columns = getComputedStyle(el).gridTemplateColumns
      // Grille non mise en page : la valeur rendue est la déclaration, pas les pistes résolues.
      // La compter donnerait trois colonnes imaginaires ; mieux vaut garder la mesure précédente.
      if (columns.includes('(')) return
      setTracks(columns === 'none' ? 1 : columns.split(' ').filter(Boolean).length)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [rows])

  const shown = rows && tracks > 0 ? tiles.slice(0, rows * tracks) : tiles
  // La liste peut rétrécir (filtre, suppression) : on garde l'index dans les bornes au rendu
  const focus = Math.min(focusState, Math.max(0, shown.length - 1))

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
      const last = shown.length - 1
      if (last < 0) return
      const cols = columns()
      const moves: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: cols,
        ArrowUp: -cols
      }
      if (e.key in moves) {
        const next = focus + moves[e.key]
        // Hors de la grille : on laisse filer la touche, la navigation directionnelle prend le
        // relais (section voisine, barre latérale). Sinon le curseur reste collé au bord.
        if (next < 0 || next > last) return
        e.preventDefault()
        setFocus(next)
      } else if (e.key === 'Home') {
        e.preventDefault()
        setFocus(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setFocus(last)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onOpen(shown[focus].key)
      } else if (e.key.toLowerCase() === action.key && onPlay) {
        e.preventDefault()
        onPlay(shown[focus].key)
      }
    },
    [shown, focus, columns, onOpen, onPlay, action.key]
  )

  useEffect(() => {
    const el = ref.current?.querySelectorAll<HTMLElement>('.tile')[focus]
    if (el && ref.current?.contains(document.activeElement)) {
      focusCursor(el)
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [focus, shown])

  if (tiles.length === 0) return <div className="grid__empty">{empty ?? 'Rien à afficher.'}</div>

  return (
    <div className="grid" ref={ref} onKeyDown={onKeyDown}>
      {shown.map((t, i) => (
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
                title={action.title}
                onClick={(e) => {
                  e.stopPropagation()
                  onPlay(t.key)
                }}
              >
                {action.icon}
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
