import { describe, expect, it } from 'vitest'
import { activeCommands, commandKey, hatDirections, type PadLike } from './gamepad'

/** Manette au repos : 17 boutons relâchés, sticks centrés. */
function pad(partial: { pressed?: number[]; axes?: number[]; mapping?: string } = {}): PadLike {
  const pressed = new Set(partial.pressed ?? [])
  return {
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i) })),
    axes: partial.axes ?? [0, 0, 0, 0],
    mapping: partial.mapping
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

describe('manette non normalisée', () => {
  const generique = (p: { pressed?: number[]; axes?: number[] }): PadLike =>
    pad({ ...p, mapping: '' })

  it('ne garde que les deux premiers boutons, dont les index sont une convention', () => {
    expect(activeCommands(generique({ pressed: [0] }))).toEqual([{ type: 'key', key: 'ok' }])
    expect(activeCommands(generique({ pressed: [1] }))).toEqual([{ type: 'key', key: 'back' }])
  })

  it('ignore les boutons dont l’index ne veut rien dire sur ces manettes', () => {
    // Sur une manette standard, 2 et 12 sont « lecture/pause » et « haut »
    expect(activeCommands(generique({ pressed: [2, 12] }))).toEqual([])
  })

  it('garde le stick gauche comme direction', () => {
    expect(activeCommands(generique({ axes: [0, -1] }))).toEqual([{ type: 'key', key: 'up' }])
  })

  it('lit la croix directionnelle sur l’axe supplémentaire', () => {
    // axes : stick gauche, stick droit, puis le « hat » de la croix
    expect(activeCommands(generique({ axes: [0, 0, 0, 0, -1] }))).toEqual([
      { type: 'key', key: 'up' }
    ])
    expect(activeCommands(generique({ axes: [0, 0, 0, 0, 3.28] }))).toEqual([])
  })

  it('n’interprète pas les axes supplémentaires d’une manette standard', () => {
    // Gâchettes analogiques et autres : elles ne doivent pas passer pour une croix
    expect(activeCommands(pad({ axes: [0, 0, 0, 0, -1], mapping: 'standard' }))).toEqual([])
  })
})

describe('hatDirections', () => {
  it('décode les huit directions du « hat switch »', () => {
    expect(hatDirections(-1)).toEqual(['up'])
    expect(hatDirections(-0.428)).toEqual(['right'])
    expect(hatDirections(0.142)).toEqual(['down'])
    expect(hatDirections(0.714)).toEqual(['left'])
    expect(hatDirections(-0.714)).toEqual(['up', 'right'])
    expect(hatDirections(1)).toEqual(['up', 'left'])
  })

  it('ne renvoie rien au repos, valeur hors bornes', () => {
    expect(hatDirections(3.28)).toEqual([])
    expect(hatDirections(1.28)).toEqual([])
    expect(hatDirections(Number.NaN)).toEqual([])
  })
})
