import { describe, expect, it } from 'vitest'
import { credit, pickRecognition, type LookupResponse } from './acoustid'

/** Réponse d'AcoustID telle que la renvoie meta=recordings releasegroups releases tracks. */
const response = (overrides: Partial<LookupResponse> = {}): LookupResponse => ({
  status: 'ok',
  results: [
    {
      score: 0.97,
      recordings: [
        {
          id: 'rec-1',
          title: 'One More Time',
          artists: [{ name: 'Daft Punk' }],
          releasegroups: [
            {
              id: 'rg-single',
              title: 'One More Time',
              type: 'Single',
              artists: [{ name: 'Daft Punk' }],
              releases: [
                { date: { year: 2000 }, mediums: [{ position: 1, tracks: [{ position: 1 }] }] }
              ]
            },
            {
              id: 'rg-best-of',
              title: 'Musique, Volume 1',
              type: 'Album',
              secondarytypes: ['Compilation'],
              artists: [{ name: 'Daft Punk' }],
              releases: [{ date: { year: 2006 } }]
            },
            {
              id: 'rg-discovery',
              title: 'Discovery',
              type: 'Album',
              artists: [{ name: 'Daft Punk' }],
              releases: [
                { date: { year: 2001 }, mediums: [{ position: 1, tracks: [{ position: 1 }] }] },
                { date: { year: 2021 } }
              ]
            }
          ]
        }
      ]
    }
  ],
  ...overrides
})

describe('pickRecognition', () => {
  it('retient l’album studio plutôt que le single ou la compilation', () => {
    expect(pickRecognition(response())).toEqual({
      recordingId: 'rec-1',
      score: 0.97,
      title: 'One More Time',
      artist: 'Daft Punk',
      album: 'Discovery',
      albumArtist: 'Daft Punk',
      releaseGroupId: 'rg-discovery',
      // La première sortie, pas la réédition de 2021
      year: 2001,
      track: 1
    })
  })

  it('refuse une empreinte sur laquelle AcoustID hésite', () => {
    const doubtful = response()
    doubtful.results![0].score = 0.5
    expect(pickRecognition(doubtful)).toBeNull()
  })

  it('ne trouve rien quand l’empreinte n’est rattachée à aucun enregistrement', () => {
    expect(pickRecognition({ status: 'ok', results: [{ score: 0.99 }] })).toBeNull()
    expect(pickRecognition({ status: 'ok', results: [] })).toBeNull()
  })

  it('garde le titre et l’artiste d’un morceau qui n’est sur aucun album', () => {
    const alone = response()
    alone.results![0].recordings![0].releasegroups = []
    expect(pickRecognition(alone)).toMatchObject({
      title: 'One More Time',
      album: null,
      releaseGroupId: null,
      track: null
    })
  })

  it('préfère, entre deux enregistrements d’une même empreinte, le plus documenté', () => {
    const twin = response()
    twin.results![0].recordings!.unshift({
      id: 'rec-obscur',
      title: 'One More Time (radio edit)',
      artists: [{ name: 'Daft Punk' }],
      releasegroups: []
    })
    expect(pickRecognition(twin)?.recordingId).toBe('rec-1')
  })
})

describe('credit', () => {
  it('recompose les crédits partagés de MusicBrainz', () => {
    expect(credit([{ name: 'Jul', joinphrase: ' feat. ' }, { name: 'Valouzz' }])).toBe(
      'Jul feat. Valouzz'
    )
    expect(credit([{ name: 'A' }, { name: 'B' }])).toBe('A, B')
    expect(credit(undefined)).toBe('')
  })
})
