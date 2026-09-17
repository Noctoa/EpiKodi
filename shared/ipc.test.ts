import { describe, expect, it } from 'vitest'
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/ipc'

describe('extensions supportées', () => {
  it('ne se recoupent pas entre audio et vidéo', () => {
    const both = VIDEO_EXTENSIONS.filter((e) => AUDIO_EXTENSIONS.includes(e))
    expect(both).toEqual([])
  })

  it('sont en minuscules sans point', () => {
    for (const ext of [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]) {
      expect(ext).toMatch(/^[a-z0-9]+$/)
    }
  })
})
