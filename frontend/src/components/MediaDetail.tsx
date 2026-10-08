import { useState } from 'react'
import { toMediaUrl } from '@shared/ipc'
import type { MediaWithMetadata, Source } from '@shared/models'
import { fmtBitrate, fmtDurationLong, fmtResolution, fmtSize } from '@frontend/format'
import { MatchPicker } from './MatchPicker'
import './MediaDetail.css'

interface Props {
  media: MediaWithMetadata
  source?: Source
  onPlay: () => void
  onEnqueue?: () => void
  onPlayNext?: () => void
  /** Appelé après une correction manuelle, pour recharger les informations affichées */
  onIdentified?: () => void
}

function Row({
  label,
  value
}: {
  label: string
  value: React.ReactNode
}): React.JSX.Element | null {
  if (value === null || value === undefined || value === '') return null
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

export function MediaDetail({
  media,
  source,
  onPlay,
  onEnqueue,
  onPlayNext,
  onIdentified
}: Props): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const md = media.metadata
  // Une affiche de film est en portrait (2:3), une miniature extraite de la vidéo en 16/9 :
  // le cadre s'adapte au format réel, sinon l'affiche serait rognée en haut et en bas.
  const poster = md?.posterPath ?? null
  const thumb = poster ?? md?.thumbnailPath ?? null
  const isAudio = media.type === 'audio'

  return (
    <div className="detail">
      <div
        className={[
          'detail__art',
          isAudio ? 'detail__art--square' : '',
          poster ? 'detail__art--poster' : ''
        ].join(' ')}
      >
        {thumb ? (
          <img src={toMediaUrl(thumb)} alt="" />
        ) : (
          <span className="detail__icon">{isAudio ? '♪' : '▶'}</span>
        )}
      </div>

      <div className="detail__body">
        <h2 className="detail__title">{media.title}</h2>
        {isAudio && (md?.artist || md?.album) && (
          <p className="detail__byline">
            {[md?.artist, md?.album, md?.year].filter(Boolean).join(' · ')}
          </p>
        )}
        {md?.overview && <p className="detail__overview">{md.overview}</p>}

        {!isAudio && md?.rating !== null && md?.rating !== undefined && (
          <p className="detail__rating">
            <strong>{md.rating.toFixed(1)}</strong> / 10
            {md.genre && <span className="detail__genres"> · {md.genre}</span>}
          </p>
        )}

        <div className="detail__actions">
          <button onClick={onPlay}>▶ Lire</button>
          {isAudio && onPlayNext && (
            <button className="btn--ghost" onClick={onPlayNext}>
              ⤴ Lire ensuite
            </button>
          )}
          {isAudio && onEnqueue && (
            <button className="btn--ghost" onClick={onEnqueue}>
              + Ajouter à la file
            </button>
          )}
          {!isAudio && (
            <button className="btn--ghost" onClick={() => setPicking(true)}>
              ⌕ Corriger l'identification
            </button>
          )}
        </div>

        {md && md.cast.length > 0 && (
          <p className="detail__cast">
            <span className="detail__cast-label">Avec</span> {md.cast.join(', ')}
          </p>
        )}

        <dl className="detail__meta">
          <Row label="Type" value={media.type === 'video' ? 'Vidéo' : 'Audio'} />
          <Row label="Durée" value={fmtDurationLong(media.duration)} />
          <Row label="Résolution" value={fmtResolution(md?.height ?? null)} />
          <Row label="Codec vidéo" value={md?.videoCodec?.toUpperCase()} />
          <Row label="Codec audio" value={md?.audioCodec?.toUpperCase()} />
          <Row label="Débit" value={fmtBitrate(md?.bitrate ?? null)} />
          <Row label="Conteneur" value={md?.container} />
          <Row label="Genre" value={md?.genre} />
          <Row label="Piste" value={md?.track} />
          <Row label="Taille" value={fmtSize(media.size)} />
          <Row label="Durée annoncée" value={md?.runtime ? `${md.runtime} min` : null} />
          <Row label="Fiche" value={md?.externalId} />
          <Row label="Source" value={source?.name} />
          <Row label="Fichier" value={<code className="detail__path">{media.path}</code>} />
          {media.probedAt === null && <Row label="Analyse" value="en attente de ffprobe" />}
        </dl>
      </div>
      {picking && (
        <MatchPicker
          mediaId={media.id}
          initialQuery={media.title}
          onClose={() => setPicking(false)}
          onApplied={() => onIdentified?.()}
        />
      )}
    </div>
  )
}
