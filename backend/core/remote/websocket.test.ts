import { describe, expect, it } from 'vitest'
import { acceptKey, decodeFrames, encodeFrame, OPCODE } from './websocket'

const text = (s: string): Buffer => Buffer.from(s, 'utf8')

describe('acceptKey', () => {
  it('calcule la réponse du handshake de la RFC 6455', () => {
    // Exemple de la RFC 6455 §1.3
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
  })
})

describe('decodeFrames', () => {
  it('lit une trame masquée envoyée par un client', () => {
    const { frames, rest } = decodeFrames(encodeFrame(OPCODE.text, text('salut'), true))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ fin: true, opcode: OPCODE.text })
    expect(frames[0].payload.toString()).toBe('salut')
    expect(rest).toHaveLength(0)
  })

  it('lit plusieurs trames arrivées dans le même paquet', () => {
    const buffer = Buffer.concat([
      encodeFrame(OPCODE.text, text('un'), true),
      encodeFrame(OPCODE.ping, Buffer.alloc(0), true),
      encodeFrame(OPCODE.text, text('deux'), true)
    ])
    const { frames } = decodeFrames(buffer)
    expect(frames.map((f) => f.opcode)).toEqual([OPCODE.text, OPCODE.ping, OPCODE.text])
    expect(frames[2].payload.toString()).toBe('deux')
  })

  it('garde une trame coupée en deux pour le paquet suivant', () => {
    const frame = encodeFrame(OPCODE.text, text('un message coupé'), true)
    const first = decodeFrames(frame.subarray(0, 8))
    expect(first.frames).toHaveLength(0)
    expect(first.rest).toHaveLength(8)

    const second = decodeFrames(Buffer.concat([first.rest, frame.subarray(8)]))
    expect(second.frames[0].payload.toString()).toBe('un message coupé')
  })

  it('gère les longueurs sur 16 bits', () => {
    const payload = text('a'.repeat(5000))
    const { frames } = decodeFrames(encodeFrame(OPCODE.text, payload, true))
    expect(frames[0].payload).toHaveLength(5000)
  })

  it('signale une trame client non masquée', () => {
    const { error } = decodeFrames(encodeFrame(OPCODE.text, text('clair')))
    expect(error).toMatch(/masquée/)
  })

  it('refuse une trame plus grande que la limite', () => {
    const { error } = decodeFrames(encodeFrame(OPCODE.text, text('a'.repeat(200)), true), 64)
    expect(error).toMatch(/trop grande/)
  })
})

describe('encodeFrame', () => {
  it('marque la trame finale et n’applique pas de masque côté serveur', () => {
    const frame = encodeFrame(OPCODE.text, text('ok'))
    expect(frame[0]).toBe(0x80 | OPCODE.text)
    expect(frame[1]).toBe(2)
    expect(frame.subarray(2).toString()).toBe('ok')
  })

  it('bascule sur une longueur étendue au-delà de 125 octets', () => {
    expect(encodeFrame(OPCODE.text, text('a'.repeat(126)))[1]).toBe(126)
    expect(encodeFrame(OPCODE.text, text('a'.repeat(70_000)))[1]).toBe(127)
  })
})
