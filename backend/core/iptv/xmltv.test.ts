import { describe, expect, it } from 'vitest'
import {
  epgKey,
  formatEpisode,
  parseXmltv,
  parseXmltvTime,
  XmltvReader,
  type XmltvChannel,
  type XmltvProgramme
} from './xmltv'

/** Extrait d'un vrai guide (xmltvfr.fr), raccourci. */
const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv source-info-name="XML TV Fr">
  <channel id="TF1.fr">
    <display-name>TF1</display-name>
    <icon src="https://img.example/tf1.png"/>
  </channel>
  <channel id="France2.fr"><display-name>France 2</display-name></channel>
  <programme start="20261028001500 +0100" stop="20261028012500 +0100" channel="TF1.fr">
    <title lang="fr">Une famille en or</title>
    <sub-title lang="fr">La famille Pham Vs la famille Patel</sub-title>
    <desc lang="fr">La famille Pham affronte la famille Patel &amp; ses alliés.</desc>
    <category lang="fr">Divertissement</category>
    <icon src="http://img.example/15252835.jpg"/>
    <episode-num system="xmltv_ns">0.863.</episode-num>
  </programme>
  <programme start="20261028012500 +0100" stop="20261028021000 +0100" channel="France2.fr">
    <title lang="en">Night news</title>
    <title lang="fr">Journal de la nuit</title>
  </programme>
