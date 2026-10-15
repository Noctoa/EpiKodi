import { useCallback, useEffect, useRef, useState } from 'react'
import { REMOTE_IDLE, type RemoteCommand, type RemoteKey, type RemoteState } from '@shared/remote'
import { useAudioPlayer, type AudioPlayerApi } from '@frontend/player/AudioPlayerContext'
import { firstFocusable, focusCursor } from '@frontend/focus'
import { videoControl, type MediaControl } from './control'
import { useGamepad } from './gamepad'

/**
 * Pont entre les télécommandes et les lecteurs : applique les commandes reçues (téléphone via le
 * process principal, manette via la Gamepad API) et publie l'état du lecteur une fois par seconde.
 *
 * Les touches directionnelles sont rejouées en événements clavier plutôt que traitées ici : les
 * raccourcis existent déjà dans le lecteur et dans l'application, une télécommande ne doit pas en
 * être une deuxième implémentation.
 */
const KEYBOARD: Partial<Record<RemoteKey, string>> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  ok: 'Enter',
  back: 'Escape'
}

/**
 * Classe posée sur `<body>` tant que l'on navigue à la télécommande. Le focus est alors déplacé
 * par programme : `:focus-visible`, qui ne s'allume que pour une interaction clavier réelle,
 * laisserait la navigation invisible à l'écran. La classe tombe dès que la souris bouge.
 */
const REMOTE_NAV = 'remote-nav'

/**
 * Déclenche l'élément sous le curseur. Un `keydown` synthétique ne provoque pas l'action par
 * défaut d'un bouton — seul un événement de confiance le fait — donc « OK » sur « Lire » ne
 * faisait rien. On clique explicitement ; les composants qui gèrent Entrée eux-mêmes (la grille)
 * reçoivent la touche par le chemin normal, plus bas.
 */
function activate(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || !el.matches('button, a, [role="button"]')) return false
  el.click()
  return true
}

function pressKey(key: string): void {
  const active = document.activeElement
  const focused = active instanceof HTMLElement && active !== document.body ? active : null
  // Toute touche sauf Retour peut servir à entrer dans la vue ; Retour, lui, doit agir même
  // quand le curseur s'est perdu (sortie du lecteur, écran sans élément atteignable).
  if (!focused && key !== 'Escape') {
    const first = firstFocusable()
    if (first) {
      focusCursor(first)
      return
    }
  }
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  ;(focused ?? window).dispatchEvent(event)
}

/** La file audio vue comme un lecteur ; `null` quand rien n'est chargé. */
function audioControl(audio: AudioPlayerApi): MediaControl | null {
  const track = audio.current
  if (!track) return null
  return {
    source: 'audio',
    snapshot: () => ({
      playing: audio.status.playing,
      title: track.title,
      subtitle: [track.artist, track.album].filter(Boolean).join(' · ') || null,
      position: audio.status.time,
      duration: audio.status.duration,
      volume: audio.status.volume,
      muted: audio.status.muted
    }),
    toggle: audio.toggle,
    play: () => {
      if (!audio.status.playing) audio.toggle()
    },
    pause: audio.pause,
    stop: audio.clear,
    next: audio.next,
    prev: audio.prev,
    seekTo: audio.seek,
    seekBy: (delta) => audio.seek(Math.max(0, audio.status.time + delta)),
    setVolume: audio.setVolume,
    toggleMute: audio.toggleMute
  }
}

function stateOf(control: MediaControl | null, view: string): RemoteState {
  if (!control) return { ...REMOTE_IDLE, view }
  return { source: control.source, view, ...control.snapshot() }
}

export interface RemoteOptions {
  /** Titre de la vue affichée, pour que l'on se repère depuis le téléphone */
  view: string
  /** Touches sans équivalent clavier : « Accueil » */
  onKey(key: RemoteKey): void
}

export function useRemote({ view, onKey }: RemoteOptions): void {
  const audio = useAudioPlayer()
  const audioRef = useRef(audio)
  const keyRef = useRef(onKey)
  useEffect(() => {
    audioRef.current = audio
    keyRef.current = onKey
  })

  /** Le lecteur vidéo a la priorité : c'est lui qui occupe l'écran. */
  const target = useCallback(
    (): MediaControl | null => videoControl() ?? audioControl(audioRef.current),
    []
  )

  const apply = useCallback(
    (command: RemoteCommand): void => {
      const control = target()
      switch (command.type) {
        case 'key': {
          document.body.classList.add(REMOTE_NAV)
          // Devant une vidéo, « OK » vaut lecture / pause, comme sur une télécommande de salon
          if (command.key === 'ok' && videoControl()) return videoControl()?.toggle()
          if (command.key === 'ok' && activate()) return
          const key = KEYBOARD[command.key]
          if (key) pressKey(key)
          else keyRef.current(command.key)
          return
        }
        case 'toggle':
          return control?.toggle()
        case 'play':
          return control?.play()
        case 'pause':
          return control?.pause()
        case 'stop':
          return control?.stop()
        case 'next':
          return control?.next?.()
        case 'prev':
          return control?.prev?.()
        case 'seek':
          return control?.seekTo(command.position)
        case 'seek-by':
          return control?.seekBy(command.delta)
        case 'volume':
          return control?.setVolume(command.value)
        case 'mute':
          return control?.toggleMute()
      }
    },
    [target]
  )

  useEffect(() => window.epikodi.onRemoteCommand(apply), [apply])
  useGamepad(apply)

  // Retour à la souris : le focus redevient discret, comme avant
  useEffect(() => {
    const drop = (): void => {
      if (document.body.classList.contains(REMOTE_NAV)) {
        document.body.classList.remove(REMOTE_NAV)
      }
    }
    window.addEventListener('pointerdown', drop)
    window.addEventListener('pointermove', drop, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', drop)
      window.removeEventListener('pointermove', drop)
    }
  }, [])

  // Rien n'est publié tant que le serveur n'écoute pas : la manette, elle, marche sans serveur
  const [running, setRunning] = useState(false)
  useEffect(() => {
    let cancelled = false
    void window.epikodi.remoteStatus().then((status) => {
      if (!cancelled) setRunning(status.running)
    })
    const off = window.epikodi.onRemoteChanged((status) => setRunning(status.running))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // Changement d'écran à la télécommande : le curseur se pose sur le premier élément de la vue.
  // Sans cela, « OK » n'a rien sous la main en arrivant, et la direction suivante repart de zéro.
  useEffect(() => {
    if (!document.body.classList.contains(REMOTE_NAV)) return
    const first = firstFocusable()
    if (first) focusCursor(first)
  }, [view])

  useEffect(() => {
    if (!running) return
    const publish = (): void => window.epikodi.remotePublish(stateOf(target(), view))
    publish()
    const timer = setInterval(publish, 1000)
    return () => clearInterval(timer)
  }, [running, view, target])
}
