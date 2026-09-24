# Contribuer

## Workflow

1. Chaque tâche est une issue GitHub liée au [Project](https://github.com/users/Noctoa/projects/2).
2. Une branche par issue : `feat/<n°>-<slug>`, `fix/<n°>-<slug>`.
3. PR vers `main` avec `Closes #<n°>` ; la CI doit être verte.
4. Commits au format [Conventional Commits](https://www.conventionalcommits.org/) : `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

## Commandes

| Commande                | Rôle                                      |
| ----------------------- | ----------------------------------------- |
| `npm run dev`           | Lancer l'app avec hot reload              |
| `npm run lint`          | ESLint                                    |
| `npm run typecheck`     | Vérification TypeScript (main + renderer) |
| `npm test`              | Tests unitaires (Vitest)                  |
| `npm run format`        | Prettier                                  |
| `npm run build`         | Build de production dans `out/`           |
| `npm run package:linux` | AppImage + deb dans `release/`            |

## Structure

```
backend/            Côté Node / Electron (accès disque, FFmpeg, BDD, réseau)
  main.ts           Process principal : fenêtre, IPC, protocole media://
  preload.ts        Pont sécurisé backend ↔ frontend (contextBridge → window.epikodi)
  media-protocol.ts Sert les fichiers locaux au lecteur avec support Range (seek)
  library.ts        Façade : base SQLite, sources, scans en arrière-plan
  core/db/          Schéma, migrations, repositories (voir docs/database.md)
  core/scanner.ts   Indexation d'un dossier (récursif, incrémental, annulable)
  core/ffmpeg.ts    Wrapper ffprobe / ffmpeg (analyse, miniatures)
  core/enricher.ts  File d'enrichissement en arrière-plan (voir docs/metadata.md)
  core/subtitles.ts Sous-titres : .srt/.vtt externes, pistes internes → WebVTT
  plugins/          Système d'extensions
  tsconfig.json     Config TS côté Node
frontend/           UI React (fenêtre Electron, pas de navigateur)
  index.html        Page unique
  src/App.tsx       Écran principal
  src/components/   Composants réutilisables (Sidebar, Grid, FilterBar, MediaDetail, Player…)
  src/views/        Une vue par section (Accueil, Musique, Sources, Paramètres…)
  src/navigation.ts Pile de vues et barre latérale (pure, testée)
  src/library/      Regroupement artistes / albums (pur, testé)
  src/format.ts     Formatage des durées, tailles, résolutions
  src/player/       Lecteur audio : file d'attente (pure), contexte React, conversions
  src/styles/       Thème, variables CSS
  tsconfig.json     Config TS côté navigateur
shared/             Types et constantes partagés (contrat IPC)
docs/               ADR, architecture, guides
```

Les tests Vitest vivent à côté du code qu'ils testent : `*.test.ts` dans `backend/`,
`frontend/` ou `shared/`. Les configs Prettier et electron-builder sont dans `package.json`.

Le frontend n'a pas accès à Node : tout passe par `window.epikodi` (défini dans
`backend/preload.ts`, typé dans `shared/ipc.ts`).
