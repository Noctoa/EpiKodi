import { describe, expect, it } from 'vitest'
import { SmbProvider } from './smb'
import { parseLocation } from './url'

/**
 * Ces tests parlent à un vrai serveur Samba. Pour le lancer :
 *   docker run -d --name epikodi-smb -p 1445:445 -v /chemin/partage:/share dperson/samba \
 *     -p -u "epikodi;motdepasse" -s "media;/share;yes;no;no;epikodi"
 * Ils sont ignorés si le serveur ne répond pas, pour ne pas casser la CI.
 */
const URL_SMB = process.env['EPIKODI_TEST_SMB'] ?? 'smb://epikodi@localhost:1445/media'
const PASSWORD = process.env['EPIKODI_TEST_SMB_PASSWORD'] ?? 'motdepasse'

const provider = new SmbProvider(parseLocation(URL_SMB), PASSWORD)
const reachable = await provider.available()
if (!reachable) provider.close()

describe.skipIf(!reachable)('SmbProvider', () => {
  it('liste un dossier avec tailles et dates en un seul appel', async () => {
    const racine = await provider.list('')
    expect(racine.map((e) => e.name).sort()).toEqual(['Films', 'Musique'])
    expect(racine.every((e) => e.isDirectory)).toBe(true)

    const musique = await provider.list('Musique')
    const piste = musique.find((e) => e.name.endsWith('.mp3'))!
    expect(piste.isDirectory).toBe(false)
    expect(piste.size).toBeGreaterThan(0)
    expect(piste.mtime).toBeGreaterThan(0)
  })

  it('renvoie taille et date d’un fichier', async () => {
    const [piste] = (await provider.list('Musique')).filter((e) => !e.isDirectory)
    const stat = await provider.stat(`Musique/${piste.name}`)
    expect(stat.size).toBe(piste.size)
  })

  it('lit un fichier entier', async () => {
    const [piste] = (await provider.list('Musique')).filter((e) => !e.isDirectory)
    const stream = await provider.read(`Musique/${piste.name}`)
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(c as Buffer)
    expect(Buffer.concat(chunks)).toHaveLength(piste.size)
  })

  it('lit une plage d’octets : c’est ce qui rend le saut possible à distance', async () => {
    const [piste] = (await provider.list('Musique')).filter((e) => !e.isDirectory)
    const chemin = `Musique/${piste.name}`
    const complet: Buffer[] = []
    for await (const c of await provider.read(chemin)) complet.push(c as Buffer)
    const entier = Buffer.concat(complet)

    const partiel: Buffer[] = []
    for await (const c of await provider.read(chemin, { start: 1000, end: 1015 })) {
      partiel.push(c as Buffer)
    }
    const plage = Buffer.concat(partiel)
    expect(plage).toHaveLength(16)
    expect(plage.equals(entier.subarray(1000, 1016))).toBe(true)
  })

  it('signale une source injoignable sans lever', async () => {
    const absent = new SmbProvider(parseLocation('smb://localhost:1/inexistant'), '')
    expect(await absent.available()).toBe(false)
    absent.close()
  })

  it('expose un libellé lisible et pas d’URL ffmpeg', () => {
    expect(provider.label).toContain('/media')
    expect(provider.ffmpegUrl()).toBeNull()
  })
})
