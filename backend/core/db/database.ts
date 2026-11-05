import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations'

export type Database = DatabaseSync
export type SqlParam = string | number | bigint | null

/** SELECT renvoyant plusieurs lignes, typées par l'appelant. */
export function all<T>(db: Database, sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

/** SELECT renvoyant une ligne ou rien. */
export function one<T>(db: Database, sql: string, ...params: SqlParam[]): T | null {
  return (db.prepare(sql).get(...params) as unknown as T | undefined) ?? null
}

/** INSERT / UPDATE / DELETE : nombre de lignes affectées et dernier id inséré. */
export function run(
  db: Database,
  sql: string,
  ...params: SqlParam[]
): { changes: number; lastId: number } {
  const r = db.prepare(sql).run(...params)
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) }
}

/* Exécute `fn` dans une transaction ; rollback si elle lève. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/*
 * Ouvre (ou crée) la base et la met à jour vers la dernière version du schéma.
 * `:memory:` donne une base jetable, utilisée par les tests.
 */
export function openDatabase(file: string): Database {
  const db = new DatabaseSync(file)
  // WAL : lectures et écritures concurrentes sans blocage (le scan écrit pendant que l'UI lit)
  db.exec('PRAGMA journal_mode = WAL')
  // SQLite n'applique PAS les clés étrangères par défaut : sans ça, ON DELETE CASCADE ne fait rien
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function currentVersion(db: Database): number {
  return one<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version
}

/** Applique les migrations en attente, jusqu'à `target` (les tests s'arrêtent avant la dernière). */
export function migrate(db: Database, target = Infinity): void {
  const applied = currentVersion(db)
  const pending = migrations
    .filter((m) => m.version > applied && m.version <= target)
    .sort((a, b) => a.version - b.version)
  for (const m of pending) {
    // Ne se change pas dans une transaction : on coupe avant, on rétablit après
    if (m.rebuildsTables) db.exec('PRAGMA foreign_keys = OFF')
    // Une migration = une transaction : soit tout passe, soit rien
    try {
      transaction(db, () => {
        db.exec(m.sql)
        if (m.rebuildsTables) {
          const broken = all<{ table: string }>(db, 'PRAGMA foreign_key_check')
          if (broken.length) throw new Error(`clés étrangères rompues dans ${broken[0].table}`)
        }
        db.exec(`PRAGMA user_version = ${m.version}`)
      })
    } catch (err) {
      throw new Error(`Migration ${m.version} (${m.name}) échouée`, { cause: err })
    } finally {
      if (m.rebuildsTables) db.exec('PRAGMA foreign_keys = ON')
    }
  }
}
