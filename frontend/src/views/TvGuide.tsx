import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toImageUrl } from '@shared/ipc'
import type { EpgProgramme, IptvChannel } from '@shared/models'
import { focusCursor } from '@frontend/focus'
import { useModal } from '@frontend/hooks'
import {
  channelLogo,
  CHUNK,
  chunksBetween,
  DAY,
  fmtDay,
  fmtSlot,
  fmtTime,
  guideWindow,
  HOUR,
  localMidnight,
  nowSeconds,
  progressOf,
  rowSegments,
  segmentAt,
  timeTicks,
  visibleRange,
  type Segment,
  type TimeWindow
} from '@frontend/player/guide'
import { useTvMode } from '@frontend/tvmode'
import './TvGuide.css'

/** Échelle et tailles : plus grandes en mode TV, où la grille se lit à trois mètres. */
interface Dims {
  pxPerMinute: number
  row: number
  channel: number
  header: number
}
const DESKTOP: Dims = { pxPerMinute: 5, row: 64, channel: 200, header: 40 }
const TV: Dims = { pxPerMinute: 7, row: 92, channel: 260, header: 52 }

/** Les trous sont découpés par heure : à la manette, une flèche avance d'une heure au plus. */
const GAP_STEP = HOUR

interface Props {
  channels: IptvChannel[]
  /** Dernière chaîne regardée, mise en évidence */
  currentId?: number
  onWatch: (channel: IptvChannel) => void
}

interface Cursor {
  row: number
  /** Instant visé : il est conservé en changeant de ligne, comme dans un magazine télé */
  time: number
}

/** Ce qui a été chargé. Immuable : chaque réponse produit un nouvel état, et un rendu. */
interface Store {
  /** Par chaîne puis par identifiant : les tranches se recouvrent, un programme peut revenir */
  programmes: Map<number, Map<number, EpgProgramme>>
  /** Couples « chaîne:tranche » reçus */
  received: Set<string>
  /** Chaînes dont aucun guide ne connaît le `tvg-id` */
  noGuide: Set<number>
}

const EMPTY_STORE = (): Store => ({
  programmes: new Map(),
  received: new Set(),
  noGuide: new Set()
})

function merge(
  prev: Store,
  ids: number[],
  chunk: number,
  result: Record<number, EpgProgramme[]>
): Store {
  const next: Store = {
    programmes: new Map(prev.programmes),
    received: new Set(prev.received),
    noGuide: new Set(prev.noGuide)
  }
  for (const id of ids) {
    const list = result[id]
    if (!list) {
      next.noGuide.add(id)
      continue
    }
    const known = new Map(prev.programmes.get(id))
    for (const p of list) known.set(p.id, p)
    next.programmes.set(id, known)
    next.received.add(`${id}:${chunk}`)
  }
  return next
}

const segmentKey = (row: number, s: Segment): string =>
  `${row}:${s.programme ? `p${s.programme.id}` : `g${s.start}`}`

/**
 * Grille chaînes × temps. Seul ce qui est à l'écran est rendu et chargé : 200 chaînes sur une
 * semaine, ce sont des dizaines de milliers de programmes, dont une centaine se voient.
 */
