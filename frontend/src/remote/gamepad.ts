import { useEffect, useRef, useState } from 'react'
import type { RemoteCommand } from '@shared/remote'

/**
 * Support manette, via la Gamepad API. Le navigateur n'émet aucun événement de bouton : il faut
 * interroger l'état à chaque image. La boucle ne tourne donc que lorsqu'une manette est branchée.
 *
 * Les boutons produisent les mêmes commandes que le téléphone : une seule implémentation des
 * actions (voir `bridge.ts`), quelle que soit la télécommande.
 */

/** Mappage « standard » de la Gamepad API : Xbox, DualShock, 8BitDo… */
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
}

/** Commandes correspondant à l'état courant d'une manette : boutons tenus et stick poussé. */
export function activeCommands(pad: PadLike): RemoteCommand[] {
  const commands = pad.buttons
    .map((button, index) => (button.pressed ? BUTTONS[index] : undefined))
    .filter((c): c is RemoteCommand => c !== undefined)

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
          .map((pad) => pad.id)
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
