# Scanner de bibliothèque

Code : `backend/core/scanner.ts` (logique pure, testée) et `backend/library.ts` (orchestration).

## Fonctionnement

1. Charge en mémoire ce que la BDD connaît de la source : `chemin → { mtime, size }`.
2. Parcourt le dossier récursivement avec `fs.opendir` (asynchrone, ne bloque pas le process).
   Ignorés : dossiers cachés, `node_modules`, `.git`, corbeilles, fichiers sans extension média.
3. Pour chaque fichier média :
   - inconnu → **ajouté**
   - `mtime` ou `size` différent → **mis à jour**
   - identique → rien (c'est ce qui rend un rescan quasi gratuit)
4. Écritures par lots de 200 dans une transaction (`media.upsert`, clé `(source_id, path)` →
   jamais de doublon).
5. À la fin, `media.removeMissing` supprime les entrées dont le fichier a disparu.
   Un scan **annulé** saute cette étape : on ne supprime pas ce qu'on n'a pas eu le temps de revoir.

Le titre initial est dérivé du nom de fichier (`Mon.Film.2019.mkv` → `Mon Film 2019`) ; ffprobe (#5)
et TheMovieDB (#14) l'affineront ensuite.

## Côté application

- `sources:add` ouvre le sélecteur de dossier, crée la source et lance le scan.
- Le scan tourne en arrière-plan ; la progression (`scan:progress`) est envoyée au frontend à
  chaque lot et à la fin (`done: true`, ou `error`).
- Un seul scan par source à la fois ; `sources:cancel-scan` l'interrompt (`AbortController`).
- Au démarrage, toutes les sources sont rescannées.

## Mesures

500 fichiers (jeu de test généré) : scan initial ≈ 150 ms, rescan sans changement ≈ 100 ms.
