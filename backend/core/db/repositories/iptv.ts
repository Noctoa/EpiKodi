import type { IptvChannel, IptvSource } from '@shared/models'
import { all, one, run, transaction, type Database } from '../database'

interface SourceRow {
  id: number
  location: string
  name: string
  added_at: number
  last_fetch_at: number | null
  last_error: string | null
  channel_count: number
  missing_count: number
}

interface ChannelRow {
  id: number
  source_id: number
  name: string
  stream_url: string
  logo_url: string | null
  logo_path: string | null
  group_title: string | null
  epg_id: string | null
  favorite: number
  position: number
  missing_at: number | null
}

const toSource = (r: SourceRow): IptvSource => ({
  id: r.id,
  location: r.location,
  name: r.name,
  addedAt: r.added_at,
  lastFetchAt: r.last_fetch_at,
  lastError: r.last_error,
  channelCount: r.channel_count,
  missingCount: r.missing_count
})

const toChannel = (r: ChannelRow): IptvChannel => ({
  id: r.id,
  sourceId: r.source_id,
  name: r.name,
  streamUrl: r.stream_url,
  logoUrl: r.logo_url,
  logoPath: r.logo_path,
  group: r.group_title,
  epgId: r.epg_id,
  favorite: r.favorite === 1,
  position: r.position,
  missing: r.missing_at !== null
})

/** Les compteurs accompagnent toujours la source : une liste sans son nombre de chaînes ne dit rien. */
const SOURCE_SELECT = `
  SELECT s.*,
         COUNT(c.id)                                      AS channel_count,
         COUNT(c.id) FILTER (WHERE c.missing_at NOT NULL)  AS missing_count
    FROM iptv_sources s
    LEFT JOIN iptv_channels c ON c.source_id = s.id`

export function listSources(db: Database): IptvSource[] {
  return all<SourceRow>(db, `${SOURCE_SELECT} GROUP BY s.id ORDER BY s.name COLLATE NOCASE`).map(
    toSource
  )
}

export function source(db: Database, id: number): IptvSource | null {
  const row = one<SourceRow>(db, `${SOURCE_SELECT} WHERE s.id = ? GROUP BY s.id`, id)
  return row ? toSource(row) : null
}

/** Crée la source si l'emplacement est inconnu, sinon renvoie celle qui l'occupe déjà. */
export function upsertSource(db: Database, location: string, name: string): IptvSource {
  const row = one<{ id: number }>(
    db,
    `INSERT INTO iptv_sources (location, name) VALUES (?, ?)
     ON CONFLICT (location) DO UPDATE SET name = excluded.name
     RETURNING id`,
    location,
    name
  )!
  return source(db, row.id)!
}

export function removeSource(db: Database, id: number): boolean {
  return run(db, 'DELETE FROM iptv_sources WHERE id = ?', id).changes > 0
}

export function markFetched(db: Database, id: number, error: string | null = null): void {
  run(
    db,
    'UPDATE iptv_sources SET last_fetch_at = unixepoch(), last_error = ? WHERE id = ?',
    error,
    id
  )
}

// ---- chaînes ----

export interface ChannelInput {
  /** Identité d'un rafraîchissement à l'autre : l'URL du flux (voir la migration 9) */
  key: string
  name: string
  streamUrl: string
  logoUrl: string | null
  group: string | null
  epgId: string | null
}

export interface SyncResult {
  added: number
  /** Chaînes connues qui ne figurent plus dans la playlist */
  missing: number
  total: number
}

/**
 * Mise à jour différentielle. Toutes les chaînes de la source sont marquées absentes d'abord,
 * puis chaque chaîne lue les démarque : ce qui reste marqué à la fin est précisément ce qui a
 * disparu. Procéder dans cet ordre évite de comparer des horodatages — deux rafraîchissements
 * dans la même seconde rendraient la comparaison aveugle.
 *
 * Rien n'est jamais supprimé : une chaîne retirée par le fournisseur peut revenir, et sa ligne
 * porte ce que l'utilisateur en a fait. Le favori, lui, n'est pas touché.
 */
