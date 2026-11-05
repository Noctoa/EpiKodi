import { useEffect, useRef, useState } from 'react'
import { toMediaUrl } from '@shared/ipc'
import type { Profile } from '@shared/models'
import { focusCursor, moveFocus } from '@frontend/focus'
import { errorMessage } from '@frontend/format'
import { AVATAR_ICONS, profileHue, useProfiles } from '@frontend/profiles'
import './ProfilePicker.css'

export function ProfileAvatar({
  profile,
  avatar = profile.avatar ?? null,
  size = 'md'
}: {
  profile: Pick<Profile, 'id' | 'name'> & { avatar?: string | null }
  /** Remplace l'avatar enregistré : aperçu pendant l'édition */
  avatar?: string | null
  size?: 'sm' | 'md' | 'lg'
}): React.JSX.Element {
  const style = { '--profile-hue': profileHue(profile.id) } as React.CSSProperties
  const icon = avatar?.startsWith('icon:') ? AVATAR_ICONS[avatar.slice(5)] : undefined
  return (
    <span className={`profile-avatar profile-avatar--${size}`} style={style} aria-hidden="true">
      {icon ? (
        <span className="profile-avatar__icon">{icon}</span>
      ) : avatar ? (
        <img src={toMediaUrl(avatar)} alt="" draggable={false} />
      ) : (
        <span className="profile-avatar__initial">
          {profile.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  )
}

/** Écran « Qui regarde ? » : choix du profil, et gestion des profils du foyer. */
export function ProfilePicker(): React.JSX.Element {
  const { profiles, active, mandatory, managing, setManaging, select, closePicker } = useProfiles()
  /** Profil en cours d'édition ; `'new'` pour une création */
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const firstTile = useRef<HTMLButtonElement>(null)

  // Le curseur se pose sur le profil actif : à la manette, « OK » suffit pour continuer
  useEffect(() => {
    if (!editing && firstTile.current) focusCursor(firstTile.current)
  }, [editing, managing])

  const choose = async (profile: Profile): Promise<void> => {
    if (managing) {
      setEditing(profile)
      return
    }
    setError(null)
    try {
      await select(profile.id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  // Le profil actif en premier dans l'ordre du focus, sans changer l'ordre d'affichage
  const focusTarget = active?.id ?? profiles[0]?.id

  return (
    <div
      className="profiles"
      role="dialog"
      aria-modal="true"
      aria-label={managing ? 'Gérer les profils' : 'Choisir un profil'}
      onKeyDown={(e) => {
        if ((e.key === 'Escape' || e.key === 'Backspace') && !editing) {
          e.preventDefault()
          e.stopPropagation()
          if (managing) setManaging(false)
          else if (!mandatory) closePicker()
        }
      }}
    >
      <div className="profiles__inner">
        <p className="profiles__eyebrow">EPIKODI</p>
        <h2 className="profiles__title">{managing ? 'Gérer les profils' : 'Qui regarde ?'}</h2>

        <ul className="profiles__grid">
          {profiles.map((p) => (
            <li key={p.id}>
              <button
                ref={p.id === focusTarget ? firstTile : undefined}
                className={`profiles__tile ${p.id === active?.id ? 'profiles__tile--active' : ''}`}
                onClick={() => void choose(p)}
                aria-label={managing ? `Modifier ${p.name}` : p.name}
              >
                <ProfileAvatar profile={p} size="lg" />
                {managing && (
                  <span className="profiles__edit" aria-hidden="true">
                    ✎
                  </span>
                )}
                <span className="profiles__name">{p.name}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              className="profiles__tile profiles__tile--add"
              onClick={() => setEditing('new')}
            >
              <span className="profile-avatar profile-avatar--lg profiles__plus" aria-hidden="true">
                +
              </span>
              <span className="profiles__name">Ajouter</span>
            </button>
          </li>
        </ul>

        {error && (
          <p className="profiles__error" role="alert">
            {error}
          </p>
        )}

        <div className="profiles__actions">
          <button className="profiles__manage" onClick={() => setManaging(!managing)}>
            {managing ? 'Terminé' : 'Gérer les profils'}
          </button>
          {!mandatory && !managing && (
            <button className="btn--ghost" onClick={closePicker}>
              Annuler
            </button>
          )}
        </div>
      </div>

      {editing && (
        <ProfileEditor
          profile={editing === 'new' ? null : editing}
          canDelete={editing !== 'new' && profiles.length > 1}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ProfileEditor({
  profile,
  canDelete,
  onClose
}: {
  profile: Profile | null
  canDelete: boolean
  onClose: () => void
}): React.JSX.Element {
  const { create, update, remove } = useProfiles()
  const [name, setName] = useState(profile?.name ?? '')
  const [avatar, setAvatar] = useState<string | null>(profile?.avatar ?? 'icon:fox')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (input.current) focusCursor(input.current)
  }, [])
  useEffect(() => {
    if (confirmDelete && confirmButton.current) focusCursor(confirmButton.current)
  }, [confirmDelete])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const save = (): Promise<void> =>
    run(() => (profile ? update(profile.id, { name, avatar }) : create(name, avatar)))

  const pickImage = async (): Promise<void> => {
    const path = await window.epikodi.profilesPickAvatar()
    if (path) setAvatar(path)
  }

  const preview = { id: profile?.id ?? 0, name: name || '?' }
  const isImage = avatar !== null && !avatar.startsWith('icon:')

  return (
    <div
      className="profile-editor"
      role="dialog"
      aria-modal="true"
      aria-label={profile ? `Modifier ${profile.name}` : 'Nouveau profil'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          if (confirmDelete) setConfirmDelete(false)
          else onClose()
        }
      }}
    >
      <form
        className="profile-editor__panel"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h3>{profile ? 'Modifier le profil' : 'Nouveau profil'}</h3>

        {confirmDelete && profile ? (
          <div className="profile-editor__confirm" role="alertdialog" aria-live="assertive">
            <p>
              Supprimer <strong>{profile.name}</strong> ? Ses reprises de lecture, favoris,
              playlists, abonnements et chaînes favorites seront <strong>définitivement</strong>{' '}
              effacés. La bibliothèque, elle, reste intacte.
            </p>
            <div className="profile-editor__buttons">
              <button
                ref={confirmButton}
                type="button"
                className="btn--danger"
                disabled={busy}
                onClick={() => void run(() => remove(profile.id))}
              >
                Supprimer définitivement
              </button>
              <button type="button" className="btn--ghost" onClick={() => setConfirmDelete(false)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="profile-editor__head">
              <ProfileAvatar profile={preview} avatar={avatar} size="lg" />
              <label className="profile-editor__name">
                <span>Nom</span>
                <input
                  ref={input}
                  value={name}
                  maxLength={40}
                  placeholder="Prénom ou surnom"
                  onChange={(e) => setName(e.target.value)}
                  // Un champ de texte garde les flèches pour lui : à la manette, on en sort
                  // vers le haut ou le bas
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      moveFocus(e.key === 'ArrowDown' ? 'down' : 'up')
                    }
                  }}
                />
              </label>
            </div>

            <fieldset className="profile-editor__avatars">
              <legend>Avatar</legend>
              <div className="profile-editor__choices">
                <button
                  type="button"
                  className="profile-editor__choice"
                  aria-pressed={avatar === null}
                  title="Initiale"
                  onClick={() => setAvatar(null)}
                >
                  <ProfileAvatar profile={preview} avatar={null} size="sm" />
                </button>
                {Object.entries(AVATAR_ICONS).map(([id, emoji]) => (
                  <button
                    key={id}
                    type="button"
                    className="profile-editor__choice"
                    aria-pressed={avatar === `icon:${id}`}
                    aria-label={`Icône ${id}`}
                    onClick={() => setAvatar(`icon:${id}`)}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="profile-editor__choice profile-editor__choice--image"
                  aria-pressed={isImage}
                  onClick={() => void pickImage()}
                >
                  {isImage ? <ProfileAvatar profile={preview} avatar={avatar} size="sm" /> : '🖼'}
                  <span>Image…</span>
                </button>
              </div>
            </fieldset>

            {error && (
              <p className="profiles__error" role="alert">
                {error}
              </p>
            )}

            <div className="profile-editor__buttons">
              <button type="submit" disabled={busy || !name.trim()}>
                {profile ? 'Enregistrer' : 'Créer le profil'}
              </button>
              <button type="button" className="btn--ghost" onClick={onClose}>
                Annuler
              </button>
              {canDelete && (
                <button
                  type="button"
                  className="btn--ghost profile-editor__delete"
                  onClick={() => setConfirmDelete(true)}
                >
                  Supprimer ce profil
                </button>
              )}
            </div>
          </>
        )}
      </form>
    </div>
  )
}
