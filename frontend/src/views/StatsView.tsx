import { useEffect, useRef, useState } from 'react'
import type { PlayKind, ProfileStats, StatBucket } from '@shared/models'
import { ProfileAvatar } from '@frontend/components/ProfilePicker'
import { errorMessage } from '@frontend/format'
import { useProfiles } from '@frontend/profiles'
import './StatsView.css'

const KIND_LABELS: Record<PlayKind, string> = {
  video: 'Vidéos',
  audio: 'Musique',
  podcast: 'Podcasts',
  live: 'TV en direct'
}

/** Temps cumulé lisible d'un coup d'œil : « 42 s », « 18 min », « 12 h 05 ». */
export function fmtTotal(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m === 60 ? `${h + 1} h` : `${h} h ${String(m).padStart(2, '0')}`
}

const monthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short' })
const monthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const monthDate = (key: string): Date => new Date(Number(key.slice(0, 4)), Number(key.slice(5)) - 1)

/** Statistiques du profil actif, calculées à partir du journal de lecture. */
export function StatsView(): React.JSX.Element {
  const { profiles, active } = useProfiles()
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const confirmButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    window.epikodi
      .statsGet()
      .then((s) => !cancelled && setStats(s))
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (confirmReset) confirmButton.current?.focus()
  }, [confirmReset])

  if (error) return <div className="grid__empty">Statistiques indisponibles : {error}</div>
  if (!stats) return <div className="grid__empty">Chargement…</div>

  const empty = stats.totalSeconds === 0
  const byId = new Map(profiles.map((p) => [p.id, p]))

  const reset = async (): Promise<void> => {
    setStats(await window.epikodi.statsReset())
    setConfirmReset(false)
  }

  return (
    <div className="stats">
      <section className="stats__tiles" aria-label="Résumé">
        <div className="stats__tile">
          <span className="stats__tile-label">Temps de lecture</span>
          <strong className="stats__tile-value">{fmtTotal(stats.totalSeconds)}</strong>
        </div>
        <div className="stats__tile">
          <span className="stats__tile-label">Lectures</span>
          <strong className="stats__tile-value">{stats.plays}</strong>
          <span className="stats__tile-hint">d’au moins 30 secondes</span>
        </div>
        <div className="stats__tile">
          <span className="stats__tile-label">Depuis le</span>
          <strong className="stats__tile-value stats__tile-value--small">
            {stats.since ? dayFmt.format(stats.since * 1000) : '—'}
          </strong>
        </div>
      </section>

      {empty && (
        <div className="grid__empty">
          {active?.name ?? 'Ce profil'} n’a encore rien regardé ni écouté. Les chiffres se
          remplissent au fil des lectures : seul compte le temps réellement passé à lire, pas
          l’ouverture d’une fiche.
        </div>
      )}

      {!empty && (
        <>
          <section className="stats__panel stats__panel--wide">
            <h3 className="stats__heading">Par mois</h3>
            <MonthChart months={stats.byMonth} />
          </section>

          <div className="stats__columns">
            <section className="stats__panel">
              <h3 className="stats__heading">Par type</h3>
              <BarList
                rows={stats.byKind.map((b) => ({
                  key: b.key,
                  label: KIND_LABELS[b.key as PlayKind] ?? b.key,
                  seconds: b.seconds
                }))}
              />
            </section>
            <section className="stats__panel">
              <h3 className="stats__heading">Par genre</h3>
              {stats.byGenre.length === 0 ? (
                <p className="stats__none">Aucun genre connu pour ce qui a été lu.</p>
              ) : (
                <BarList rows={stats.byGenre.map((b) => ({ ...b, label: b.key }))} />
              )}
            </section>
          </div>

          <div className="stats__columns">
            <section className="stats__panel">
              <h3 className="stats__heading">Les plus lus</h3>
              {stats.topMedia.length === 0 ? (
                <p className="stats__none">Pas encore de lecture complète.</p>
              ) : (
                <ol className="stats__top">
                  {stats.topMedia.map((m, i) => (
                    <li key={`${m.kind}-${m.title}-${m.artist}-${i}`}>
                      <span className="stats__rank">{i + 1}</span>
                      <span className="stats__top-title">
                        {m.title}
                        <small>{[KIND_LABELS[m.kind], m.artist].filter(Boolean).join(' · ')}</small>
                      </span>
                      <span className="stats__top-value">
                        {fmtTotal(m.seconds)}
                        <small>
                          {m.plays} lecture{m.plays > 1 ? 's' : ''}
                        </small>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className="stats__panel">
              <h3 className="stats__heading">Artistes les plus écoutés</h3>
              {stats.topArtists.length === 0 ? (
                <p className="stats__none">Aucune musique écoutée pour l’instant.</p>
              ) : (
                <ol className="stats__top">
                  {stats.topArtists.map((a, i) => (
                    <li key={a.artist}>
                      <span className="stats__rank">{i + 1}</span>
                      <span className="stats__top-title">{a.artist}</span>
                      <span className="stats__top-value">
                        {fmtTotal(a.seconds)}
                        <small>
                          {a.plays} écoute{a.plays > 1 ? 's' : ''}
                        </small>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </>
      )}

      {stats.household.length > 1 && (
        <section className="stats__panel">
          <h3 className="stats__heading">Dans le foyer</h3>
          <BarList
            rows={stats.household.map((h) => ({
              key: String(h.profileId),
              label: byId.get(h.profileId)?.name ?? 'Profil',
              seconds: h.seconds,
              hint: `${h.plays} lecture${h.plays > 1 ? 's' : ''}`,
              current: h.profileId === stats.profileId,
              lead: byId.get(h.profileId) && (
                <ProfileAvatar profile={byId.get(h.profileId)!} size="sm" />
              )
            }))}
          />
        </section>
      )}

      <section className="stats__reset">
        {confirmReset ? (
          <div className="stats__confirm" role="alertdialog" aria-label="Remise à zéro">
            <p>
              Effacer tout le journal de lecture de <strong>{active?.name}</strong> ? Les
              statistiques repartent de zéro ; reprises, favoris et watchlist ne changent pas.
            </p>
            <div className="stats__confirm-buttons">
              <button ref={confirmButton} className="stats__danger" onClick={() => void reset()}>
                Remettre à zéro
              </button>
              <button className="btn--ghost" onClick={() => setConfirmReset(false)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn--ghost"
            disabled={empty}
            onClick={() => setConfirmReset(true)}
            title="Efface le journal de lecture de ce profil"
          >
            Remettre mes statistiques à zéro
          </button>
        )}
      </section>
    </div>
  )
}

interface BarRow {
  key: string
  label: string
  seconds: number
  hint?: string
  /** Mise en avant : le profil actif dans la comparaison du foyer */
  current?: boolean
  lead?: React.ReactNode
}

/**
 * Barres horizontales, une teinte : la valeur est écrite à côté de chaque barre, l'identité
 * portée par le libellé — jamais par la couleur seule.
 */
function BarList({ rows }: { rows: BarRow[] }): React.JSX.Element {
  const max = Math.max(...rows.map((r) => r.seconds), 1)
  return (
    <ul className="stats__bars">
      {rows.map((r) => (
        <li key={r.key} className={r.current ? 'stats__bar--current' : undefined}>
          <span className="stats__bar-label">
            {r.lead}
            {r.label}
          </span>
          <span className="stats__bar-track" aria-hidden="true">
            <span
              className="stats__bar-fill"
              style={{ width: `${r.seconds > 0 ? Math.max((r.seconds / max) * 100, 1.5) : 0}%` }}
            />
          </span>
          <span className="stats__bar-value">
            {fmtTotal(r.seconds)}
            {r.hint && <small>{r.hint}</small>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Douze colonnes, une teinte ; le détail d'un mois au survol, et lu par les lecteurs d'écran. */
function MonthChart({ months }: { months: StatBucket[] }): React.JSX.Element {
  const max = Math.max(...months.map((m) => m.seconds), 1)
  const peak = months.reduce((a, b) => (b.seconds > a.seconds ? b : a), months[0])
  return (
    <div className="stats__months" role="list">
      {months.map((m) => {
        const label = `${monthLong.format(monthDate(m.key))} : ${m.seconds > 0 ? fmtTotal(m.seconds) : 'rien'}`
        return (
          <div
            key={m.key}
            className="stats__month"
            role="listitem"
            aria-label={label}
            title={label}
          >
            <span className="stats__month-value" aria-hidden="true">
              {m === peak && m.seconds > 0 ? fmtTotal(m.seconds) : ''}
            </span>
            <span className="stats__month-track" aria-hidden="true">
              <span
                className="stats__month-fill"
                style={{ height: `${m.seconds > 0 ? Math.max((m.seconds / max) * 100, 2) : 0}%` }}
              />
            </span>
            <span className="stats__month-label" aria-hidden="true">
              {monthShort.format(monthDate(m.key)).replace('.', '')}
            </span>
          </div>
        )
      })}
    </div>
  )
}
