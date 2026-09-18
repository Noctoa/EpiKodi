# Base de données

EpiKodi stocke sa bibliothèque dans un fichier **SQLite** unique, via le module `node:sqlite`
intégré à Node (aucune dépendance native à compiler).

- Emplacement : `app.getPath('userData')/epikodi.db` → `~/.config/epikodi/epikodi.db` sur Linux
- Mode WAL activé (lectures pendant les écritures du scanner)
- `PRAGMA foreign_keys = ON` (sinon SQLite ignore les `ON DELETE CASCADE`)
- Code : `backend/core/db/`

Pour l'ouvrir à la main : `sqlite3 ~/.config/epikodi/epikodi.db` puis `.tables`, `.schema media`,
`SELECT * FROM sources;`. Le client `sqlite3` s'installe avec `pacman -S sqlite` / `apt install sqlite3`.

## Schéma (v2)

```
sources 1 ──< media 1 ──1 media_metadata
                 │
                 ├──< playlist_items >── 1 playlists
                 │
                 └──1 playback_state
```

| Table            | Rôle                                                             | Rempli par               |
| ---------------- | ---------------------------------------------------------------- | ------------------------ |
| `sources`        | Dossier local ou partage réseau (`local`, `smb`, `nfs`, `http`)  | UI « Sources »           |
| `media`          | Un fichier découvert : chemin, type, titre, taille, mtime, durée | Scanner (#4)             |
| `media_metadata` | Codecs, résolution, tags audio, synopsis, affiche, id TMDB       | ffprobe (#5), TMDB (#14) |
| `playlists`      | Listes de lecture nommées                                        | UI (#17)                 |
| `playlist_items` | Contenu ordonné d'une playlist (`position`)                      | UI (#17)                 |
| `playback_state` | Position de reprise, terminé, favori, nombre de lectures         | Lecteur (#17)            |

Conventions :

- Clés primaires `INTEGER PRIMARY KEY` (rowid), dates en timestamp Unix (`unixepoch()`).
- `media` est unique sur `(source_id, path)` : un rescan met à jour, ne duplique jamais.
- Toutes les tables filles sont en `ON DELETE CASCADE` : supprimer une source nettoie tout.
- `media.mtime` + `media.size` servent à détecter un fichier modifié sans le hasher.
- `media.probed_at` (v2) : `NULL` = en attente d'analyse ffprobe ; remis à `NULL` si le fichier change.
- Côté TypeScript, les colonnes `snake_case` deviennent `camelCase` (`shared/models.ts`).

## Couche d'accès

Pas de SQL en dehors de `backend/core/db/repositories/`. Chaque fonction prend la `Database` en
premier argument, ce qui permet d'utiliser une base `:memory:` dans les tests.

```ts
import { openDatabase, sources, media } from './core/db'

const db = openDatabase(':memory:')
const src = sources.create(db, { type: 'local', path: '/home/me/Vidéos', name: 'Vidéos' })
media.upsert(db, {
  sourceId: src.id,
  path: '/home/me/Vidéos/a.mp4',
  type: 'video',
  title: 'a',
  size: 1,
  mtime: 1
})
media.list(db, { type: 'video', search: 'a' })
```

Modules : `sources`, `media` (+ `getMetadata` / `setMetadata`), `playlists`, `playback`.
Helpers dans `database.ts` : `all<T>`, `one<T>`, `run`, `transaction`.

## Migrations

La version du schéma est stockée dans `PRAGMA user_version`. Au démarrage, `openDatabase()`
applique dans une transaction chaque migration de `migrations.ts` dont la version est supérieure.

Pour faire évoluer le schéma :

1. Ajouter un objet `{ version: N+1, name, sql }` à la fin du tableau `migrations`.
2. Ne **jamais** modifier une migration déjà livrée.
3. Adapter les types dans `shared/models.ts` et le repository concerné.
4. Ajouter un test dans `database.test.ts`.

Tests : `npm test` — les tests de `backend/core/db/database.test.ts` couvrent migrations, CRUD,
cascades, upsert et playlists sur une base en mémoire.
