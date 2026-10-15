import { describe, expect, it } from 'vitest'
import { activeCommands, commandKey, type PadLike } from './gamepad'

/** Manette au repos : 17 boutons relâchés, sticks centrés. */
function pad(partial: { pressed?: number[]; axes?: number[] } = {}): PadLike {
  const pressed = new Set(partial.pressed ?? [])
  return {
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i) })),
    axes: partial.axes ?? [0, 0, 0, 0]
  }
}

describe('activeCommands', () => {
  it('ne renvoie rien au repos', () => {
    expect(activeCommands(pad())).toEqual([])
  })

  it('traduit les boutons du mappage standard', () => {
    expect(activeCommands(pad({ pressed: [0] }))).toEqual([{ type: 'key', key: 'ok' }])
    expect(activeCommands(pad({ pressed: [2] }))).toEqual([{ type: 'toggle' }])
    expect(activeCommands(pad({ pressed: [7] }))).toEqual([{ type: 'seek-by', delta: 30 }])
    expect(activeCommands(pad({ pressed: [13] }))).toEqual([{ type: 'key', key: 'down' }])
  })

  it('ignore les boutons sans action', () => {
    expect(activeCommands(pad({ pressed: [8, 10, 16] }))).toEqual([])
  })

  it('renvoie toutes les commandes tenues en même temps', () => {
    expect(activeCommands(pad({ pressed: [4, 5] }))).toEqual([{ type: 'prev' }, { type: 'next' }])
  })

  it('lit le stick gauche comme une croix directionnelle, zone morte comprise', () => {
    expect(activeCommands(pad({ axes: [0, -0.4] }))).toEqual([])
    expect(activeCommands(pad({ axes: [0, -0.9] }))).toEqual([{ type: 'key', key: 'up' }])
    expect(activeCommands(pad({ axes: [0.8, 0] }))).toEqual([{ type: 'key', key: 'right' }])
  })

  it('donne la même identité à la croix et au stick dans la même direction', () => {
    const [fromPad] = activeCommands(pad({ pressed: [12] }))
    const [fromStick] = activeCommands(pad({ axes: [0, -1] }))
    expect(commandKey(fromPad)).toBe(commandKey(fromStick))
    expect(commandKey({ type: 'seek-by', delta: 30 })).toBe('seek-by')
  })
})
