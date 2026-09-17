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
  core/             Logique métier (scan, BDD, métadonnées…)
  plugins/          Système d'extensions
  tsconfig.json     Config TS côté Node
frontend/           UI React (fenêtre Electron, pas de navigateur)
  index.html        Page unique
  src/App.tsx       Écran principal
  src/components/   Composants (Player…)
  src/styles/       Thème, variables CSS
  tsconfig.json     Config TS côté navigateur
shared/             Types et constantes partagés (contrat IPC)
docs/               ADR, architecture, guides
```

Les tests Vitest vivent à côté du code qu'ils testent : `*.test.ts` dans `backend/`,
`frontend/` ou `shared/`. Les configs Prettier et electron-builder sont dans `package.json`.

Le frontend n'a pas accès à Node : tout passe par `window.epikodi` (défini dans
`backend/preload.ts`, typé dans `shared/ipc.ts`).
