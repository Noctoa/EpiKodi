import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { epg, iptv, openDatabase, type Database } from '.'
import { importGuide } from '../iptv/epg'
import { parseChannels } from '../iptv/service'

let db: Database
let guideId: number

/** Mardi 28 octobre 2026, 20 h 00 à Paris (UTC+1 depuis le passage à l'heure d'hiver). */
const NOW = Date.parse('2026-10-28T19:00:00Z') / 1000

/** Identifiants à la manière d'iptv-org : suffixés du flux, que les guides n'écrivent pas. */
const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="TF1.fr@SD",TF1
https://flux.example/tf1.m3u8
#EXTINF:-1 tvg-id="France2.fr@HD",France 2
https://flux.example/f2.m3u8
#EXTINF:-1 tvg-id="ChaineLocale.fr@SD",Chaîne locale
https://flux.example/locale.m3u8
#EXTINF:-1,Sans identifiant
https://flux.example/anonyme.m3u8
`

const programme = (channel: string, start: string, stop: string | null, title: string): string =>
  `<programme start="${start}"${stop ? ` stop="${stop}"` : ''} channel="${channel}">` +
  `<title lang="fr">${title}</title></programme>`

/** Un petit guide : TF1 en heure de Paris, France 2 en UTC, une chaîne que personne n'a. */
const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="TF1.fr"><display-name>TF1</display-name></channel>
  <channel id="France2.fr"><display-name>France 2</display-name></channel>
  <channel id="Inconnue.fr"><display-name>Inconnue</display-name></channel>
  ${programme('TF1.fr', '20261027200000 +0100', '20261027210000 +0100', 'Hier soir')}
  ${programme('TF1.fr', '20261028195000 +0100', '20261028210500 +0100', 'Journal de 20 h')}
  ${programme('TF1.fr', '20261028210500 +0100', null, 'Film du soir')}
  ${programme('TF1.fr', '20261028233000 +0100', '20261029010000 +0100', 'Magazine')}
  ${programme('TF1.fr', '20261115200000 +0100', '20261115210000 +0100', 'Dans trois semaines')}
  ${programme('France2.fr', '20261028185500', '20261028203000', 'Journal de France 2')}
  ${programme('Inconnue.fr', '20261028190000 +0100', '20261028200000 +0100', 'Personne')}
</tv>`

const bytes = (content: string | Buffer): Readable => Readable.from([Buffer.from(content)])

beforeEach(() => {
  db = openDatabase(':memory:')
  const sourceId = iptv.upsertSource(db, 'https://liste.example/fr.m3u', 'fr').id
  iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
  guideId = epg.upsertGuide(db, 'https://guide.example/fr.xml.gz', 'fr').id
})

const titles = (key: string, from = NOW - 86400, to = NOW + 30 * 86400): string[] =>
  epg.programmes(db, key, from, to).map((p) => p.title)