export function syncChannels(db: Database, sourceId: number, channels: ChannelInput[]): SyncResult {
  return transaction(db, () => {
    const before = count(db, sourceId)
    run(
      db,
      'UPDATE iptv_channels SET missing_at = unixepoch() WHERE source_id = ? AND missing_at IS NULL',
      sourceId
    )

    let position = 0
    for (const c of channels) {
      run(
        db,
        `INSERT INTO iptv_channels
           (source_id, channel_key, name, stream_url, logo_url, group_title, epg_id, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source_id, channel_key) DO UPDATE SET
           name        = excluded.name,
           stream_url  = excluded.stream_url,
           logo_url    = COALESCE(excluded.logo_url, iptv_channels.logo_url),
           group_title = excluded.group_title,
           epg_id      = excluded.epg_id,
           position    = excluded.position,
           seen_at     = unixepoch(),
           missing_at  = NULL`,
        sourceId,
        c.key,
        c.name,
        c.streamUrl,
        c.logoUrl,
        c.group,
        c.epgId,
        position++
      )
    }

    const total = count(db, sourceId)
    return { added: total - before, missing: missingCount(db, sourceId), total }
  })
}

export interface ChannelQuery {
  sourceId?: number
  group?: string
  search?: string
  /** Inclure les chaînes disparues de la playlist (exclues par défaut) */
  includeMissing?: boolean
  favoritesOnly?: boolean
  limit?: number
  offset?: number
}

/**
 * Les favorites remontent en tête, puis l'ordre de la playlist. La recherche porte sur le nom :
 * une liste de chaînes est trop petite pour justifier un index plein texte à elle seule.
 */
export function channels(db: Database, query: ChannelQuery = {}): IptvChannel[] {
  const where: string[] = []
  const params: (string | number)[] = []

  if (query.sourceId !== undefined) {
    where.push('source_id = ?')
    params.push(query.sourceId)
  }
  if (query.group !== undefined) {
    where.push('group_title = ?')
    params.push(query.group)
  }
  if (query.search?.trim()) {
    where.push('name LIKE ? ESCAPE ' + "'\\'")
    params.push(`%${escapeLike(query.search.trim())}%`)
  }
  if (!query.includeMissing) where.push('missing_at IS NULL')
  if (query.favoritesOnly) where.push('favorite = 1')

  params.push(query.limit ?? 500, query.offset ?? 0)
  return all<ChannelRow>(
    db,
    `SELECT * FROM iptv_channels
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY favorite DESC, position, name COLLATE NOCASE
     LIMIT ? OFFSET ?`,
    ...params
  ).map(toChannel)
}

/** `%` et `_` sont des jokers en SQL : tapés dans la recherche, ils doivent rester littéraux. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function channel(db: Database, id: number): IptvChannel | null {
  const row = one<ChannelRow>(db, 'SELECT * FROM iptv_channels WHERE id = ?', id)
  return row ? toChannel(row) : null
}

/** Sert à retrouver la chaîne derrière une URL jouée, comme pour les épisodes de podcast. */
export function channelByUrl(db: Database, url: string): IptvChannel | null {
  const row = one<ChannelRow>(db, 'SELECT * FROM iptv_channels WHERE stream_url = ? LIMIT 1', url)
  return row ? toChannel(row) : null
}

/** Rubriques et effectifs, pour le filtre par groupe. Les chaînes sans rubrique sont omises. */
export function groups(db: Database, sourceId?: number): { group: string; count: number }[] {
  return all<{ group_title: string; n: number }>(
    db,
    `SELECT group_title, COUNT(*) AS n FROM iptv_channels
      WHERE missing_at IS NULL AND group_title IS NOT NULL
        ${sourceId === undefined ? '' : 'AND source_id = ?'}
      GROUP BY group_title ORDER BY group_title COLLATE NOCASE`,
    ...(sourceId === undefined ? [] : [sourceId])
  ).map((r) => ({ group: r.group_title, count: r.n }))
}

export function setFavorite(db: Database, id: number, favorite: boolean): void {
  run(db, 'UPDATE iptv_channels SET favorite = ? WHERE id = ?', favorite ? 1 : 0, id)
}

export function setLogoPath(db: Database, id: number, path: string | null): void {
  run(db, 'UPDATE iptv_channels SET logo_path = ? WHERE id = ?', path, id)
}

/** Chaînes dont le logo n'est pas encore en cache, favorites d'abord : on cache ce qui se verra. */
export function withoutLogo(db: Database, sourceId: number, limit: number): IptvChannel[] {
  return all<ChannelRow>(
    db,
    `SELECT * FROM iptv_channels
      WHERE source_id = ? AND missing_at IS NULL AND logo_path IS NULL AND logo_url IS NOT NULL
      ORDER BY favorite DESC, position LIMIT ?`,
    sourceId,
    limit
  ).map(toChannel)
}

export function count(db: Database, sourceId: number): number {
  return one<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM iptv_channels WHERE source_id = ?',
    sourceId
  )!.n
}

export function missingCount(db: Database, sourceId: number): number {
  return one<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM iptv_channels WHERE source_id = ? AND missing_at IS NOT NULL',
    sourceId
  )!.n
}
