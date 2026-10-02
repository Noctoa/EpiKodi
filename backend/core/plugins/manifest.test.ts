import { describe, expect, it } from 'vitest'
import { grants, parseManifest } from './manifest'

const valide = {
  id: 'tvmaze-provider',
  name: 'TVmaze',
  version: '1.0.0',
  description: 'Fiches de séries',
  author: 'EpiKodi',
  main: 'index.js',
  permissions: ['network'],
  contributes: ['metadataProvider']
}

describe('parseManifest', () => {
  it('accepte un manifeste complet et le normalise', () => {
    const { manifest, errors } = parseManifest(valide)
    expect(errors).toEqual([])
    expect(manifest).toMatchObject({
      id: 'tvmaze-provider',
      name: 'TVmaze',
      permissions: ['network'],
      contributes: ['metadataProvider'],
      engine: null
    })
  })

  it('accepte un manifeste minimal', () => {
    const { manifest, errors } = parseManifest({
      id: 'mini',
      name: 'Mini',
      version: '0.1',
      main: 'index.js'
    })
    expect(errors).toEqual([])
    expect(manifest).toMatchObject({ permissions: [], contributes: [], description: null })
  })

  it('signale chaque champ manquant plutôt que de lever', () => {
    const { manifest, errors } = parseManifest({})
    expect(manifest).toBeNull()
    expect(errors.map((e) => e.field).sort()).toEqual(['id', 'main', 'name', 'version'])
  })

  it('refuse un identifiant mal formé', () => {
    for (const id of ['A-Majuscule', 'av', 'avec espace', 'point.point']) {
      expect(parseManifest({ ...valide, id }).errors[0]?.field).toBe('id')
    }
  })

  it('refuse un point d’entrée qui sort du dossier du plugin', () => {
    expect(parseManifest({ ...valide, main: '../../etc/passwd' }).errors[0]?.field).toBe('main')
    expect(parseManifest({ ...valide, main: '/usr/bin/node' }).errors[0]?.field).toBe('main')
  })

  it('refuse une permission ou une contribution inconnue', () => {
    expect(parseManifest({ ...valide, permissions: ['tout'] }).errors[0]?.field).toBe('permissions')
    expect(parseManifest({ ...valide, contributes: ['magie'] }).errors[0]?.field).toBe(
      'contributes'
    )
  })

  it('tolère un manifeste qui n’est pas un objet', () => {
    expect(parseManifest(null).manifest).toBeNull()
    expect(parseManifest('texte').manifest).toBeNull()
    expect(parseManifest([]).errors.length).toBeGreaterThan(0)
  })

  it('n’accorde que les permissions déclarées', () => {
    const { manifest } = parseManifest(valide)
    expect(grants(manifest!, 'network')).toBe(true)
    expect(grants(manifest!, 'library:write')).toBe(false)
  })
})