describe('importGuide', () => {
  it('rattache le guide aux chaînes malgré le suffixe de flux d’iptv-org', async () => {
    await importGuide(db, guideId, bytes(gzipSync(GUIDE)), { now: NOW })
    expect(epg.guide(db, guideId)).toMatchObject({ matchedCount: 2 })
    expect(titles('tf1.fr')).toContain('Journal de 20 h')
    expect(titles('france2.fr')).toEqual(['Journal de France 2'])
  })

  it('lit un guide compressé comme un guide en clair', async () => {
    const compressed = await importGuide(db, guideId, bytes(gzipSync(GUIDE)), { now: NOW })
    const plain = await importGuide(db, guideId, bytes(GUIDE), { now: NOW })
    expect(plain).toEqual(compressed)
  })

  it('place les programmes au bon instant, quel que soit le fuseau déclaré', async () => {
    await importGuide(db, guideId, bytes(GUIDE), { now: NOW })
    // À 20 h à Paris : TF1 (écrit en +0100) et France 2 (écrit en UTC) diffusent leur journal
    const at = (key: string): string | undefined =>
      epg.programmes(db, key, NOW, NOW + 1).map((p) => p.title)[0]
    expect(at('tf1.fr')).toBe('Journal de 20 h')
    expect(at('france2.fr')).toBe('Journal de France 2')
    expect(epg.programmes(db, 'tf1.fr', NOW, NOW + 1)[0].start).toBe(
      Date.parse('2026-10-28T18:50:00Z') / 1000
    )
  })

  it('ne garde que les chaînes importées et la fenêtre utile', async () => {
    const result = await importGuide(db, guideId, bytes(GUIDE), { now: NOW })
    expect(result.channels).toBe(3)
    expect(titles('inconnue.fr')).toEqual([])
    // « Hier soir » est fini depuis longtemps, « Dans trois semaines » est hors de portée
    expect(titles('tf1.fr')).toEqual(['Journal de 20 h', 'Film du soir', 'Magazine'])
    expect(result.programmes).toBe(4)
  })

  it('donne à un programme sans fin annoncée le début du suivant', async () => {
    await importGuide(db, guideId, bytes(GUIDE), { now: NOW })
    const film = epg
      .programmes(db, 'tf1.fr', NOW, NOW + 86400)
      .find((p) => p.title === 'Film du soir')
    expect(film?.stop).toBe(Date.parse('2026-10-28T22:30:00Z') / 1000)
  })

  it('remplace l’ancien guide sans doublon, et oublie ce qu’il ne contient plus', async () => {
    await importGuide(db, guideId, bytes(GUIDE), { now: NOW })
    const updated = GUIDE.replace('Magazine', 'Magazine (rediffusion)').replace(
      /<programme[^>]*channel="France2\.fr">.*?<\/programme>/,
      ''
    )
    await importGuide(db, guideId, bytes(updated), { now: NOW })
    expect(titles('tf1.fr')).toEqual(['Journal de 20 h', 'Film du soir', 'Magazine (rediffusion)'])
    expect(titles('france2.fr')).toEqual([])
  })

  it('n’efface rien quand le nouveau guide est illisible', async () => {
    await importGuide(db, guideId, bytes(GUIDE), { now: NOW })
    await expect(
      importGuide(db, guideId, bytes('<html>Erreur 500</html>'), { now: NOW })
    ).rejects.toThrow(/pas un guide/)
    expect(titles('tf1.fr')).toHaveLength(3)
  })

  it('tolère une playlist dont aucune chaîne n’a de guide', async () => {
    const other = openDatabase(':memory:')
    const sourceId = iptv.upsertSource(other, 'https://l.example/x.m3u', 'x').id
    iptv.syncChannels(other, sourceId, parseChannels('#EXTM3U\n#EXTINF:-1,Rien\nhttps://f/x'))
    const id = epg.upsertGuide(other, 'https://g.example/g.xml', 'g').id
    await expect(importGuide(other, id, bytes(GUIDE), { now: NOW })).resolves.toEqual({
      channels: 3,
      programmes: 0
    })
  })
})

describe('purgePast', () => {
  it('supprime ce qui est fini et garde ce qui vient de l’être', async () => {
    await importGuide(db, guideId, bytes(GUIDE), { now: NOW })
    // Le lendemain à 1 h 30 (Paris) : le journal et le film sont finis depuis plus d'une heure
    const later = Date.parse('2026-10-29T00:30:00Z') / 1000
    expect(epg.purgePast(db, later)).toBe(3)
    expect(titles('tf1.fr', later - 7200, later + 86400)).toEqual(['Magazine'])
  })
})

describe('migration 11', () => {
  it('donne leur clé de guide aux chaînes déjà importées', () => {
    // Les chaînes de la playlist ont été écrites par syncChannels ; la migration fait le même
    // calcul en SQL pour celles qui existaient avant elle.
    const keys = iptv.channels(db).map((c) => [c.name, c.epgId])
    expect(keys).toContainEqual(['TF1', 'TF1.fr@SD'])
    expect(iptv.epgKeys(db)).toEqual(new Set(['tf1.fr', 'france2.fr', 'chainelocale.fr']))
  })
})
