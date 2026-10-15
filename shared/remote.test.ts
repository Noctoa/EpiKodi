import { describe, expect, it } from 'vitest'
import { parseCommand } from './remote'

describe('parseCommand', () => {
  it('accepte les commandes sans paramètre', () => {
    expect(parseCommand({ type: 'toggle' })).toEqual({ type: 'toggle' })
    expect(parseCommand({ type: 'next' })).toEqual({ type: 'next' })
  })

  it('refuse ce qui ne ressemble pas à une commande', () => {
    expect(parseCommand(null)).toBeNull()
    expect(parseCommand('toggle')).toBeNull()
    expect(parseCommand({})).toBeNull()
    expect(parseCommand({ type: 'rm -rf' })).toBeNull()
    expect(parseCommand([{ type: 'toggle' }])).toBeNull()
  })

  it('exige un nombre pour les commandes qui en prennent un', () => {
    expect(parseCommand({ type: 'seek' })).toBeNull()
    expect(parseCommand({ type: 'seek', position: '12' })).toBeNull()
    expect(parseCommand({ type: 'volume', value: Number.NaN })).toBeNull()
    expect(parseCommand({ type: 'seek-by', delta: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('borne les valeurs reçues du réseau', () => {
    expect(parseCommand({ type: 'seek', position: -5 })).toEqual({ type: 'seek', position: 0 })
    expect(parseCommand({ type: 'volume', value: 42 })).toEqual({ type: 'volume', value: 1 })
    expect(parseCommand({ type: 'volume', value: -3 })).toEqual({ type: 'volume', value: 0 })
    expect(parseCommand({ type: 'seek-by', delta: 99_999 })).toEqual({
      type: 'seek-by',
      delta: 600
    })
  })

  it('ne garde que les touches connues', () => {
    expect(parseCommand({ type: 'key', key: 'ok' })).toEqual({ type: 'key', key: 'ok' })
    expect(parseCommand({ type: 'key', key: 'Delete' })).toBeNull()
    expect(parseCommand({ type: 'key' })).toBeNull()
  })

  it('ignore les champs en trop plutôt que de les recopier', () => {
    expect(parseCommand({ type: 'toggle', path: '/etc/passwd' })).toEqual({ type: 'toggle' })
  })
})
