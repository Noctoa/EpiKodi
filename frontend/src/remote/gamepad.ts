import { useEffect, useRef, useState } from 'react'
import type { RemoteCommand, RemoteKey } from '@shared/remote'

/**
 * Support manette, via la Gamepad API. Le navigateur n'émet aucun événement de bouton : il faut
 * interroger l'état à chaque image. La boucle ne tourne donc que lorsqu'une manette est branchée.
 *
 * Les boutons produisent les mêmes commandes que le téléphone : une seule implémentation des
 * actions (voir `bridge.ts`), quelle que soit la télécommande.
 */

/**
 * Disposition « standard » de la Gamepad API : le navigateur normalise lui-même Xbox, DualShock,
 * 8BitDo, Switch Pro… vers ces index. Une seule table couvre donc tout ce parc.
 */
const BUTTONS: Record<number, RemoteCommand> = {
  0: { type: 'key', key: 'ok' }, // A / croix
  1: { type: 'key', key: 'back' }, // B / rond
  2: { type: 'toggle' }, // X / carré
  3: { type: 'mute' }, // Y / triangle
  4: { type: 'prev' }, // L1
  5: { type: 'next' }, // R1
  6: { type: 'seek-by', delta: -30 }, // L2
  7: { type: 'seek-by', delta: 30 }, // R2
  9: { type: 'key', key: 'home' }, // Start
  12: { type: 'key', key: 'up' },
  13: { type: 'key', key: 'down' },
  14: { type: 'key', key: 'left' },
  15: { type: 'key', key: 'right' }
}

/**
 * Manette que le navigateur ne sait pas normaliser (`mapping` vide) : les index des boutons sont
 * ceux du pilote, on ne peut rien en déduire. Seuls les deux premiers boutons sont une convention
 * assez répandue pour être tenue — tout le reste passe par le stick et la croix.
 */
const GENERIC_BUTTONS: Record<number, RemoteCommand> = {
  0: { type: 'key', key: 'ok' },
  1: { type: 'key', key: 'back' }
}

/** Au-delà, le stick gauche vaut une croix directionnelle. */
const DEADZONE = 0.6

/** Première répétition d'une direction maintenue, puis cadence (millisecondes). */
const FIRST_REPEAT = 400
const REPEAT = 140

/** Ce qui se répète si l'on maintient : la navigation. Pas lecture/pause ni muet. */
const REPEATABLE = new Set(['key:up', 'key:down', 'key:left', 'key:right'])

export interface PadLike {
  buttons: readonly { pressed: boolean }[]
  axes: readonly number[]
  /** « standard » quand le navigateur reconnaît la disposition ; vide sinon */
  mapping?: string
}

/**
 * Croix directionnelle d'une manette non normalisée : c'est souvent un « hat switch », un axe
 * supplémentaire qui code les huit directions entre -1 et 1, et sort des bornes au repos.
 */
export function hatDirections(value: number): RemoteKey[] {
  if (!Number.isFinite(value) || Math.abs(value) > 1) return []
  return HAT[Math.round((value + 1) * 3.5)] ?? []
}

const HAT: RemoteKey[][] = [
  ['up'],
  ['up', 'right'],
  ['right'],
  ['down', 'right'],
  ['down'],
  ['down', 'left'],
  ['left'],
  ['up', 'left']
]

/** Commandes correspondant à l'état courant d'une manette : boutons tenus et stick poussé. */
export function activeCommands(pad: PadLike): RemoteCommand[] {
  // `mapping` absent : manette d'un test, traitée comme normalisée
  const standard = pad.mapping === undefined || pad.mapping === 'standard'
  const layout = standard ? BUTTONS : GENERIC_BUTTONS
  const commands = pad.buttons
    .map((button, index) => (button.pressed ? layout[index] : undefined))
    .filter((c): c is RemoteCommand => c !== undefined)

  // Les axes au-delà des deux sticks ne servent qu'aux manettes non normalisées : sur une
  // manette standard, la croix directionnelle est déjà dans les boutons 12 à 15.
  if (!standard) {
    for (const axis of pad.axes.slice(4)) {
      for (const key of hatDirections(axis)) commands.push({ type: 'key', key })
    }
  }

  const [x = 0, y = 0] = pad.axes
  if (y <= -DEADZONE) commands.push({ type: 'key', key: 'up' })
  if (y >= DEADZONE) commands.push({ type: 'key', key: 'down' })
  if (x <= -DEADZONE) commands.push({ type: 'key', key: 'left' })
  if (x >= DEADZONE) commands.push({ type: 'key', key: 'right' })
  return commands
}

/** Identité d'une commande : la croix et le stick poussés ensemble ne comptent qu'une fois. */
export function commandKey(command: RemoteCommand): string {
  return command.type === 'key' ? `key:${command.key}` : command.type
}

/**
 * Manettes branchées. Le navigateur ne les révèle qu'après une première pression, pour éviter
 * qu'une page identifie la machine sans action de l'utilisateur.
 */
export function useGamepadIds(): string[] {
  const [ids, setIds] = useState<string[]>([])

  useEffect(() => {
    const update = (): void =>
      setIds(
        (navigator.getGamepads?.() ?? [])
          .filter((pad): pad is Gamepad => pad !== null)
          // Une manette non normalisée n'a que ses sticks et ses deux premiers boutons : le dire
          .map((pad) => (pad.mapping === 'standard' ? pad.id : `${pad.id} (disposition inconnue)`))
      )
    update()
    window.addEventListener('gamepadconnected', update)
    window.addEventListener('gamepaddisconnected', update)
    return () => {
      window.removeEventListener('gamepadconnected', update)
      window.removeEventListener('gamepaddisconnected', update)
    }
  }, [])

  return ids
}

/** Traduit les pressions en commandes, avec auto-répétition des directions maintenues. */
export function useGamepad(onCommand: (command: RemoteCommand) => void): string[] {
  const ids = useGamepadIds()
  const latest = useRef(onCommand)
  useEffect(() => {
    latest.current = onCommand
  }, [onCommand])

  const connected = ids.length > 0
  useEffect(() => {
    if (!connected) return
    /** Par commande maintenue : l'instant du prochain envoi */
    const held = new Map<string, number>()
    let frame = requestAnimationFrame(tick)

    function tick(): void {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      const active = new Map<string, RemoteCommand>()
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (pad) for (const command of activeCommands(pad)) active.set(commandKey(command), command)
      }
      for (const key of [...held.keys()]) if (!active.has(key)) held.delete(key)

      for (const [key, command] of active) {
        const due = held.get(key)
        if (due === undefined) {
          held.set(key, now + FIRST_REPEAT)
          latest.current(command)
        } else if (REPEATABLE.has(key) && now >= due) {
          held.set(key, now + REPEAT)
          latest.current(command)
        }
      }
    }

    return () => cancelAnimationFrame(frame)
  }, [connected])

  return ids
}
