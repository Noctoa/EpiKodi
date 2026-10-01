import { describe, expect, it } from 'vitest'
import { describeGuess, guessFromFilename } from './filename'

const movie = (name: string, parent?: string) => guessFromFilename(name, parent)

describe('films', () => {
  it('sépare le titre de l’année', () => {
    expect(movie('Inception.2010.mkv')).toMatchObject({
      kind: 'movie',
      title: 'Inception',
      year: 2010
    })
    expect(movie('Mon Film (2019).mp4')).toMatchObject({ title: 'Mon Film', year: 2019 })
    expect(movie('Mon_Film_2019.avi')).toMatchObject({ title: 'Mon Film', year: 2019 })
  })

  it('retire la qualité, la source et le codec', () => {
    expect(movie('Un.Grand.Film.2015.1080p.BluRay.x264.DTS-HD.mkv')).toMatchObject({
      title: 'Un Grand Film',
      year: 2015
    })
    expect(movie('Autre Film 2020 2160p UHD WEB-DL HDR HEVC.mkv').title).toBe('Autre Film')
  })

  it('retire les marqueurs de langue', () => {
    expect(movie('Le.Film.2018.TRUEFRENCH.1080p.WEBRip.mkv').title).toBe('Le Film')
    expect(movie('Le.Film.2018.MULTI.VOSTFR.x265.mkv').title).toBe('Le Film')
  })

  it('retire les crochets et le groupe de release final', () => {
    expect(movie('[Groupe] Mon Film (2017) [1080p].mkv').title).toBe('Mon Film')
    expect(movie('Mon.Film.2017.1080p.BluRay-TEAMNAME.mkv').title).toBe('Mon Film')
  })

  it('ne prend pas un nombre du titre pour une année', () => {
    expect(movie('Blade.Runner.2049.2017.MULTI.1080p.mkv')).toMatchObject({
      title: 'Blade Runner 2049',
      year: 2017
    })
  })

  it('garde les titres contenant des chiffres ou des années invraisemblables', () => {
    expect(movie('2001 A Space Odyssey 1968.mkv')).toMatchObject({
      title: '2001 A Space Odyssey',
      year: 1968
    })
    expect(movie('Film.1234.mkv').year).toBeNull()
  })

  it('se rabat sur le dossier parent quand le fichier n’apprend rien', () => {
    expect(movie('film.mkv', 'Inception (2010)')).toMatchObject({ title: 'Inception', year: 2010 })
    expect(movie('01.mkv', 'Un Autre Film (1999)')).toMatchObject({
      title: 'Un Autre Film',
      year: 1999
    })
  })

  it('ne confond pas un titre sans année avec une série', () => {
    expect(movie('Documentaire Sur Les Volcans.mp4')).toMatchObject({
      kind: 'movie',
      title: 'Documentaire Sur Les Volcans',
      year: null
    })
  })
})

describe('séries', () => {
  it('reconnaît les écritures de saison et épisode', () => {
    expect(movie('The.Office.S03E12.FRENCH.HDTV.avi')).toMatchObject({
      kind: 'tv',
      title: 'The Office',
      season: 3,
      episode: 12
    })
    expect(movie('Ma Serie - 1x05 - Le Titre.mkv')).toMatchObject({
      kind: 'tv',
      title: 'Ma Serie',
      season: 1,
      episode: 5
    })
    expect(movie('Serie.saison.2.episode.08.mp4')).toMatchObject({ season: 2, episode: 8 })
    expect(movie('Show Season 4 Episode 2.mkv')).toMatchObject({ season: 4, episode: 2 })
  })

  it('prend le dossier parent si le fichier ne porte que le code épisode', () => {
    expect(movie('S01E03.mkv', 'Ma Super Serie')).toMatchObject({
      kind: 'tv',
      title: 'Ma Super Serie',
      season: 1,
      episode: 3
    })
  })

  it('nettoie aussi le bruit autour du code épisode', () => {
    expect(movie('Une.Serie.2019.S02E10.1080p.WEB-DL.x265-GROUPE.mkv')).toMatchObject({
      kind: 'tv',
      title: 'Une Serie',
      season: 2,
      episode: 10
    })
  })
})

describe('describeGuess', () => {
  it('produit une clé de recherche lisible', () => {
    expect(describeGuess(movie('Inception.2010.mkv'))).toBe('Inception (2010)')
    expect(describeGuess(movie('The.Office.S03E12.avi'))).toBe('The Office S03E12')
    expect(describeGuess(movie('Sans Annee.mkv'))).toBe('Sans Annee')
  })
})
