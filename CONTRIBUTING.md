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
src/
  main/       Process principal Electron (fenêtre, IPC, protocole media://)
  preload/    Pont sécurisé main ↔ renderer (contextBridge)
  renderer/   UI React
  core/       Logique métier indépendante d'Electron (scan, BDD, métadonnées…)
  shared/     Types et constantes partagés (contrat IPC)
  plugins/    Système d'extensions
docs/         ADR, architecture, guides
tests/        Tests Vitest
```
