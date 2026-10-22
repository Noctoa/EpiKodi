import { beforeEach, describe, expect, it } from 'vitest'
import { iptv, openDatabase, type Database } from '.'
import { parseChannels, suggestName } from '../iptv/service'

let db: Database
let sourceId: number

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="FR.TF1" tvg-name="TF1" tvg-logo="https://img/tf1.png" group-title="Généralistes",TF1 HD
https://flux.example/tf1.m3u8
#EXTINF:-1 tvg-id="FR.M6" tvg-logo="https://img/m6.png" group-title="Généralistes",M6
https://flux.example/m6.m3u8
#EXTINF:-1 group-title="Sport, France",beIN Sports 1
https://flux.example/bein1.m3u8
`

beforeEach(() => {
  db = openDatabase(':memory:')
  sourceId = iptv.upsertSource(db, 'https://liste.example/index.m3u', 'Liste de test').id
})

describe('parseChannels', () => {
  it('traduit une playlist en chaînes', () => {
    const channels = parseChannels(PLAYLIST)
    expect(channels).toHaveLength(3)
    expect(channels[0]).toEqual({
      key: 'https://flux.example/tf1.m3u8',
      name: 'TF1', // tvg-name l'emporte sur « TF1 HD »
      streamUrl: 'https://flux.example/tf1.m3u8',
      logoUrl: 'https://img/tf1.png',
      group: 'Généralistes',
      epgId: 'FR.TF1'
    })
  })

  it('retombe sur le titre affiché quand tvg-name manque', () => {
    expect(parseChannels(PLAYLIST)[2].name).toBe('beIN Sports 1')
  })

  it('ne garde qu’une chaîne par URL de flux', () => {
    const double = `${PLAYLIST}#EXTINF:-1,TF1 bis\nhttps://flux.example/tf1.m3u8\n`
    expect(parseChannels(double)).toHaveLength(3)
  })
})

describe('suggestName', () => {
  it('nomme la source d’après le fichier, sinon le domaine', () => {
    expect(suggestName('https://iptv-org.github.io/iptv/index.m3u')).toBe('index')
    expect(suggestName('https://chaines.example/')).toBe('chaines.example')
    expect(suggestName('/home/moi/mes-chaines.m3u')).toBe('mes-chaines')
  })
})

describe('syncChannels', () => {
  it('importe toutes les chaînes de la liste', () => {
    const result = iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    expect(result).toEqual({ added: 3, missing: 0, total: 3 })
    expect(iptv.channels(db, { sourceId })).toHaveLength(3)
  })

  it('ne crée pas de doublon au rafraîchissement', () => {
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    const second = iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    expect(second).toEqual({ added: 0, missing: 0, total: 3 })
  })

  it('marque les chaînes disparues sans les supprimer', () => {
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    const reduite = parseChannels(PLAYLIST).slice(0, 2)
    expect(iptv.syncChannels(db, sourceId, reduite)).toEqual({ added: 0, missing: 1, total: 3 })

    // Hors de la liste par défaut, mais toujours en base
    expect(iptv.channels(db, { sourceId })).toHaveLength(2)
    expect(iptv.channels(db, { sourceId, includeMissing: true })).toHaveLength(3)
  })

  it('fait revenir une chaîne réapparue', () => {
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST).slice(0, 2))
    expect(iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))).toEqual({
      added: 0,
      missing: 0,
      total: 3
    })
  })

  it('conserve le favori d’une chaîne disparue puis revenue', () => {
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    const bein = iptv.channels(db, { sourceId }).find((c) => c.name.startsWith('beIN'))!
    iptv.setFavorite(db, bein.id, true)

    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST).slice(0, 2))
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    expect(iptv.channel(db, bein.id)?.favorite).toBe(true)
  })

  it('met à jour le nom, le groupe et le logo sans changer d’identité', () => {
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    const avant = iptv.channels(db, { sourceId })[0]

    iptv.syncChannels(db, sourceId, [
      { ...parseChannels(PLAYLIST)[0], name: 'TF1 4K', group: 'Ultra HD' }
    ])
    const apres = iptv.channel(db, avant.id)!
    expect(apres.name).toBe('TF1 4K')
    expect(apres.group).toBe('Ultra HD')
  })

  it('garde le logo en cache quand la liste n’en annonce plus', () => {
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
    const channel = iptv.channels(db, { sourceId })[0]
    iptv.setLogoPath(db, channel.id, '/cache/1.png')

    iptv.syncChannels(db, sourceId, [{ ...parseChannels(PLAYLIST)[0], logoUrl: null }])
    const apres = iptv.channel(db, channel.id)!
    expect(apres.logoPath).toBe('/cache/1.png')
    expect(apres.logoUrl).toBe('https://img/tf1.png')
  })
})

describe('lecture des chaînes', () => {
  beforeEach(() => {
    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST))
  })

  it('remonte les favorites en tête', () => {
    const bein = iptv.channels(db, { sourceId }).find((c) => c.name.startsWith('beIN'))!
    iptv.setFavorite(db, bein.id, true)
    expect(iptv.channels(db, { sourceId })[0].id).toBe(bein.id)
  })

  it('filtre par groupe', () => {
    expect(iptv.channels(db, { group: 'Généralistes' })).toHaveLength(2)
    expect(iptv.channels(db, { group: 'Sport, France' })).toHaveLength(1)
  })

  it('cherche par nom, sans tenir compte des jokers SQL', () => {
    expect(iptv.channels(db, { search: 'be' })).toHaveLength(1)
    expect(iptv.channels(db, { search: '%' })).toHaveLength(0)
  })

  it('combine le filtre par groupe et la recherche', () => {
    expect(iptv.channels(db, { group: 'Généralistes', search: 'M6' })).toHaveLength(1)
    expect(iptv.channels(db, { group: 'Généralistes', search: 'beIN' })).toHaveLength(0)
  })

  it('compte les rubriques, chaînes disparues exclues', () => {
    expect(iptv.groups(db, sourceId)).toEqual([
      { group: 'Généralistes', count: 2 },
      { group: 'Sport, France', count: 1 }
    ])

    iptv.syncChannels(db, sourceId, parseChannels(PLAYLIST).slice(0, 2))
    expect(iptv.groups(db, sourceId)).toEqual([{ group: 'Généralistes', count: 2 }])
  })

  it('compte les chaînes de la source', () => {
    const source = iptv.source(db, sourceId)!
    expect(source.channelCount).toBe(3)
    expect(source.missingCount).toBe(0)
  })

  it('retrouve une chaîne par l’URL de son flux', () => {
    expect(iptv.channelByUrl(db, 'https://flux.example/m6.m3u8')?.name).toBe('M6')
  })

  it('emporte les chaînes avec la source supprimée', () => {
    iptv.removeSource(db, sourceId)
    expect(iptv.channels(db, { includeMissing: true })).toHaveLength(0)
  })
})
