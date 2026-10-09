import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { parseManifest, type ManifestError, type PluginManifest } from './manifest'
import type { FromPlugin, MenuItem, PluginMatch, ToPlugin } from './protocol'

export interface PluginInfo {
  manifest: PluginManifest
  dir: string
  enabled: boolean
  status: 'inactive' | 'active' | 'error'
  /** Dernière erreur rencontrée : manifeste invalide, chargement raté, plantage */
  error: string | null
  menu: MenuItem[]
  providesMetadata: boolean
}

/** Un dossier dont le manifeste est illisible : signalé à l'utilisateur, jamais chargé. */
export interface BrokenPlugin {
  dir: string
  errors: ManifestError[]
}

export interface ManagerOptions {
  /** Dossier contenant un sous-dossier par plugin */
  pluginsDir: string
  /** Chemin du script d'hôte compilé, lancé dans un process séparé */
  hostScript: string
  isEnabled(id: string): boolean
  setEnabled(id: string, enabled: boolean): void
  onChanged?: () => void
}

interface RunningPlugin {
  process: UtilityProcess
  info: PluginInfo
  /** Arrêt demandé par l'application : la sortie du process n'est alors pas une anomalie */
  stopping: boolean
  /** Appels en attente de réponse du plugin */
  pending: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>
  nextCallId: number
}

const ACTIVATION_TIMEOUT_MS = 10_000
const CALL_TIMEOUT_MS = 20_000

/**
 * Découvre, active et surveille les plugins. Chaque plugin actif tourne dans son propre
 * process : un plugin qui plante est signalé dans les Paramètres, l'application continue.
 */
export class PluginManager {
  private plugins = new Map<string, PluginInfo>()
  private running = new Map<string, RunningPlugin>()
  private broken: BrokenPlugin[] = []

  constructor(private opts: ManagerOptions) {}

