import { useEffect, useRef, useState } from 'react'
import { cursorElement, enterCursor, focusCursor, isCursorVisible } from './focus'

/** Retarde la propagation d'une valeur (saisie au clavier → requête). */
export function useDebounced<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/**
 * Comportement commun des boîtes modales : **Échap** ferme, le curseur de la télécommande y entre
 * à l'ouverture (il n'en sortira pas, voir `openTrap`) et revient à son point de départ à la
 * fermeture. Passer `null` quand la boîte est fermée.
 */
export function useModal(onClose: (() => void) | null): void {
  const open = onClose !== null
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    if (!open) return
    // La position du curseur, pas le focus brut : une boîte qui focalise son champ de recherche
    // à l'ouverture l'a déjà déplacé, et ce champ disparaîtra avec elle.
    const from = cursorElement()
    enterCursor()

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Le bouton qui a ouvert la boîte récupère le curseur, s'il est toujours là
      if (from?.isConnected && isCursorVisible()) focusCursor(from)
    }
  }, [open])
}
