import type { Source, SourceType } from '@shared/models'
import { all, one, run, type Database } from '../database'

interface Row {
  id: number
  type: SourceType
  path: string
  name: string
  created_at: number
  last_scan_at: number | null
}

const toSource = (r: Row): Source => ({
  id: r.id,
  type: r.type,
  path: r.path,
  name: r.name,
  createdAt: r.created_at,
  lastScanAt: r.last_scan_at
})

export function list(db: Database): Source[] {
  return all<Row>(db, 'SELECT * FROM sources ORDER BY name').map(toSource)
}

export function get(db: Database, id: number): Source | null {
  const row = one<Row>(db, 'SELECT * FROM sources WHERE id = ?', id)
  return row ? toSource(row) : null
}

export function create(
  db: Database,
  input: { type: SourceType; path: string; name: string }
): Source {
  const { lastId } = run(
    db,
    'INSERT INTO sources (type, path, name) VALUES (?, ?, ?)',
    input.type,
    input.path,
    input.name
  )
  return get(db, lastId)!
}

export function remove(db: Database, id: number): boolean {
  return run(db, 'DELETE FROM sources WHERE id = ?', id).changes > 0
}

export function markScanned(db: Database, id: number, at = Math.floor(Date.now() / 1000)): void {
  run(db, 'UPDATE sources SET last_scan_at = ? WHERE id = ?', at, id)
}