export function TvGuide({ channels, currentId, onWatch }: Props): React.JSX.Element {
  const dims = useTvMode().enabled ? TV : DESKTOP
  const [win] = useState<TimeWindow>(() => guideWindow(nowSeconds()))
  const [now, setNow] = useState(nowSeconds)
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, top: 0, width: 0, height: 0 })

  const [store, setStore] = useState<Store>(EMPTY_STORE)
  /** Couples « chaîne:tranche » déjà demandés : on ne redemande jamais, même avant la réponse */
  const requested = useRef(new Set<string>())

  const [cursor, setCursor] = useState<Cursor>(() => ({ row: 0, time: nowSeconds() }))
  /** Le curseur a bougé au clavier : le bloc visé doit recevoir le focus dès qu'il est rendu */
  const follow = useRef(false)
  const [detail, setDetail] = useState<{ programme: EpgProgramme; channel: IptvChannel } | null>(
    null
  )

  const x = useCallback((t: number) => ((t - win.from) / 60) * dims.pxPerMinute, [win, dims])
  const timeAt = useCallback((px: number) => win.from + (px / dims.pxPerMinute) * 60, [win, dims])
  const totalWidth = dims.channel + x(win.to)
  const totalHeight = dims.header + channels.length * dims.row

  useEffect(() => {
    const timer = setInterval(() => setNow(nowSeconds()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Mesure et défilement : un seul rendu par image, quelle que soit la vitesse de la molette
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setView({
          left: el.scrollLeft,
          top: el.scrollTop,
          width: el.clientWidth,
          height: el.clientHeight
        })
      )
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [])

  const scrollToTime = useCallback(
    (t: number) => {
      // Un peu de passé à gauche : on voit ce qui vient de commencer
      scroller.current?.scrollTo({ left: Math.max(0, x(t - 30 * 60)) })
    },
    [x]
  )

  // À l'ouverture, et au passage en mode TV (l'échelle change) : retour à maintenant
  useLayoutEffect(() => {
    scrollToTime(nowSeconds())
  }, [scrollToTime])

  const timelineWidth = Math.max(0, view.width - dims.channel)
  const viewFrom = timeAt(view.left)
  const viewTo = timeAt(view.left + timelineWidth)
  const [firstRow, lastRow] = visibleRange(
    view.top,
    Math.max(0, view.height - dims.header),
    dims.row,
    channels.length,
    4
  )

  // Chargement de ce qui est à l'écran, plus une demi-tranche de chaque côté
  const firstChunk = Math.max(win.from, viewFrom - CHUNK / 2)
  const lastChunk = Math.min(win.to, viewTo + CHUNK / 2)
  useEffect(() => {
    if (view.width === 0) return
    for (const chunk of chunksBetween(firstChunk, lastChunk)) {
      const ids: number[] = []
      for (let r = firstRow; r <= lastRow; r++) {
        const channel = channels[r]
        if (!channel.epgId || store.noGuide.has(channel.id)) continue
        const key = `${channel.id}:${chunk}`
        if (requested.current.has(key)) continue
        requested.current.add(key)
        ids.push(channel.id)
      }
      if (ids.length === 0) continue
      void window.epikodi
        .epgSchedule(ids, chunk, chunk + CHUNK)
        .then((result) => setStore((prev) => merge(prev, ids, chunk, result)))
        .catch(() => {
          // Réessayé au prochain défilement
          for (const id of ids) requested.current.delete(`${id}:${chunk}`)
        })
    }
  }, [channels, store.noGuide, firstRow, lastRow, firstChunk, lastChunk, view.width])

  /** Chargée sur toute la zone visible : sinon, ses trous ne sont pas encore des trous. */
  const withoutGuide = (channel: IptvChannel): boolean =>
    !channel.epgId || store.noGuide.has(channel.id)
  const loaded = (channel: IptvChannel): boolean =>
    withoutGuide(channel) ||
    chunksBetween(firstChunk, lastChunk).every((c) => store.received.has(`${channel.id}:${c}`))

  /**
   * Blocs d'une ligne sur toute la semaine : la navigation au clavier en a besoin au-delà de
   * l'écran. Recalculé à chaque rendu, mais seulement pour les lignes visibles — quelques
   * milliers d'objets, rien de mesurable.
   */
  const segmentsOf = (row: number): Segment[] =>
    rowSegments(
      [...(store.programmes.get(channels[row]?.id)?.values() ?? [])],
      win.from,
      win.to,
      GAP_STEP
    )

  // ---- curseur ----

  const focused = (() => {
    const segments = segmentsOf(cursor.row)
    const index = segmentAt(segments, cursor.time)
    return index >= 0 ? segments[index] : null
  })()
  const focusedKey = focused ? segmentKey(cursor.row, focused) : null

  /** Ramène le bloc visé à l'écran. */
  const reveal = useCallback(
    (row: number, s: Segment) => {
      const el = scroller.current
      if (!el) return
      const pad = 2 * 30 * dims.pxPerMinute
      let { scrollLeft: left, scrollTop: top } = el
      const start = x(s.start)
      const visibleEnd = left + el.clientWidth - dims.channel
      // Un long programme déjà en partie visible n'oblige pas à défiler
      if (!(s.start < timeAt(left) && s.stop > timeAt(left))) {
        if (start < left) left = Math.max(0, start - pad)
        else if (start > visibleEnd - pad) left = start - pad
      }
      const rowTop = row * dims.row
      const rowsHeight = el.clientHeight - dims.header
      if (rowTop < top) top = rowTop
      else if (rowTop + dims.row > top + rowsHeight) top = rowTop + dims.row - rowsHeight
      el.scrollTo({ left, top })
    },
    [dims, x, timeAt]
  )

  const moveTo = (row: number, time: number): void => {
    const segments = segmentsOf(row)
    const s = segments[segmentAt(segments, time)]
    if (!s) return
    follow.current = true
    setCursor({ row, time })
    reveal(row, s)
  }

  // Le bloc visé n'existe qu'une fois défilé à l'écran : on lui donne le focus à ce moment-là
  useEffect(() => {
    if (!follow.current || !focusedKey) return
    const el = scroller.current?.querySelector<HTMLElement>(`[data-seg="${focusedKey}"]`)
    if (!el) return
    follow.current = false
    focusCursor(el)
  })

  const activate = useCallback(
    (row: number, s: Segment) => {
      const channel = channels[row]
      if (s.programme) setDetail({ programme: s.programme, channel })
      else onWatch(channel)
    },
    [channels, onWatch]
  )

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!focused || detail) return
    const segments = segmentsOf(cursor.row)
    const index = segmentAt(segments, cursor.time)
    const rowsOnScreen = Math.max(1, Math.floor((view.height - dims.header) / dims.row) - 1)
    let handled = true
    switch (e.key) {
      case 'ArrowRight':
        if (index < segments.length - 1) moveTo(cursor.row, segments[index + 1].start)
        else handled = false
        break
      case 'ArrowLeft':
        if (index > 0) moveTo(cursor.row, segments[index - 1].start)
        else handled = false
        break
      case 'ArrowDown':
        if (cursor.row < channels.length - 1) moveTo(cursor.row + 1, cursor.time)
        else handled = false
        break
      case 'ArrowUp':
        // Au bord haut, la touche file vers la barre d'outils au-dessus
        if (cursor.row > 0) moveTo(cursor.row - 1, cursor.time)
        else handled = false
        break
      case 'PageDown':
        moveTo(Math.min(channels.length - 1, cursor.row + rowsOnScreen), cursor.time)
        break
      case 'PageUp':
        moveTo(Math.max(0, cursor.row - rowsOnScreen), cursor.time)
        break
      case 'Home':
        moveTo(cursor.row, nowSeconds())
        break
      case 'Enter':
      case ' ':
        activate(cursor.row, focused)
        break
      default:
        handled = false
    }
    if (handled) e.preventDefault()
  }

  // ---- barre de navigation dans le temps ----

  const goTo = (t: number): void => {
    scrollToTime(t)
    follow.current = false
    setCursor((c) => ({ ...c, time: Math.max(t, win.from) }))
  }
  const today = localMidnight(now)
  const days = Array.from({ length: 7 }, (_, i) => today + i * DAY).filter((d) => d < win.to)

  // ---- rendu ----

  const renderFrom = viewFrom - HOUR
  const renderTo = viewTo + HOUR
  const nowX = dims.channel + x(now)
  const rows: React.JSX.Element[] = []
  for (let r = firstRow; r <= lastRow; r++) {
    const channel = channels[r]
    const ready = loaded(channel)
    const noGuide = withoutGuide(channel)
    const logo = channelLogo(channel)
    rows.push(
      <div
        key={channel.id}
        className={`guide__row ${channel.id === currentId ? 'guide__row--current' : ''}`}
        style={{ top: dims.header + r * dims.row, height: dims.row, width: totalWidth }}
      >
        <button
          className="guide__channel"
          style={{ width: dims.channel }}
          tabIndex={-1}
          onClick={() => onWatch(channel)}
          title={`Regarder ${channel.name}`}
        >
          {logo ? <img src={logo} alt="" loading="lazy" /> : <span className="guide__logo">⊡</span>}
          <span className="guide__name">{channel.name}</span>
        </button>
        {segmentsOf(r)
          .filter((s) => s.stop > renderFrom && s.start < renderTo)
          .map((s) => {
            const key = segmentKey(r, s)
            const live = s.start <= now && now < s.stop
            const p = s.programme
            return (
              <button
                key={key}
                data-seg={key}
                className={[
                  'guide__cell',
                  p ? '' : 'guide__cell--gap',
                  live ? 'guide__cell--live' : '',
                  s.stop <= now ? 'guide__cell--past' : ''
                ].join(' ')}
                style={{ left: dims.channel + x(s.start), width: x(s.stop) - x(s.start) }}
                tabIndex={key === focusedKey ? 0 : -1}
                onFocus={() => {
                  if (key !== focusedKey) setCursor({ row: r, time: s.start })
                }}
                onClick={() => {
                  setCursor({ row: r, time: s.start })
                  activate(r, s)
                }}
                title={p ? `${p.title} · ${fmtSlot(p)}` : `Regarder ${channel.name}`}
              >
                <span className="guide__label">
                  {p ? (
                    <>
                      <strong>{p.title}</strong>
                      <span>{fmtTime(p.start)}</span>
                    </>
                  ) : (
                    <span>
                      {noGuide
                        ? 'Pas de guide'
                        : !ready
                          ? '…'
                          : s.stop <= now
                            ? ''
                            : 'Non communiqué'}
                    </span>
                  )}
                </span>
                {p && live && (
                  <span
                    className="guide__progress"
                    style={{ width: `${progressOf(p, now) * 100}%` }}
                  />
                )}
              </button>
            )
          })}
      </div>
    )
  }

  const ticks = timeTicks(Math.max(win.from, renderFrom), Math.min(win.to, renderTo))

  return (
    <div className="guide">
      <div className="guide__bar">
        <button onClick={() => goTo(nowSeconds())} title="Revenir à l’heure actuelle (Début)">
          Maintenant
        </button>
        <button
          className="btn--ghost"
          onClick={() => goTo(Math.max(nowSeconds(), today + 20 * HOUR + 45 * 60))}
        >
          Ce soir
        </button>
        <span className="guide__sep" />
        {days.map((d) => (
          <button
            key={d}
            className={`btn--ghost ${localMidnight(viewFrom + HOUR) === d ? 'guide__day--on' : ''}`}
            onClick={() => goTo(d === today ? nowSeconds() : d + 8 * HOUR)}
          >
            {fmtDay(d, now)}
          </button>
        ))}
      </div>

      <div
        className="guide__scroller"
        ref={scroller}
        role="grid"
        aria-label="Guide des programmes"
        style={{ '--guide-channel': `${dims.channel}px` } as React.CSSProperties}
        aria-rowcount={channels.length}
        onKeyDown={onKeyDown}
      >
        <div className="guide__canvas" style={{ width: totalWidth, height: totalHeight }}>
          <div className="guide__head" style={{ height: dims.header, width: totalWidth }}>
            <div className="guide__corner" style={{ width: dims.channel }}>
              {fmtDay(viewFrom + HOUR, now)}
            </div>
            {ticks.map((t) => (
              <span
                key={t}
                className={`guide__tick ${localMidnight(t) === t ? 'guide__tick--day' : ''}`}
                style={{ left: dims.channel + x(t) }}
              >
                {localMidnight(t) === t ? fmtDay(t, now) : fmtTime(t)}
              </span>
            ))}
            {now >= win.from && (
              <span className="guide__now-head" style={{ left: nowX }}>
                {fmtTime(now)}
              </span>
            )}
          </div>

          {rows}

          {now >= win.from && (
            <div
              className="guide__now"
              style={{ left: nowX, top: dims.header, height: channels.length * dims.row }}
            />
          )}
        </div>
      </div>

      {channels.length === 0 && (
        <p className="grid__empty">Aucune chaîne ne correspond à ce filtre.</p>
      )}

      {detail && (
        <ProgrammeDetail
          programme={detail.programme}
          channel={detail.channel}
          now={now}
          onClose={() => setDetail(null)}
          onWatch={() => {
            setDetail(null)
            onWatch(detail.channel)
          }}
        />
      )}
    </div>
  )
}

