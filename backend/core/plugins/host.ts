/**
 * Hôte de plugin. Ce fichier ne s'exécute pas dans l'application : il est lancé dans un
 * process séparé (`utilityProcess`), un par plugin actif. Conséquences voulues :
 *  - un plugin qui plante ou boucle n'emporte pas l'application avec lui ;
 *  - le plugin ne reçoit que l'API que nous lui passons, et seulement ce que son manifeste
 *    déclare (une permission non demandée n'est tout simplement pas exposée).
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { grants, type PluginManifest } from './manifest'
import type { FromPlugin, MenuItem, PluginMatch, ToPlugin } from './protocol'

const send = (message: FromPlugin): void => process.parentPort.postMessage(message)

const log = (level: 'info' | 'warn' | 'error', message: string): void =>
  send({ type: 'log', level, message })

/** Ce qu'un plugin peut enregistrer auprès de l'application. */
interface ProviderRegistration {
  id: string
  name: string
  search(query: {
    title: string
    year: number | null
    kind: 'movie' | 'tv'
  }): Promise<PluginMatch[]>
  details(externalId: string): Promise<PluginMatch | null>
}

interface PluginModule {
  activate?(api: unknown): void | Promise<void>
  deactivate?(): void | Promise<void>
}

let provider: ProviderRegistration | null = null
const menu: MenuItem[] = []
const listeners = new Map<string, ((payload: unknown) => void)[]>()
let loaded: PluginModule | null = null

/** API remise au plugin. Tout ce qui n'est pas ici lui est inaccessible depuis l'application. */
function buildApi(manifest: PluginManifest, dir: string): Record<string, unknown> {
  const api: Record<string, unknown> = {
    manifest,
    /** Dossier du plugin, pour lire ses propres ressources */
    directory: dir,
    log: (message: unknown) => log('info', String(message)),
    warn: (message: unknown) => log('warn', String(message)),

    /** S'abonner à un événement de l'application (« media:scanned », « media:played »). */
    on(event: string, handler: (payload: unknown) => void): void {
      listeners.set(event, [...(listeners.get(event) ?? []), handler])
    },

    /** Déclarer une source de métadonnées, utilisée comme n'importe quelle autre. */
    registerMetadataProvider(registration: ProviderRegistration): void {
      if (!manifest.contributes.includes('metadataProvider')) {
        log('warn', 'registerMetadataProvider ignoré : « metadataProvider » absent de contributes')
        return
      }
      provider = registration
    },

    addMenuItem(item: MenuItem): void {
      if (!manifest.contributes.includes('menu')) {
        log('warn', 'addMenuItem ignoré : « menu » absent de contributes')
        return
      }
      menu.push(item)
    }
  }

  // Le réseau n'est exposé qu'aux plugins qui l'ont demandé
  if (grants(manifest, 'network')) api['fetch'] = globalThis.fetch.bind(globalThis)
  return api
}

async function activate(manifest: PluginManifest, dir: string): Promise<void> {
  const require = createRequire(join(dir, 'package.json'))
  const entry = join(dir, manifest.main)

  const moduleExports = require(entry) as PluginModule & { default?: PluginModule }
  loaded = moduleExports.default ?? moduleExports
  await loaded.activate?.(buildApi(manifest, dir))

  send({
    type: 'ready',
    provides: { metadataProvider: provider !== null, menu }
  })
}

process.parentPort.on('message', (event: { data: ToPlugin }) => {
  const message = event.data
  void (async () => {
    try {
      switch (message.type) {
        case 'activate':
          await activate(message.manifest, message.dir)
          break

        case 'deactivate':
          await loaded?.deactivate?.()
          process.exit(0)
          break

        case 'event':
          // Un gestionnaire fautif ne doit pas interrompre les autres
          for (const handler of listeners.get(message.name) ?? []) {
            try {
              handler(message.payload)
            } catch (err) {
              log('error', `gestionnaire ${message.name} : ${(err as Error).message}`)
            }
          }
          break

        case 'call': {
          if (!provider) throw new Error('aucun fournisseur enregistré')
          const value =
            message.method === 'search'
              ? await provider.search(
                  message.args[0] as Parameters<ProviderRegistration['search']>[0]
                )
              : await provider.details(message.args[0] as string)
          send({ type: 'result', callId: message.callId, value })
          break
        }
      }
    } catch (err) {
      const text = (err as Error).message
      if (message.type === 'call')
        send({ type: 'call-error', callId: message.callId, message: text })
      else send({ type: 'failed', message: text })
    }
  })()
})

// Une erreur non rattrapée dans le plugin est signalée, pas fatale pour l'application
process.on('uncaughtException', (err: Error) => send({ type: 'failed', message: err.message }))
process.on('unhandledRejection', (reason: unknown) =>
  send({ type: 'failed', message: String(reason) })
)
