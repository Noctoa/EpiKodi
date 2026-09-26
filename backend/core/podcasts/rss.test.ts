import { describe, expect, it } from 'vitest'
import { MAX_EPISODES, parseDuration, parseFeed, stripHtml } from './rss'

/** Flux inspiré de la structure des vrais podcasts : namespaces iTunes, CDATA, guid, enclosure. */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Radio Démo</title>
    <description><![CDATA[<p>Un podcast de <b>test</b>.</p>]]></description>
    <link>https://demo.example</link>
    <itunes:author>Équipe Démo</itunes:author>
    <itunes:image href="https://demo.example/cover.jpg"/>
    <item>
      <title>Épisode 2</title>
      <description>Le deuxième</description>
      <guid isPermaLink="false">ep-2</guid>
      <pubDate>Wed, 02 Oct 2024 08:00:00 GMT</pubDate>
      <enclosure url="https://demo.example/2.mp3" type="audio/mpeg" length="2048"/>
      <itunes:duration>26:30</itunes:duration>
      <itunes:image href="https://demo.example/2.jpg"/>
    </item>
    <item>
      <title>Épisode 1</title>
      <itunes:summary>Le premier</itunes:summary>
      <guid>ep-1</guid>
      <pubDate>Tue, 01 Oct 2024 08:00:00 GMT</pubDate>
      <enclosure url="https://demo.example/1.mp3" type="audio/mpeg" length="1024"/>
      <itunes:duration>1590</itunes:duration>
    </item>
  </channel>
</rss>`

describe('parseFeed', () => {
  it('lit les informations du podcast', () => {
    expect(parseFeed(FEED).feed).toEqual({
      title: 'Radio Démo',
      description: 'Un podcast de test.',
      author: 'Équipe Démo',
      website: 'https://demo.example',
      imageUrl: 'https://demo.example/cover.jpg'
    })
  })

  it('lit les épisodes, du plus récent au plus ancien', () => {
    const { episodes } = parseFeed(FEED)
    expect(episodes.map((e) => e.title)).toEqual(['Épisode 2', 'Épisode 1'])
    expect(episodes[0]).toMatchObject({
      guid: 'ep-2',
      audioUrl: 'https://demo.example/2.mp3',
      mime: 'audio/mpeg',
      size: 2048,
      duration: 1590,
      imageUrl: 'https://demo.example/2.jpg'
    })
    expect(episodes[0].publishedAt).toBe(Date.parse('Wed, 02 Oct 2024 08:00:00 GMT') / 1000)
    expect(episodes[1].description).toBe('Le premier')
  })

  it('accepte un flux à un seul épisode', () => {
    const un = FEED.replace(/<item>[\s\S]*?<\/item>\s*<item>/, '<item>')
    expect(parseFeed(un).episodes).toHaveLength(1)
  })

  it('ignore un épisode sans fichier audio plutôt que d’échouer', () => {
    const sansAudio = FEED.replace(
      '<enclosure url="https://demo.example/2.mp3" type="audio/mpeg" length="2048"/>',
      ''
    )
    const { episodes } = parseFeed(sansAudio)
    expect(episodes.map((e) => e.title)).toEqual(['Épisode 1'])
  })

  it('retombe sur l’URL du fichier quand le guid manque', () => {
    const sansGuid = FEED.replace('<guid isPermaLink="false">ep-2</guid>', '')
    expect(parseFeed(sansGuid).episodes[0].guid).toBe('https://demo.example/2.mp3')
  })

  it('tolère les balises absentes', () => {
    const minimal = `<rss><channel><title>T</title>
      <item><title>E</title><enclosure url="https://x/1.mp3"/></item></channel></rss>`
    const { feed, episodes } = parseFeed(minimal)
    expect(feed).toMatchObject({ title: 'T', description: null, imageUrl: null })
    expect(episodes[0]).toMatchObject({ duration: null, publishedAt: null, size: null, mime: null })
  })

  it('rejette un document qui n’est pas un flux', () => {
    expect(() => parseFeed('<html><body>pas un flux</body></html>')).toThrow(/channel/)
  })

  it('limite le nombre d’épisodes conservés', () => {
    const item = (i: number) =>
      `<item><title>E${i}</title><guid>g${i}</guid><enclosure url="https://x/${i}.mp3"/></item>`
    const gros = `<rss><channel><title>T</title>${Array.from({ length: MAX_EPISODES + 50 }, (_, i) => item(i)).join('')}</channel></rss>`
    expect(parseFeed(gros).episodes).toHaveLength(MAX_EPISODES)
  })
})

describe('parseDuration', () => {
  it('comprend les trois écritures rencontrées dans les flux', () => {
    expect(parseDuration('1590')).toBe(1590)
    expect(parseDuration('26:30')).toBe(1590)
    expect(parseDuration('01:26:30')).toBe(5190)
  })

  it('ignore les valeurs inexploitables', () => {
    expect(parseDuration(null)).toBeNull()
    expect(parseDuration('inconnue')).toBeNull()
    expect(parseDuration('0')).toBeNull()
    expect(parseDuration('-5')).toBeNull()
  })
})

describe('stripHtml', () => {
  it('produit un texte lisible à partir du HTML des descriptions', () => {
    expect(stripHtml('<p>Bonjour<br/>le <b>monde</b></p>')).toBe('Bonjour\nle monde')
    expect(stripHtml('Caf&#233; &amp; th&eacute;')).toContain('Café &')
    expect(stripHtml('   ')).toBeNull()
  })
})