  list(): PluginInfo[] {
    return [...this.plugins.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
  }

  brokenPlugins(): BrokenPlugin[] {
    return this.broken
  }

  /** Parcourt le dossier des plugins et lit chaque manifeste, sans rien charger. */
  async discover(): Promise<void> {
    this.broken = []
    let entries: string[]
    try {
      entries = await readdir(this.opts.pluginsDir)
    } catch {
      return // dossier absent : aucun plugin, ce n'est pas une erreur
    }

    for (const entry of entries) {
      const dir = join(this.opts.pluginsDir, entry)
      let raw: unknown
      try {
        raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
      } catch {
        continue // pas de manifeste : ce n'est pas un plugin
      }

      const { manifest, errors } = parseManifest(raw)
      if (!manifest) {
        this.broken.push({ dir, errors })
        console.warn(
          `[plugins] manifeste invalide dans ${entry} :`,
          errors.map((e) => e.message).join(', ')
        )
        continue
      }

      const existing = this.plugins.get(manifest.id)
      this.plugins.set(manifest.id, {
        manifest,
        dir,
        enabled: this.opts.isEnabled(manifest.id),
        status: existing?.status ?? 'inactive',
        error: existing?.error ?? null,
        menu: existing?.menu ?? [],
        providesMetadata: existing?.providesMetadata ?? false
      })
    }
  }

  /** Active tous les plugins marqués comme activés. */
  async activateEnabled(): Promise<void> {
    for (const info of this.plugins.values()) {
      if (info.enabled && !this.running.has(info.manifest.id)) {
        await this.activate(info.manifest.id).catch(() => undefined)
      }
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    this.opts.setEnabled(id, enabled)
    const info = this.plugins.get(id)
    if (info) info.enabled = enabled
    if (enabled) await this.activate(id).catch(() => undefined)
    else this.deactivate(id)
  }

  /** Lance le plugin dans son propre process et attend qu'il se déclare prêt. */
  async activate(id: string): Promise<void> {
    const info = this.plugins.get(id)
    if (!info || this.running.has(id)) return

    const child = utilityProcess.fork(this.opts.hostScript, [], {
      serviceName: `epikodi-plugin-${id}`,
      // La sortie du process est reprise : sans elle, une erreur de chargement du plugin
      // resterait invisible, ce qui rend le développement d'extensions impraticable.
      stdio: 'pipe'
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) console.warn(`[plugin:${id}] ${text}`)
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) console.log(`[plugin:${id}] ${text}`)
    })
    const entry: RunningPlugin = {
      process: child,
      info,
      pending: new Map(),
      stopping: false,
      nextCallId: 1
    }
    this.running.set(id, entry)
    info.status = 'inactive'
    info.error = null

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('le plugin n’a pas répondu')),
        ACTIVATION_TIMEOUT_MS
      )

      child.on('message', (message: FromPlugin) => {
        switch (message.type) {
          case 'ready':
            clearTimeout(timer)
            info.status = 'active'
            info.menu = message.provides.menu
            info.providesMetadata = message.provides.metadataProvider
            this.opts.onChanged?.()
            resolve()
            break
          case 'log':
            console.log(`[plugin:${id}] ${message.message}`)
            break
          case 'failed':
            clearTimeout(timer)
            this.fail(id, message.message)
            reject(new Error(message.message))
            break
          case 'result':
            entry.pending.get(message.callId)?.resolve(message.value)
            entry.pending.delete(message.callId)
            break
          case 'call-error':
            entry.pending.get(message.callId)?.reject(new Error(message.message))
            entry.pending.delete(message.callId)
            break
        }
      })

      // Sortie inattendue : le plugin a planté, l'application continue
      child.on('exit', (code) => {
        clearTimeout(timer)
        this.running.delete(id)
        for (const { reject: rejectCall } of entry.pending.values()) {
          rejectCall(new Error('le plugin s’est arrêté'))
        }
        entry.pending.clear()
        // Une sortie que nous avons provoquée (désactivation, fermeture de l'application) est
        // normale ; seule une sortie subie est signalée comme une erreur.
        // 15 = SIGTERM : quelqu'un a demandé l'arrêt (fermeture de l'application), pas un plantage
        if (!entry.stopping && info.status !== 'error' && code !== 0 && code !== 15) {
          this.fail(id, `le plugin s’est arrêté (code ${code})`)
          reject(new Error('arrêt inattendu'))
        }
      })
    })

    // Un message posté avant que le process ne soit réellement démarré est perdu : on attend
    // l'événement `spawn`. Sans cela l'activation échoue par intermittence, selon la charge.
    child.once('spawn', () =>
      this.post(id, { type: 'activate', manifest: info.manifest, dir: info.dir })
    )
    await ready
  }

  deactivate(id: string): void {
    const entry = this.running.get(id)
    if (!entry) return
    entry.stopping = true
    this.post(id, { type: 'deactivate' })
    setTimeout(() => entry.process.kill(), 1000)
    this.running.delete(id)
    entry.info.status = 'inactive'
    this.opts.onChanged?.()
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.deactivate(id)
  }

  /** Diffuse un événement à tous les plugins actifs. */
  emit(name: string, payload: unknown): void {
    for (const id of this.running.keys()) this.post(id, { type: 'event', name, payload })
  }

  /** Appelle une fonction fournie par un plugin et attend sa réponse. */
  call(id: string, method: 'search' | 'details', ...args: unknown[]): Promise<unknown> {
    const entry = this.running.get(id)
    if (!entry) return Promise.reject(new Error(`plugin ${id} inactif`))

    const callId = entry.nextCallId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(callId)
        reject(new Error('le plugin n’a pas répondu à temps'))
      }, CALL_TIMEOUT_MS)

      entry.pending.set(callId, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
      this.post(id, { type: 'call', callId, method, args })
    })
  }

  /** Plugins actifs déclarant fournir des métadonnées. */
  metadataPlugins(): PluginInfo[] {
    return [...this.running.values()].map((r) => r.info).filter((i) => i.providesMetadata)
  }

  private post(id: string, message: ToPlugin): void {
    this.running.get(id)?.process.postMessage(message)
  }

  private fail(id: string, message: string): void {
    const info = this.plugins.get(id)
    if (!info) return
    info.status = 'error'
    info.error = message
    console.warn(`[plugins] ${id} : ${message}`)
    this.opts.onChanged?.()
  }
}

/** Convertit un résultat de plugin en correspondance exploitable par l'application. */
export const toMatch = (
  raw: PluginMatch,
  providerId: string
): PluginMatch & { provider: string } => ({
  ...raw,
  provider: providerId
})
