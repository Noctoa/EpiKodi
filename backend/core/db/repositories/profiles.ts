import type { Profile } from '@shared/models'
import { all, one, run, type Database } from '../database'

/**
 * Les personnes qui partagent la machine. Chaque donnée personnelle (reprises, favoris,
 * playlists, podcasts, chaînes favorites, réglages) porte un `profile_id` et disparaît avec
 * son profil, par cascade. La bibliothèque elle-même n'appartient à personne.
 */

interface Row {
  id: number
  name: string
  avatar: string | null
  created_at: number
}

const toProfile = (r: Row): Profile => ({
  id: r.id,
  name: r.name,
  avatar: r.avatar,
  createdAt: r.created_at
})

export function list(db: Database): Profile[] {
  return all<Row>(db, 'SELECT * FROM profiles ORDER BY created_at, id').map(toProfile)
}

export function get(db: Database, id: number): Profile | null {
  const row = one<Row>(db, 'SELECT * FROM profiles WHERE id = ?', id)
  return row ? toProfile(row) : null
}

export function count(db: Database): number {
  return one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM profiles')!.n
}

export function create(db: Database, name: string, avatar: string | null = null): Profile {
  const { lastId } = run(db, 'INSERT INTO profiles (name, avatar) VALUES (?, ?)', name, avatar)
  return get(db, lastId)!
}

export function update(
  db: Database,
  id: number,
  patch: { name?: string; avatar?: string | null }
): void {
  run(
    db,
    `UPDATE profiles SET
       name   = COALESCE(?, name),
       avatar = CASE WHEN ? THEN ? ELSE avatar END
     WHERE id = ?`,
    patch.name ?? null,
    patch.avatar === undefined ? 0 : 1,
    patch.avatar ?? null,
    id
  )
}

/**
 * Supprime le profil et, par cascade, toutes ses données. Le dernier profil ne peut pas partir :
 * l'application a toujours quelqu'un à qui rattacher ce qui se passe.
 */
export function remove(db: Database, id: number): boolean {
  if (count(db) <= 1) throw new Error('Impossible de supprimer le dernier profil.')
  return run(db, 'DELETE FROM profiles WHERE id = ?', id).changes > 0
}

// ---- réglages propres au profil ----

export function getSetting(db: Database, profileId: number, key: string): string | null {
  return (
    one<{ value: string | null }>(
      db,
      'SELECT value FROM profile_settings WHERE profile_id = ? AND key = ?',
      profileId,
      key
    )?.value ?? null
  )
}

export function setSetting(
  db: Database,
  profileId: number,
  key: string,
  value: string | null
): void {
  if (value === null) {
    run(db, 'DELETE FROM profile_settings WHERE profile_id = ? AND key = ?', profileId, key)
    return
  }
  run(
    db,
    `INSERT INTO profile_settings (profile_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (profile_id, key) DO UPDATE SET value = excluded.value`,
    profileId,
    key,
    value
  )
}
