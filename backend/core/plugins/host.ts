/**
 * Hôte de plugin. Ce fichier ne s'exécute pas dans l'application : il est lancé dans un
 * process séparé (`utilityProcess`), un par plugin actif. Conséquences voulues :
 *  - un plugin qui plante ou boucle n'emporte pas l'application avec lui ;
 *  - le plugin ne reçoit que l'API que nous lui passons, et seulement ce que son manifeste
 *    déclare (une permission non demandée n'est tout simplement pas exposée).
 */
import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import { grants, type PluginManifest } from './manifest'
import type { FromPlugin, MenuItem, PluginItem, PluginMatch, ToPlugin } from './protocol'

const send = (message: FromPlugin): void => process.parentPort.postMessage(message)

const log = (level: 'info' | 'warn' | 'error', message: string): void =>
  send({ type: 'log', level, message })

/**
 * Retrouve un programme avant de le lancer. `spawn` ne signale une commande absente qu'en
 * asynchrone, sur l'événement `error` : sans cette vérification, l'utilisateur clique sur un jeu
 * et il ne se passe rien, sans la moindre explication.
 */
function resolveCommand(command: string): string {
  const executable = (path: string): boolean => {
    try {
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  // Sur Windows, un programme s'appelle sans son extension : « retroarch » → « retroarch.exe »
  const suffixes =
    process.platform === 'win32' ? ['', ...(process.env['PATHEXT'] ?? '.EXE').split(';')] : ['']
  const candidates = (base: string): string[] => suffixes.map((s) => base + s)

  if (/[\\/]/.test(command)) {
    const found = candidates(command).find(executable)
    if (!found) throw new Error(`${command} : introuvable ou non exécutable`)
    return found
  }

  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const found = candidates(join(dir, command)).find(executable)
    if (found) return found
  }
  throw new Error(`${command} : commande introuvable (ni dans le PATH, ni comme chemin)`)
}

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

/** Ce qu'une entrée de menu sait faire : lister son contenu, et en activer un élément. */
interface MenuRegistration extends MenuItem {
  items?(): PluginItem[] | Promise<PluginItem[]>
  activate?(itemId: string): void | Promise<void>
}

let provider: ProviderRegistration | null = null
const menu: MenuItem[] = []
const menus = new Map<string, MenuRegistration>()
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

    /**
     * Ajoute une entrée dans la barre latérale. `items` est appelée à l'ouverture de l'écran,
     * `activate` quand l'utilisateur valide un élément : c'est le plugin qui décide quoi faire.
     */
    addMenuItem(item: MenuRegistration): void {
      if (!manifest.contributes.includes('menu')) {
        log('warn', 'addMenuItem ignoré : « menu » absent de contributes')
        return
      }
      menus.set(item.id, item)
      menu.push({ id: item.id, label: item.label, icon: item.icon })
    }
  }

  // Le réseau n'est exposé qu'aux plugins qui l'ont demandé
  if (grants(manifest, 'network')) api['fetch'] = globalThis.fetch.bind(globalThis)

  /**
   * Démarre un programme de la machine, détaché : l'émulateur survit à l'extinction du plugin,
   * et sa sortie ne bloque rien. On ne passe pas par un shell — les arguments sont transmis tels
   * quels, donc un nom de fichier biscornu ne peut pas devenir une commande.
   */
  api['launch'] = (command: string, args: string[] = []): void => {
    if (!grants(manifest, 'process:launch')) {
      throw new Error('launch refusé : « process:launch » absent des permissions du manifeste')
    }
    if (typeof command !== 'string' || !command.trim()) throw new Error('commande vide')
    const child = spawn(
      resolveCommand(command.trim()),
      Array.isArray(args) ? args.map(String) : [],
      {
        detached: true,
        stdio: 'ignore',
        shell: false
      }
    )
    child.on('error', (err: Error) => log('error', `${command} : ${err.message}`))
    child.unref()
  }
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

async function handleCall(message: ToPlugin & { type: 'call' }): Promise<unknown> {
  if (message.method === 'items' || message.method === 'activate') {
    const entry = menus.get(message.args[0] as string)
    if (!entry) throw new Error(`entrée de menu inconnue : ${String(message.args[0])}`)
    if (message.method === 'items') return (await entry.items?.()) ?? []
    await entry.activate?.(message.args[1] as string)
    return null
  }

  if (!provider) throw new Error('aucun fournisseur enregistré')
  return message.method === 'search'
    ? await provider.search(message.args[0] as Parameters<ProviderRegistration['search']>[0])
    : await provider.details(message.args[0] as string)
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
          send({ type: 'result', callId: message.callId, value: await handleCall(message) })
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
