import { describe, expect, it } from 'vitest'
import { guessFromFileName, stripArtistPrefix } from './filename'

describe('guessFromFileName', () => {
  it('lit « Artiste - Titre » dans le nom d’un téléchargement', () => {
    expect(guessFromFileName('Ino Casablanca - BBY MAMA.mp3')).toEqual({
      artist: 'Ino Casablanca',
      title: 'BBY MAMA'
    })
    expect(guessFromFileName('Ino Casablanca, Naïka - PAPA CASA.mp3')).toEqual({
      artist: 'Ino Casablanca, Naïka',
      title: 'PAPA CASA'
    })
  })

  it('retire les mentions des plateformes et les numéros de piste', () => {
    expect(guessFromFileName('03 - Stromae - Papaoutai (Clip Officiel).mp3')).toEqual({
      artist: 'Stromae',
      title: 'Papaoutai'
    })
    expect(guessFromFileName('Daft Punk – One More Time [Official Video] (HD).m4a')).toEqual({
      artist: 'Daft Punk',
      title: 'One More Time'
    })
  })

  it('garde ce qui fait partie du titre', () => {
    expect(guessFromFileName('Jul - Tchikita (feat. SCH).mp3')?.title).toBe('Tchikita (feat. SCH)')
    expect(guessFromFileName('Artiste - Partie 1 - Partie 2.mp3')?.title).toBe(
      'Partie 1 - Partie 2'
    )
  })

  it('ne coupe pas un nom sans séparateur entouré d’espaces', () => {
    expect(guessFromFileName('Travel Hacked (Court-Métrage).m4a')).toBeNull()
    expect(guessFromFileName('Jay-Z.mp3')).toBeNull()
    expect(guessFromFileName('piste_03.mp3')).toBeNull()
    expect(guessFromFileName('01 - Intro.mp3')).toBeNull()
  })
})

describe('stripArtistPrefix', () => {
  it('retire l’artiste répété en tête du titre', () => {
    expect(stripArtistPrefix('INO CASABLANCA - BUENA ONDA', 'Ino Casablanca')).toBe('BUENA ONDA')
  })

  it('laisse un titre qui ne commence pas par l’artiste', () => {
    expect(stripArtistPrefix('Partie 1 - Partie 2', 'Ino Casablanca')).toBe('Partie 1 - Partie 2')
    expect(stripArtistPrefix('BUENA ONDA', 'Ino Casablanca')).toBe('BUENA ONDA')
  })
})
