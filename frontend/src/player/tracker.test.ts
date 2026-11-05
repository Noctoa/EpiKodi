import { describe, expect, it } from 'vitest'
import { MAX_TICK_MS, PlayClock, targetOfKey } from './tracker'

describe('PlayClock', () => {
  it('compte le temps entre deux mesures', () => {
    const c = new PlayClock()
    c.tick(0)
    c.tick(250)
    c.tick(1250)
    expect(c.take()).toBe(1.25)
    expect(c.take()).toBe(0)
  })

  it('ne compte pas une pause', () => {
    const c = new PlayClock()
    c.tick(0)
    c.tick(1000)
    c.stop(1500)
    // Reprise dix minutes plus tard
    c.tick(601_500)
    c.tick(602_500)
    expect(c.take()).toBe(2.5)
  })

  it('plafonne un écart anormal entre deux mesures', () => {
    const c = new PlayClock()
    c.tick(0)
    c.tick(60_000)
    expect(c.take()).toBe(MAX_TICK_MS / 1000)
  })

  it('ignore une horloge qui recule', () => {
    const c = new PlayClock()
    c.tick(1000)
    c.tick(500)
    expect(c.take()).toBe(0)
  })
})

describe('targetOfKey', () => {
  it('reconnaît les médias et les épisodes, pas les fichiers isolés', () => {
    expect(targetOfKey('media:12')).toEqual({ kind: 'media', mediaId: 12 })
    expect(targetOfKey('episode:3')).toEqual({ kind: 'episode', episodeId: 3 })
    expect(targetOfKey('file:/home/x.mp3')).toBeNull()
  })
})
