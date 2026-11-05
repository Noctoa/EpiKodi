# Base de données

EpiKodi stocke sa bibliothèque dans un fichier **SQLite** unique, via le module `node:sqlite`
intégré à Node (aucune dépendance native à compiler).

- Emplacement : `app.getPath('userData')/epikodi.db` → `~/.config/epikodi/epikodi.db` sur Linux
- Mode WAL activé (lectures pendant les écritures du scanner)
- `PRAGMA foreign_keys = ON` (sinon SQLite ignore les `ON DELETE CASCADE`)
- Code : `backend/core/db/`

Pour l'ouvrir à la main : `sqlite3 ~/.config/epikodi/epikodi.db` puis `.tables`, `.schema media`,
`SELECT * FROM sources;`. Le client `sqlite3` s'installe avec `pacman -S sqlite` / `apt install sqlite3`.

## Schéma (v16)

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
| `profiles`       | Personnes du foyer : nom, avatar                                 | Écran des profils (#33)  |

Les tables des podcasts, de l'IPTV et du guide des programmes sont décrites dans
[podcasts.md](podcasts.md) et [iptv.md](iptv.md).

## Profils (v14)

Plusieurs personnes partagent la machine. **La bibliothèque est commune** (sources, médias,
métadonnées, flux de podcasts et leurs épisodes, chaînes, guides) : on ne scanne pas deux fois le
même disque. **Ce qui relève de la personne porte un `profile_id`** et part avec son profil
(`ON DELETE CASCADE`) :

| Table                   | Contenu personnel                                       |
| ----------------------- | ------------------------------------------------------- |
| `playback_state`        | Reprise, terminé, favori — clé `(profile_id, media_id)` |
| `playlists`             | Playlists (leurs `playlist_items` suivent par cascade)  |
| `podcast_subscriptions` | Qui suit quel flux ; un flux sans abonné est supprimé   |
| `podcast_progress`      | Position et « écouté » d'un épisode                     |
| `iptv_favorites`        | Chaînes favorites                                       |
| `profile_settings`      | Réglages personnels : `ui.theme`, `iptv.lastChannel`    |

Le **profil actif est tenu par le backend** (`activeProfileId()` dans `backend/library.ts`) :
chaque repository reçoit le `profileId` en paramètre et filtre dessus, l'interface n'a aucun
moyen de demander les données d'un autre profil. Le dernier profil utilisé est mémorisé dans
`settings` (`profiles.last`) ; le dernier profil restant ne peut pas être supprimé.

La migration 14 crée le profil 1, « Profil principal », et lui rattache toutes les données
existantes. Elle reconstruit `playback_state` et `playlists` : elle est marquée
`rebuildsTables`, ce qui coupe les clés étrangères le temps de la migration (sans quoi
`DROP TABLE playlists` viderait `playlist_items` par cascade) puis vérifie
`PRAGMA foreign_key_check` avant de valider. Tests : `backend/core/db/profiles.test.ts`.

## Watchlist du foyer (v15)

La seule donnée **commune à tous les profils**. `shared_watchlist` a une ligne par média, avec le
profil qui l'a proposé (`added_by`, mis à `NULL` si ce profil est supprimé : l'entrée reste pour
les autres). `shared_watchlist_seen` note qui a terminé le média : la ligne est posée quand un
profil arrive au bout (`savePlaybackPosition(…, completed)`), et à l'ajout pour ceux qui l'avaient
déjà terminé. Tests : `backend/core/db/watchlist.test.ts`.

## Journal de lecture (v16)

`play_log` alimente les statistiques : une ligne par séance d'écoute, avec le **temps réellement
passé à lire**. Le lecteur le mesure (`frontend/src/player/tracker.ts` : horloge murale entre deux
`timeupdate` pendant la lecture, pauses et sauts exclus) et l'envoie toutes les 15 s sous un
identifiant de séance ; le backend additionne. Titre, artiste et genre sont recopiés au moment de
la lecture, pour que les chiffres survivent à la suppression du fichier. Une séance de moins de
30 s (`MIN_PLAY_SECONDS`) compte dans le temps total mais pas comme une lecture. Fichiers ouverts
hors bibliothèque exclus. Tests : `backend/core/db/stats.test.ts`.

Conventions :

- Clés primaires `INTEGER PRIMARY KEY` (rowid), dates en timestamp Unix (`unixepoch()`).
- `media` est unique sur `(source_id, path)` : un rescan met à jour, ne duplique jamais.
- Toutes les tables filles sont en `ON DELETE CASCADE` : supprimer une source nettoie tout.
- `media.mtime` + `media.size` servent à détecter un fichier modifié sans le hasher.
- `media.probed_at` (v2) : `NULL` = en attente d'analyse ffprobe ; remis à `NULL` si le fichier change.
- `media_fts` (v3) : voir [docs/search.md](search.md) — index FTS5 synchronisé par triggers.
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

Modules : `sources`, `media` (+ `getMetadata` / `setMetadata`), `playlists`, `playback`,
`profiles`, `podcasts`, `iptv`, `epg`, `music`, `settings`.
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
