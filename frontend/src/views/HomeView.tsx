import { toMediaUrl } from '@shared/ipc'
import type { ContinueItem, LibraryStats } from '@shared/ipc'
import type { MediaWithMetadata } from '@shared/models'
import { Grid, type GridTile } from '@frontend/components/Grid'
import { PersonaScene } from '@frontend/components/PersonaScene'
import type { SectionName } from '@frontend/navigation'
import makoto from '../assets/persona/makoto.webp'
import makotoBattle from '../assets/persona/makoto-battle.webp'
import aigis from '../assets/persona/aigis.webp'
import { fmtDuration } from '@frontend/format'
import { recentlyAdded } from '@frontend/library/grouping'
import './HomeView.css'

/**
 * L'accueil est une vitrine : chaque rangée s'arrête sur une ligne pleine, quelle que soit la
 * largeur de la fenêtre. On demande plus d'éléments qu'il n'en faut — la grille coupe au nombre
 * de colonnes réel — sans aller jusqu'à rendre toute la bibliothèque sur un écran très large.
 */
const CONTINUE_ROWS = 1
const RECENT_ROWS = 2
const RECENT_POOL = 60

interface Props {
  items: MediaWithMetadata[]
  /** Médias entamés mais pas terminés */
  continueWatching: ContinueItem[]
  stats: LibraryStats | null
  onOpen: (id: number) => void
  onPlay: (id: number) => void
  onAddSource: () => void
  onNavigate: (section: SectionName) => void
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

export function HomeView({
  items,
  continueWatching,
  stats,
  onOpen,
  onPlay,
  onAddSource,
  onNavigate
}: Props): React.JSX.Element {
  const recent = recentlyAdded(items, RECENT_POOL)
  const resume = continueWatching[0]
  const empty = items.length === 0

  return (
    <div className="home">
      <section className="home__hero" aria-labelledby="home-hero-title">
        <PersonaScene />
        <span className="home__hero-edition" aria-hidden="true">
          P3R / PERSONAL MEDIA SYSTEM
        </span>
        <div className="home__hero-copy">
          <p className="home__eyebrow">
            <span /> TA BIBLIOTHÈQUE, AUTREMENT.
          </p>
          <h2 id="home-hero-title">
            Change
            <br />
            <em>de rythme.</em>
          </h2>
          <p className="home__intro">
            {empty
              ? 'Tes films. Tes sons. Ton moment. Toute ta collection, dans une autre dimension.'
              : 'Le monde peut attendre. Retrouve tes films, tes sons et la suite de ton histoire.'}
          </p>
          <div className="home__hero-actions">
            {resume ? (
              <button className="home__cta" onClick={() => onPlay(resume.id)}>
                <span aria-hidden="true">▶</span> Reprendre la lecture
              </button>
            ) : (
              <button className="home__cta" onClick={onAddSource}>
                <span aria-hidden="true">＋</span>{' '}
                {empty ? 'Créer ma collection' : 'Ajouter un dossier'}
              </button>
            )}
            <span className="home__hero-note">
              {resume ? resume.title : 'Ta collection. Tes règles.'}
            </span>
          </div>
        </div>
        <span className="home__hero-word" aria-hidden="true">
          RELOAD
        </span>
      </section>
      <div className="home__ticker" aria-hidden="true">
        <span>YOUR LIFE. YOUR SOUNDTRACK.</span>
        <span>映画 / 音楽 / ライブ</span>
        <span>PRESS PLAY ↗</span>
      </div>
      {(stats || empty) && (
        <div className="home__stats">
          <span>
            <span className="home__stat-icon" aria-hidden="true">
              ▶
            </span>
            <strong>{stats?.videos ?? 0}</strong> vidéos
          </span>
          <span>
            <span className="home__stat-icon" aria-hidden="true">
              ♪
            </span>
            <strong>{stats?.audio ?? 0}</strong> pistes audio
          </span>
          <span>
            <span className="home__stat-icon" aria-hidden="true">
              ⌸
            </span>
            <strong>{stats?.sources ?? 0}</strong> sources
          </span>
        </div>
      )}
      <div className="home__portals" aria-label="Explorer la collection">
        {[
          {
            section: 'videos' as const,
            number: '01',
            title: 'Vidéos',
            label: 'CHANGER DE DÉCOR',
            image: makotoBattle
          },
          {
            section: 'music' as const,
            number: '02',
            title: 'Musique',
            label: 'TROUVER SA FRÉQUENCE',
            image: makoto
          },
          {
            section: 'tv' as const,
            number: '03',
            title: 'En direct',
            label: 'VIVRE L’INSTANT',
            image: aigis
          }
        ].map((portal) => (
          <button
            className={`home__portal home__portal--${portal.section}`}
            key={portal.section}
            onClick={() => onNavigate(portal.section)}
          >
            <span className="home__portal-number" aria-hidden="true">
              {portal.number}
            </span>
            <img src={portal.image} alt="" loading="lazy" />
            <span className="home__portal-copy">
              <small>{portal.label}</small>
              <strong>{portal.title}</strong>
            </span>
            <span className="home__portal-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        ))}
      </div>
      {empty && (
        <section className="home__welcome">
          <span className="home__welcome-index" aria-hidden="true">
            01
          </span>
          <div>
            <h3>Tout commence par ta collection.</h3>
            <p>
              Ajoute un dossier de vidéos ou de musique. EpiKodi s’occupe de l’indexer pour toi.
            </p>
          </div>
          <button className="btn--ghost" onClick={onAddSource}>
            Ajouter une source <span aria-hidden="true">↗</span>
          </button>
        </section>
      )}
      {continueWatching.length > 0 && (
        <>
          <h3 className="home__section">Continuer à regarder</h3>
          <Grid
            tiles={continueWatching.map((m) => ({
              ...tileOf(m),
              // la position remplace la durée : c'est l'information utile ici
              badge: `reprendre à ${fmtDuration(m.position)}`
            }))}
            onOpen={(k) => onOpen(Number(k))}
            onPlay={(k) => onPlay(Number(k))}
            rows={CONTINUE_ROWS}
          />
        </>
      )}

      {!empty && <h3 className="home__section">Récemment ajoutés</h3>}
      {!empty && (
        <Grid
          tiles={recent.map((m) => tileOf(m))}
          onOpen={(k) => onOpen(Number(k))}
          onPlay={(k) => onPlay(Number(k))}
          rows={RECENT_ROWS}
        />
      )}
    </div>
  )
}
