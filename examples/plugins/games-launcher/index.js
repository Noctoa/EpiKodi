/**
 * Extension d'exemple : une section « Jeux » qui liste les ROM d'un dossier et les lance dans
 * l'émulateur configuré pour leur extension.
 *
 * Rien n'est modifié dans EpiKodi. L'extension déclare une entrée de menu (`contributes: ["menu"]`)
 * et la permission de démarrer un programme (`process:launch`) ; l'application affiche ce que
 * `items()` renvoie dans sa grille habituelle et rappelle `activate()` quand l'utilisateur valide.
 * Ce qu'« ouvrir un jeu » veut dire ne regarde que cette extension.
 *
 * La configuration vit dans `config.json`, à côté de ce fichier : voir `config.example.json`.
 */

const { readdirSync, readFileSync, statSync } = require('node:fs')
const { homedir } = require('node:os')
const { basename, extname, join, resolve, sep } = require('node:path')

/** Profondeur de parcours : assez pour un dossier par console, pas pour explorer tout un disque. */
const MAX_DEPTH = 2

/** Jaquettes : une image lourde par jeu ferait un écran interminable à charger. */
const MAX_COVER_BYTES = 512 * 1024
const COVER_BUDGET_BYTES = 16 * 1024 * 1024

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

/** `~/Jeux` → `/home/moi/Jeux`. Le fichier de configuration est écrit à la main. */
function expand(path) {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path
}

function readConfig(directory) {
  let raw
  try {
    raw = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))
  } catch (err) {
    throw new Error(
      `config.json illisible dans ${directory} : ${err.message}. ` +
        'Copie config.example.json en config.json et renseigne ton dossier de ROM.',
      { cause: err }
    )
  }
  const romsDir = raw && typeof raw.romsDir === 'string' ? expand(raw.romsDir.trim()) : ''
  if (!romsDir) throw new Error('config.json : « romsDir » manquant')

  const emulators = raw.emulators && typeof raw.emulators === 'object' ? raw.emulators : {}
  if (Object.keys(emulators).length === 0) {
    throw new Error('config.json : aucun émulateur déclaré dans « emulators »')
  }
  return { romsDir, emulators }
}

/** Extensions connues : celles déclarées dans la configuration, « default » mis à part. */
function knownExtensions(emulators) {
  return new Set(
    Object.keys(emulators)
      .filter((k) => k !== 'default')
      .map((k) => `.${k.toLowerCase()}`)
  )
}

/** Parcourt le dossier de ROM. Les fichiers cachés et les dossiers trop profonds sont ignorés. */
function findRoms(dir, extensions, depth = 0) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const roms = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) roms.push(...findRoms(path, extensions, depth + 1))
    } else if (extensions.has(extname(entry.name).toLowerCase())) {
      roms.push(path)
    }
  }
  return roms
}

/**
 * Jaquette : une image portant le nom de la ROM, à côté d'elle ou dans `covers/`. Elle part en
 * `data:` — une extension n'a pas de dossier servi par l'application.
 */
function findCover(romPath, romsDir, budget) {
  const name = basename(romPath, extname(romPath))
  const candidates = []
  for (const ext of Object.keys(IMAGE_TYPES)) {
    candidates.push(join(romPath, '..', `${name}${ext}`), join(romsDir, 'covers', `${name}${ext}`))
  }

  for (const candidate of candidates) {
    try {
      const size = statSync(candidate).size
      if (size > MAX_COVER_BYTES || size > budget.left) continue
      budget.left -= size
      const type = IMAGE_TYPES[extname(candidate).toLowerCase()]
      return `data:${type};base64,${readFileSync(candidate).toString('base64')}`
    } catch {
      // image absente : on essaie la suivante
    }
  }
  return null
}

/** « Super_Mario_World (USA).sfc » → « Super Mario World (USA) » */
function prettyTitle(romPath) {
  return basename(romPath, extname(romPath)).replace(/[_.]+/g, ' ').trim()
}

/** L'identifiant d'un élément est son chemin relatif : il doit rester dans le dossier de ROM. */
function romPathOf(romsDir, itemId) {
  const path = resolve(romsDir, itemId)
  if (path !== romsDir && !path.startsWith(romsDir + sep)) {
    throw new Error('chemin hors du dossier de ROM')
  }
  return path
}

exports.activate = (api) => {
  const directory = api.directory

  api.addMenuItem({
    id: 'games',
    label: 'Jeux',
    icon: '⬢',

    items() {
      const { romsDir, emulators } = readConfig(directory)
      const roms = findRoms(romsDir, knownExtensions(emulators))
      if (roms.length === 0) {
        api.warn(`aucune ROM dans ${romsDir} pour les extensions configurées`)
      }

      const budget = { left: COVER_BUDGET_BYTES }
      return roms
        .map((romPath) => ({
          id: romPath.slice(romsDir.length + 1),
          title: prettyTitle(romPath),
          subtitle: extname(romPath).slice(1).toUpperCase(),
          thumbnail: findCover(romPath, romsDir, budget),
          icon: '⬢'
        }))
        .sort((a, b) => a.title.localeCompare(b.title))
    },

    activate(itemId) {
      const { romsDir, emulators } = readConfig(directory)
      const romPath = romPathOf(romsDir, itemId)
      const ext = extname(romPath).slice(1).toLowerCase()
      // Une extension déclarée sans commande (`"gba": null`) retombe sur l'émulateur par défaut
      const declared = emulators[ext]
      const emulator = declared && declared.command ? declared : emulators.default
      if (!emulator || !emulator.command) {
        throw new Error(`aucun émulateur configuré pour « .${ext} » (ni « default »)`)
      }

      // `{rom}` est remplacé par le chemin du jeu ; sans marqueur, il est ajouté en dernier
      const args = Array.isArray(emulator.args) ? emulator.args : []
      const resolved = args.map((arg) => String(arg).replace('{rom}', romPath))
      api.launch(
        emulator.command,
        resolved.join(' ').includes(romPath) ? resolved : [...resolved, romPath]
      )
      api.log(`lancement de ${basename(romPath)} avec ${emulator.command}`)
    }
  })
}
