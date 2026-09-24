import { describe, expect, it } from 'vitest'
import {
  activeSection,
  back,
  canGoBack,
  currentView,
  initialNav,
  navigate,
  push,
  viewTitle
} from './navigation'

describe('navigation', () => {
  it('démarre sur l’accueil sans retour possible', () => {
    expect(currentView(initialNav)).toEqual({ name: 'home' })
    expect(canGoBack(initialNav)).toBe(false)
    expect(back(initialNav)).toEqual(initialNav)
  })

  it('empile et dépile : musique → artiste → album → retour', () => {
    let n = navigate(initialNav, { name: 'music' })
    n = push(n, { name: 'artist', artist: 'Daft Punk' })
    n = push(n, { name: 'album', artist: 'Daft Punk', album: 'Homework' })
    expect(viewTitle(currentView(n))).toBe('Homework')
    n = back(n)
    expect(viewTitle(currentView(n))).toBe('Daft Punk')
    n = back(n)
    expect(currentView(n).name).toBe('music')
    n = back(n)
    expect(currentView(n).name).toBe('home')
    expect(canGoBack(n)).toBe(false)
  })

  it('un clic dans la barre latérale remet l’historique à plat', () => {
    let n = push(push(navigate(initialNav, { name: 'music' }), { name: 'artist', artist: 'A' }), {
      name: 'detail',
      mediaId: 1
    })
    n = navigate(n, { name: 'videos' })
    expect(n.stack).toHaveLength(2)
    expect(back(n)).toEqual(initialNav)
  })

  it('surligne la bonne section, y compris dans les sous-vues musique', () => {
    expect(activeSection({ name: 'album', artist: 'A', album: 'B' })).toBe('music')
    expect(activeSection({ name: 'artist', artist: 'A' })).toBe('music')
    expect(activeSection({ name: 'sources' })).toBe('sources')
  })

  it('le titre de la vue détail vient du média', () => {
    expect(viewTitle({ name: 'detail', mediaId: 3 }, 'Inception')).toBe('Inception')
    expect(viewTitle({ name: 'detail', mediaId: 3 })).toBe('Détail')
  })
})
