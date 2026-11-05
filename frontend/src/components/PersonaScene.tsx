import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../theme'
import joker from '../assets/persona/jokergif.gif'
import scene from '../assets/persona/dark-hour.mp4'
import poster from '../assets/persona/dark-hour-poster.webp'

/** Une boucle décorative locale, suspendue hors écran et désactivable sans toucher au lecteur. */
export function PersonaScene(): React.JSX.Element {
  const { persona } = useTheme()
  const p5 = persona === 'p5'
  const [enabled, setEnabled] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = (): void => setEnabled(!preference.matches)
    preference.addEventListener('change', change)
    return () => preference.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    const video = ref.current
    if (!video || !enabled) return
    let inView = true
    const sync = (): void => {
      if (document.hidden || !inView) video.pause()
      else
        void video.play().catch(() => {
          /* Le poster reste visible si l’autoplay est refusé. */
        })
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      sync()
    })
    observer.observe(video)
    document.addEventListener('visibilitychange', sync)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      video.pause()
    }
  }, [enabled, p5])

  return (
    <>
      <div
        className={`home__scene ${p5 ? 'home__scene--p5' : ''} ${enabled ? 'home__scene--animated' : ''}`}
        aria-hidden="true"
      >
        <img src={p5 ? joker : poster} alt="" className="home__scene-poster" />
        {enabled && !p5 && (
          <video ref={ref} src={scene} poster={poster} muted loop playsInline tabIndex={-1} />
        )}
      </div>
      <button
        className="home__motion"
        onClick={() => setEnabled((value) => !value)}
        aria-label={enabled ? 'Désactiver l’animation de fond' : 'Activer l’animation de fond'}
        aria-pressed={enabled}
        title={enabled ? 'Désactiver l’animation de fond' : 'Activer l’animation de fond'}
      >
        <span aria-hidden="true">{enabled ? 'Ⅱ' : '▷'}</span>
        <span>Animation {enabled ? 'ON' : 'OFF'}</span>
      </button>
    </>
  )
}
