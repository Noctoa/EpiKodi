import { describe, expect, it } from 'vitest'
import { matchEntries, parseM3u, parseM3uChannels, playlistFileName, serializeM3u } from './m3u'

describe('serializeM3u', () => {
  it('écrit un fichier lisible par les autres lecteurs', () => {
    const texte = serializeM3u([
      { path: '/musique/a.mp3', duration: 185, title: 'Artiste - Titre' },
      { path: '/films/b.mkv', duration: null, title: 'Un film' }
    ])
    expect(texte.split('\n')).toEqual([
      '#EXTM3U',
      '#EXTINF:185,Artiste - Titre',
      '/musique/a.mp3',
      '#EXTINF:-1,Un film',
      '/films/b.mkv',
      ''
    ])
  })

  it('omet la ligne de description quand il n’y a pas de titre', () => {
    expect(serializeM3u([{ path: '/a.mp3', duration: 10, title: null }])).toBe('#EXTM3U\n/a.mp3\n')
  })

  it('ne laisse pas un titre multiligne casser le format', () => {
    const texte = serializeM3u([{ path: '/a.mp3', duration: 1, title: 'Deux\nlignes' }])
    expect(texte.split('\n')).toHaveLength(4)
    expect(texte).toContain('#EXTINF:1,Deux lignes')
  })
})

describe('parseM3u', () => {
  it('relit ce qu’il a écrit', () => {
    const original = [
      { path: '/musique/a.mp3', duration: 185, title: 'Artiste - Titre' },
      { path: '/films/b.mkv', duration: null, title: 'Un film' }
    ]
    expect(parseM3u(serializeM3u(original))).toEqual(original)
  })

  it('accepte un fichier sans en-tête ni description', () => {
    expect(parseM3u('/a.mp3\n/b.mp3')).toEqual([
      { path: '/a.mp3', duration: null, title: null },
      { path: '/b.mp3', duration: null, title: null }
    ])
  })

  it('ignore les commentaires inconnus et les lignes vides', () => {
    const texte = '#EXTM3U\n\n#PLAYLIST:Ma liste\n#EXTVLCOPT:x\n/a.mp3\n\n'
    expect(parseM3u(texte)).toEqual([{ path: '/a.mp3', duration: null, title: null }])
  })

  it('abandonne une description sans média derrière', () => {
    expect(parseM3u('#EXTM3U\n#EXTINF:12,Orpheline\n')).toEqual([])
  })

  it('accepte les URL autant que les chemins', () => {
    expect(parseM3u('https://exemple.org/flux.mp3')[0].path).toBe('https://exemple.org/flux.mp3')
  })

  it('traite -1 et 0 comme une durée inconnue', () => {
    expect(parseM3u('#EXTINF:-1,A\n/a.mp3')[0].duration).toBeNull()
    expect(parseM3u('#EXTINF:0,A\n/a.mp3')[0].duration).toBeNull()
  })
})

