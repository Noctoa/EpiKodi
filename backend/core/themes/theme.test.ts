import { describe, expect, it } from 'vitest'
import { isSafeValue, parseTheme } from './theme'

const valide = {
  id: 'salon',
  name: 'Salon',
  description: 'Grandes vignettes',
  author: 'EpiKodi',
  base: 'dark',
  tokens: { '--accent': '#ffcc00', '--tile-min': '280px' }
}

describe('parseTheme', () => {
  it('accepte un thème complet', () => {
    const { theme, errors } = parseTheme(valide)
    expect(errors).toEqual([])
    expect(theme).toMatchObject({
      id: 'salon',
      base: 'dark',
      tokens: { '--accent': '#ffcc00', '--tile-min': '280px' }
    })
  })

  it('accepte les noms de variables sans le préfixe', () => {
    const { theme } = parseTheme({ ...valide, tokens: { accent: '#fff' } })
    expect(theme?.tokens).toEqual({ '--accent': '#fff' })
  })

  it('prend « dark » comme base par défaut', () => {
    const { theme } = parseTheme({ id: 'mini', name: 'Mini' })
    expect(theme).toMatchObject({ base: 'dark', tokens: {} })
  })

  it('signale les champs manquants sans lever', () => {
    const { theme, errors } = parseTheme({})
    expect(theme).toBeNull()
    expect(errors.map((e) => e.field).sort()).toEqual(['id', 'name'])
  })

  it('refuse une variable qui n’existe pas', () => {
    const { errors } = parseTheme({ ...valide, tokens: { '--inconnue': '#fff' } })
    expect(errors[0].message).toContain('inconnue')
  })

  it('refuse une base inattendue', () => {
    expect(parseTheme({ ...valide, base: 'fluo' }).errors[0].field).toBe('base')
  })
})

describe('isSafeValue', () => {
  it('accepte couleurs, longueurs et polices', () => {
    for (const valeur of [
      '#fff',
      '#ffcc00',
      '#ffcc0080',
      'rgb(10, 20, 30)',
      'rgba(10, 20, 30, 0.5)',
      'hsl(210, 50%, 40%)',
      '280px',
      '1.4rem',
      '100%',
      "Georgia, 'Times New Roman', serif"
    ]) {
      expect(isSafeValue(valeur), valeur).toBe(true)
    }
  })

  it('refuse toute tentative de sortir de la déclaration', () => {
    // Un thème est un fichier fourni par un tiers : ses valeurs finissent dans une feuille
    // de style, il ne doit donc pas pouvoir injecter de règles supplémentaires.
    for (const valeur of [
      'red; position: fixed',
      '#fff } body { display: none',
      'url(https://exemple.org/pixel.png)',
      "url('data:image/svg+xml;base64,AAA')",
      'expression(alert(1))',
      '@import url(x)',
      'javascript:alert(1)',
      '<script>',
      '#fff\\00003b'
    ]) {
      expect(isSafeValue(valeur), valeur).toBe(false)
    }
  })

  it('refuse le vide et les valeurs démesurées', () => {
    expect(isSafeValue('')).toBe(false)
    expect(isSafeValue('   ')).toBe(false)
    expect(isSafeValue('a'.repeat(300))).toBe(false)
  })

  it('une valeur refusée invalide le thème entier plutôt que d’être ignorée', () => {
    const { theme, errors } = parseTheme({
      ...valide,
      tokens: { '--accent': 'red; position: fixed' }
    })
    expect(theme).toBeNull()
    expect(errors[0].message).toContain('refusée')
  })
})
