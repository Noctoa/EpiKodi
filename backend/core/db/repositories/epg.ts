import type { EpgGuide, EpgProgramme } from '@shared/models'
import { all, one, run, transaction, type Database } from '../database'

interface GuideRow {
  id: number
  location: string
  name: string
  added_at: number
  last_fetch_at: number | null
  last_error: string | null
  channel_count: number
  programme_count: number
  matched_count: number
}

interface ProgrammeRow {
  id: number
  channel_key: string
  start: number
  stop: number | null
  next_start: number | null
  title: string
  subtitle: string | null
  description: string | null
  category: string | null
  icon_url: string | null
  episode: string | null
}

const toGuide = (r: GuideRow): EpgGuide => ({
  id: r.id,
  location: r.location,
  name: r.name,
  addedAt: r.added_at,
  lastFetchAt: r.last_fetch_at,
  lastError: r.last_error,
  channelCount: r.channel_count,
  programmeCount: r.programme_count,
  matchedCount: r.matched_count
})

/** Sans fin annoncée, un programme dure jusqu'au suivant ; le dernier, faute de mieux, une heure. */
const FALLBACK_DURATION = 3600

const toProgramme = (r: ProgrammeRow): EpgProgramme => ({
  id: r.id,
  channelKey: r.channel_key,
  start: r.start,
  stop: r.stop ?? r.next_start ?? r.start + FALLBACK_DURATION,
  title: r.title,
  subtitle: r.subtitle,
  description: r.description,
  category: r.category,
  iconUrl: r.icon_url,
  episode: r.episode
})

/**
 * Les compteurs accompagnent toujours le guide. « Rattachées » compte les chaînes des playlists
 * qui ont au moins un programme : c'est ce que l'utilisateur veut savoir d'un guide.
 */
const GUIDE_SELECT = `
  SELECT g.*,
         (SELECT COUNT(*) FROM epg_programmes p WHERE p.guide_id = g.id) AS programme_count,
         (SELECT COUNT(DISTINCT c.id) FROM iptv_channels c
           WHERE c.missing_at IS NULL AND c.epg_key IN
                 (SELECT DISTINCT channel_key FROM epg_programmes p WHERE p.guide_id = g.id))
           AS matched_count
    FROM epg_guides g`

export function listGuides(db: Database): EpgGuide[] {
  return all<GuideRow>(db, `${GUIDE_SELECT} ORDER BY g.name COLLATE NOCASE`).map(toGuide)
}

export function guide(db: Database, id: number): EpgGuide | null {
  const row = one<GuideRow>(db, `${GUIDE_SELECT} WHERE g.id = ?`, id)
  return row ? toGuide(row) : null
}

/** Crée le guide si l'emplacement est inconnu, sinon renvoie celui qui l'occupe déjà. */
export function upsertGuide(db: Database, location: string, name: string): EpgGuide {
  const row = one<{ id: number }>(
    db,
    `INSERT INTO epg_guides (location, name) VALUES (?, ?)
     ON CONFLICT (location) DO UPDATE SET name = epg_guides.name
     RETURNING id`,
    location,
    name
  )!
  return guide(db, row.id)!
}

export function removeGuide(db: Database, id: number): boolean {
  return run(db, 'DELETE FROM epg_guides WHERE id = ?', id).changes > 0
}

export function markFetched(
  db: Database,
  id: number,
  result: { error: string | null; channelCount?: number }
): void {
  run(
    db,
    `UPDATE epg_guides SET last_fetch_at = unixepoch(), last_error = ?,
            channel_count = COALESCE(?, channel_count)
      WHERE id = ?`,
    result.error,
    result.channelCount ?? null,
    id
  )
}

export interface ProgrammeInput {
  channelKey: string
  start: number
  stop: number | null
  title: string
  subtitle: string | null
  description: string | null
  category: string | null
  iconUrl: string | null
  episode: string | null
}

/**
 * Écrit une tranche de programmes du rafraîchissement `runId`, dans une seule transaction : une
 * insertion par programme hors transaction coûterait une écriture disque chacune.
 */
export function writeProgrammes(
  db: Database,
  guideId: number,
  runId: number,
  programmes: ProgrammeInput[]
): void {
  if (programmes.length === 0) return
  transaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO epg_programmes
         (guide_id, channel_key, start, stop, title, subtitle, description, category, icon_url,
          episode, run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (guide_id, channel_key, start) DO UPDATE SET
         stop = excluded.stop, title = excluded.title, subtitle = excluded.subtitle,
         description = excluded.description, category = excluded.category,
         icon_url = excluded.icon_url, episode = excluded.episode, run = excluded.run`
    )
    for (const p of programmes) {
      insert.run(
        guideId,
        p.channelKey,
        p.start,
        p.stop,
        p.title,
        p.subtitle,
        p.description,
        p.category,
        p.iconUrl,
        p.episode,
        runId
      )
    }
  })
}

/** Fin d'un rafraîchissement réussi : ce que le nouveau guide n'a pas réécrit a disparu. */
export function dropStale(db: Database, guideId: number, runId: number): number {
  return run(db, 'DELETE FROM epg_programmes WHERE guide_id = ? AND run <> ?', guideId, runId)
    .changes
}

/**
 * Purge des programmes terminés. La fin d'un programme qui n'en annonce pas est celle que montre
 * `programmes()` : le début du suivant, à défaut une heure. `graceSeconds` laisse à l'écran ce
 * qui vient de finir.
 */
export function purgePast(db: Database, now: number, graceSeconds = 3600): number {
  return run(
    db,
    `DELETE FROM epg_programmes AS p
      WHERE COALESCE(
              p.stop,
              (SELECT MIN(q.start) FROM epg_programmes q
                WHERE q.guide_id = p.guide_id AND q.channel_key = p.channel_key
                  AND q.start > p.start),
              p.start + ?
            ) < ?`,
    FALLBACK_DURATION,
    now - graceSeconds
  ).changes
}

/**
 * Programmes d'une chaîne qui chevauchent [from, to[, dans l'ordre. Quand plusieurs guides
 * couvrent la même chaîne, le premier ajouté l'emporte pour chaque créneau : deux guides
 * mélangés donneraient des programmes qui se chevauchent.
 */
export function programmes(
  db: Database,
  channelKey: string,
  from: number,
  to: number
): EpgProgramme[] {
  const rows = all<ProgrammeRow>(
    db,
    `WITH chosen AS (
       SELECT MIN(guide_id) AS guide_id FROM epg_programmes WHERE channel_key = ?
     )
     SELECT p.*,
            LEAD(p.start) OVER (ORDER BY p.start) AS next_start
       FROM epg_programmes p, chosen
      WHERE p.channel_key = ? AND p.guide_id = chosen.guide_id
        AND p.start < ?
      ORDER BY p.start`,
    channelKey,
    channelKey,
    to
  )
  // La fin effective dépend du programme suivant : elle ne se filtre qu'une fois calculée
  return rows.map(toProgramme).filter((p) => p.stop > from)
}

export function programmeCount(db: Database, guideId?: number): number {
  return one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM epg_programmes ${guideId === undefined ? '' : 'WHERE guide_id = ?'}`,
    ...(guideId === undefined ? [] : [guideId])
  )!.n
}