describe('parseM3uChannels', () => {
  const ligne = (extinf: string, url = 'https://flux.example/a.m3u8'): string =>
    `#EXTM3U\n${extinf}\n${url}`

  it('lit les attributs des listes de chaînes', () => {
    const [chaine] = parseM3uChannels(
      ligne(
        '#EXTINF:-1 tvg-id="FR.TF1" tvg-name="TF1" tvg-logo="https://img/tf1.png" ' +
          'group-title="Généralistes",TF1 HD'
      )
    )
    expect(chaine.title).toBe('TF1 HD')
    expect(chaine.attributes).toEqual({
      tvgId: 'FR.TF1',
      tvgName: 'TF1',
      tvgLogo: 'https://img/tf1.png',
      groupTitle: 'Généralistes'
    })
  })

  it('ne coupe pas le titre sur une virgule contenue dans un attribut', () => {
    const [chaine] = parseM3uChannels(ligne('#EXTINF:-1 group-title="Sport, France",beIN 1'))
    expect(chaine.attributes.groupTitle).toBe('Sport, France')
    expect(chaine.title).toBe('beIN 1')
  })

  it('traite un attribut vide comme absent', () => {
    const [chaine] = parseM3uChannels(ligne('#EXTINF:-1 tvg-id="" tvg-logo="  ",Sans rien'))
    expect(chaine.attributes.tvgId).toBeNull()
    expect(chaine.attributes.tvgLogo).toBeNull()
  })

  it('accepte une ligne sans titre après les attributs', () => {
    const [chaine] = parseM3uChannels(ligne('#EXTINF:-1 tvg-id="X"'))
    expect(chaine.title).toBeNull()
    expect(chaine.attributes.tvgId).toBe('X')
  })

  it('garde la durée d’une entrée classique mêlée aux chaînes', () => {
    const chaines = parseM3uChannels('#EXTINF:185,Artiste - Titre\n/musique/a.mp3')
    expect(chaines[0].duration).toBe(185)
    expect(chaines[0].attributes.groupTitle).toBeNull()
  })

  it('n’attribue pas les attributs d’une chaîne à la suivante', () => {
    const chaines = parseM3uChannels(
      '#EXTINF:-1 group-title="A",Un\nhttps://a\n#EXTINF:-1,Deux\nhttps://b'
    )
    expect(chaines.map((c) => c.attributes.groupTitle)).toEqual(['A', null])
  })

  it('lit les en-têtes HTTP exigés par un flux, avant ou après #EXTINF', () => {
    const chaines = parseM3uChannels(
      [
        '#EXTM3U',
        '#EXTINF:-1,Un',
        '#EXTVLCOPT:http-user-agent=Mozilla/5.0 (X11; Linux x86_64)',
        'https://a',
        '#EXTVLCOPT:http-referrer=https://site.example/',
        '#EXTINF:-1,Deux',
        'https://b'
      ].join('\n')
    )
    expect(chaines.map((c) => c.http)).toEqual([
      { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', referrer: null },
      { userAgent: null, referrer: 'https://site.example/' }
    ])
  })

  it('accepte les deux orthographes du référent et ignore les options inconnues', () => {
    const [chaine] = parseM3uChannels(
      '#EXTVLCOPT:http-referer=https://r.example/\n#EXTVLCOPT:network-caching=1000\nhttps://a'
    )
    expect(chaine.http).toEqual({ userAgent: null, referrer: 'https://r.example/' })
  })

  it('n’attribue pas les en-têtes d’une chaîne à la suivante', () => {
    const chaines = parseM3uChannels('#EXTVLCOPT:http-user-agent=VLC\nhttps://a\nhttps://b')
    expect(chaines[1].http.userAgent).toBeNull()
  })

  it('laisse parseM3u aveugle aux attributs', () => {
    const entrees = parseM3u(ligne('#EXTINF:-1 tvg-id="X" group-title="A",Chaîne'))
    expect(entrees).toEqual([
      { path: 'https://flux.example/a.m3u8', duration: null, title: 'Chaîne' }
    ])
  })

  it('retrouve désormais le titre d’une ligne porteuse d’attributs', () => {
    // Avant l'extension, la ligne ne correspondait à rien et le titre était perdu
    expect(parseM3u(ligne('#EXTINF:-1 tvg-id="X",Chaîne'))[0].title).toBe('Chaîne')
  })
})

describe('playlistFileName', () => {
  it('produit un nom de fichier sûr', () => {
    expect(playlistFileName('Ma playlist !')).toBe('Ma playlist.m3u')
    expect(playlistFileName('Été 2024 / best-of')).toBe('Ete 2024 best-of.m3u')
    expect(playlistFileName('***')).toBe('playlist.m3u')
  })
})

describe('matchEntries', () => {
  const bibliotheque = new Map([
    ['/musique/a.mp3', 1],
    ['/musique/b.mp3', 2]
  ])

  it('retrouve les médias connus et signale les autres', () => {
    const entries = parseM3u('/musique/a.mp3\n/ailleurs/c.mp3\n/musique/b.mp3')
    expect(matchEntries(entries, bibliotheque)).toEqual({
      mediaIds: [1, 2],
      missing: ['/ailleurs/c.mp3']
    })
  })

  it('conserve l’ordre du fichier', () => {
    const entries = parseM3u('/musique/b.mp3\n/musique/a.mp3')
    expect(matchEntries(entries, bibliotheque).mediaIds).toEqual([2, 1])
  })

  it('n’ajoute pas deux fois le même média', () => {
    const entries = parseM3u('/musique/a.mp3\n/musique/a.mp3')
    expect(matchEntries(entries, bibliotheque).mediaIds).toEqual([1])
  })

  it('accepte un fichier dont rien n’est en bibliothèque', () => {
    expect(matchEntries(parseM3u('/x.mp3'), bibliotheque)).toEqual({
      mediaIds: [],
      missing: ['/x.mp3']
    })
  })
})