/** Fiche d'un programme : de quoi décider de regarder, et le bouton pour le faire. */
function ProgrammeDetail({
  programme: p,
  channel,
  now,
  onClose,
  onWatch
}: {
  programme: EpgProgramme
  channel: IptvChannel
  now: number
  onClose: () => void
  onWatch: () => void
}): React.JSX.Element {
  useModal(onClose)
  const live = p.start <= now && now < p.stop
  const logo = channelLogo(channel)

  return (
    <div className="guide-detail__backdrop" onClick={onClose}>
      <div
        className="guide-detail"
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        onClick={(e) => e.stopPropagation()}
      >
        {p.iconUrl && <img className="guide-detail__image" src={toImageUrl(p.iconUrl)} alt="" />}
        <div className="guide-detail__body">
          <div className="guide-detail__channel">
            {logo && <img src={logo} alt="" />}
            <span>{channel.name}</span>
            {live && <span className="guide-detail__live">En direct</span>}
          </div>
          <h2>{p.title}</h2>
          {(p.subtitle || p.episode) && (
            <p className="guide-detail__sub">
              {[p.episode, p.subtitle].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="guide-detail__slot">
            {fmtDay(p.start, now)} · {fmtSlot(p)}
            {p.category && ` · ${p.category}`}
          </p>
          {live && (
            <div className="guide-detail__progress">
              <span style={{ width: `${progressOf(p, now) * 100}%` }} />
            </div>
          )}
          {p.description && <p className="guide-detail__desc">{p.description}</p>}
          <div className="guide-detail__actions">
            <button onClick={onWatch}>
              ▶ {live ? 'Regarder en direct' : `Regarder ${channel.name}`}
            </button>
            <button className="btn--ghost" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