</tv>
`

describe('parseXmltvTime', () => {
  const utc = (iso: string): number => Date.parse(iso) / 1000

  it('applique le décalage déclaré', () => {
    expect(parseXmltvTime('20261028001500 +0100')).toBe(utc('2026-10-27T23:15:00Z'))
    expect(parseXmltvTime('20260715203000 +0200')).toBe(utc('2026-07-15T18:30:00Z'))
    expect(parseXmltvTime('20261028001500 -0500')).toBe(utc('2026-10-28T05:15:00Z'))
  })

  it('donne le même instant quel que soit le fuseau d’écriture', () => {
    const paris = parseXmltvTime('20261028210000 +0100')
    expect(parseXmltvTime('20261028200000 +0000')).toBe(paris)
    expect(parseXmltvTime('20261028150000 -0500')).toBe(paris)
    expect(parseXmltvTime('20261029043000 +0830')).toBe(paris)
  })

  it('lit l’UTC quand aucun fuseau n’est donné, comme le veut la DTD', () => {
    expect(parseXmltvTime('20261028001500')).toBe(utc('2026-10-28T00:15:00Z'))
  })

  it('accepte les abréviations, le décalage à deux-points et les dates tronquées', () => {
    expect(parseXmltvTime('200007281733 BST')).toBe(utc('2000-07-28T16:33:00Z'))
    expect(parseXmltvTime('20261028001500 +01:00')).toBe(utc('2026-10-27T23:15:00Z'))
    expect(parseXmltvTime('200209')).toBe(utc('2002-09-01T00:00:00Z'))
  })

  it('refuse ce qu’il ne sait pas lire plutôt que de deviner', () => {
    expect(parseXmltvTime('hier soir')).toBeNull()
    expect(parseXmltvTime('20261028001500 XYZ')).toBeNull()
    expect(parseXmltvTime(null)).toBeNull()
  })
})

describe('formatEpisode', () => {
  it('compte à partir de 1 ce que xmltv_ns compte à partir de 0', () => {
    expect(formatEpisode('xmltv_ns', '1.4.')).toBe('S2 E5')
    expect(formatEpisode('xmltv_ns', '.863.')).toBe('E864')
    expect(formatEpisode('xmltv_ns', '2.9/12.0/1')).toBe('S3 E10')
  })

  it('garde l’écriture « onscreen » telle quelle', () => {
    expect(formatEpisode('onscreen', 'S01E05')).toBe('S01E05')
  })
})

describe('parseXmltv', () => {
  it('lit les chaînes et les programmes', () => {
    const { channels, programmes } = parseXmltv(GUIDE)
    expect(channels).toEqual([
      { id: 'TF1.fr', displayName: 'TF1', iconUrl: 'https://img.example/tf1.png' },
      { id: 'France2.fr', displayName: 'France 2', iconUrl: null }
    ])
    expect(programmes[0]).toEqual({
      channel: 'TF1.fr',
      start: Date.parse('2026-10-27T23:15:00Z') / 1000,
      stop: Date.parse('2026-10-28T00:25:00Z') / 1000,
      title: 'Une famille en or',
      subtitle: 'La famille Pham Vs la famille Patel',
      description: 'La famille Pham affronte la famille Patel & ses alliés.',
      category: 'Divertissement',
      iconUrl: 'http://img.example/15252835.jpg',
      episode: 'S1 E864' // « 0.863. » : première saison, épisode 864
    })
  })

  it('préfère le titre dans la langue demandée', () => {
    expect(parseXmltv(GUIDE).programmes[1].title).toBe('Journal de la nuit')
    expect(parseXmltv(GUIDE, { lang: 'en' }).programmes[1].title).toBe('Night news')
  })

  it('écarte les chaînes dont on ne veut pas, sans les analyser', () => {
    const { programmes } = parseXmltv(GUIDE, { wantChannel: (id) => id === 'France2.fr' })
    expect(programmes.map((p) => p.channel)).toEqual(['France2.fr'])
  })

  it('ignore un programme inutilisable sans perdre les autres', () => {
    const guide = GUIDE.replace(
      '<programme start="20261028012500',
      '<programme start="bientôt" channel="TF1.fr"><title>?</title></programme>\n<programme start="20261028012500'
    )
    expect(parseXmltv(guide).programmes).toHaveLength(2)
  })

  it('tolère un arrêt manquant ou antérieur au début', () => {
    const guide = GUIDE.replace('stop="20261028012500 +0100"', 'stop="20261027000000 +0100"')
    expect(parseXmltv(guide).programmes[0].stop).toBeNull()
  })

  it('rejette un document qui n’est pas un guide', () => {
    expect(() => parseXmltv('<rss><channel><title>Podcast</title></channel></rss>')).toThrow(
      /pas un guide/
    )
  })
})

describe('XmltvReader', () => {
  it('rend le même résultat quel que soit le découpage en morceaux', () => {
    const whole = parseXmltv(GUIDE)
    for (const size of [1, 7, 64, 333]) {
      const reader = new XmltvReader()
      const channels: XmltvChannel[] = []
      const programmes: XmltvProgramme[] = []
      for (let i = 0; i < GUIDE.length; i += size) {
        const batch = reader.push(GUIDE.slice(i, i + size))
        channels.push(...batch.channels)
        programmes.push(...batch.programmes)
      }
      reader.end()
      expect({ channels, programmes }).toEqual(whole)
    }
  })

  it('ne confond pas une balise de même préfixe avec une chaîne', () => {
    const guide = '<tv><channels-info>x</channels-info><channel id="a"/></tv>'
    expect(parseXmltv(guide).channels.map((c) => c.id)).toEqual(['a'])
  })

  it('ne garde pas en mémoire ce qu’il a déjà rendu', () => {
    const reader = new XmltvReader()
    reader.push(GUIDE)
    // Seule la fin du document, après le dernier programme, peut rester en attente
    expect((reader as unknown as { buffer: string }).buffer.length).toBeLessThan(32)
  })
})

describe('epgKey', () => {
  it('rapproche les identifiants d’iptv-org de ceux des guides', () => {
    expect(epgKey('6ter.fr@SD')).toBe(epgKey('6ter.fr'))
    expect(epgKey('TF1.fr@HD')).toBe('tf1.fr')
    expect(epgKey('France2.FR')).toBe('france2.fr')
  })

  it('ne fabrique pas de clé à partir de rien', () => {
    expect(epgKey('')).toBeNull()
    expect(epgKey('@SD')).toBeNull()
    expect(epgKey(null)).toBeNull()
  })
})
