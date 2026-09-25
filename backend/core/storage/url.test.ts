import { describe, expect, it } from 'vitest'
import { formatLocation, parseLocation, suggestName } from './url'

describe('parseLocation', () => {
  it('reconnaît un chemin local', () => {
    expect(parseLocation('/home/moi/Vidéos')).toMatchObject({
      type: 'local',
      path: '/home/moi/Vidéos'
    })
    expect(parseLocation('/home/moi/Vidéos/')).toMatchObject({ path: '/home/moi/Vidéos' })
  })

  it('découpe un partage SMB en hôte, partage et sous-dossier', () => {
    expect(parseLocation('smb://nas/media/Films/2024')).toMatchObject({
      type: 'smb',
      host: 'nas',
      port: 445,
      share: 'media',
      path: 'Films/2024'
    })
  })

  it('extrait les identifiants de l’URL pour ne pas les stocker en clair', () => {
    const loc = parseLocation('smb://ugo:secret@nas/media')
    expect(loc).toMatchObject({ username: 'ugo', password: 'secret', host: 'nas', share: 'media' })
    // l'URL réaffichée ne contient jamais le mot de passe
    expect(formatLocation(loc)).toBe('smb://ugo@nas/media')
  })

  it('gère un port explicite et les caractères encodés', () => {
    expect(parseLocation('smb://mon%20nom@192.168.1.10:1445/partage')).toMatchObject({
      host: '192.168.1.10',
      port: 1445,
      username: 'mon nom'
    })
  })

  it('accepte cifs, nfs, http, https et webdav', () => {
    expect(parseLocation('cifs://nas/media').type).toBe('smb')
    expect(parseLocation('nfs://serveur/export/media')).toMatchObject({
      type: 'nfs',
      share: 'export'
    })
    expect(parseLocation('http://dav.example/media').type).toBe('http')
    expect(parseLocation('https://dav.example/media').type).toBe('http')
    expect(parseLocation('webdav://dav.example/media').type).toBe('http')
  })

  it('met tout le chemin côté serveur en HTTP', () => {
    expect(parseLocation('https://dav.example/dav/media')).toMatchObject({
      share: '',
      path: 'dav/media'
    })
  })

  it('propose un nom lisible', () => {
    expect(suggestName(parseLocation('smb://nas/media/Films'))).toBe('Films')
    expect(suggestName(parseLocation('smb://nas/media'))).toBe('media')
    expect(suggestName(parseLocation('/home/moi/Musique'))).toBe('Musique')
  })
})
