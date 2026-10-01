import { one, run, type Database } from '../database'

/**
 * Réglages de l'application, sous forme de paires clé/valeur. Les valeurs sensibles sont
 * chiffrées en amont (voir `backend/library.ts`) : ce dépôt ne fait que les stocker.
 */

export function getRaw(db: Database, key: string): Uint8Array | null {
  return (
    one<{ value: Uint8Array | null }>(db, 'SELECT value FROM settings WHERE key = ?', key)?.value ??
    null
  )
}

export function setRaw(db: Database, key: string, value: Uint8Array | null): void {
  if (value === null) {
    run(db, 'DELETE FROM settings WHERE key = ?', key)
    return
  }
  run(
    db,
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    value as unknown as null
  )
}

export function getText(db: Database, key: string): string | null {
  const raw = getRaw(db, key)
  return raw ? Buffer.from(raw).toString('utf8') : null
}

export function setText(db: Database, key: string, value: string | null): void {
  setRaw(db, key, value === null ? null : Buffer.from(value, 'utf8'))
}
