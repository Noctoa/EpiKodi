# Recherche, filtres et tri

Code : `backend/core/db/repositories/media.ts` (requêtes), migration v3 dans `migrations.ts`,
`frontend/src/components/FilterBar.tsx` et `frontend/src/views/SearchView.tsx`.

## Index plein texte

Une table virtuelle **FTS5** `media_fts` indexe quatre colonnes par média : `title`, `artist`,
`album` et `path`. Le tokenizer `unicode61 remove_diacritics 2` rend la recherche insensible à la
casse **et aux accents** (« eclair » trouve « Éclair ») et découpe le chemin sur les `/`, donc le
nom de fichier et les dossiers parents sont cherchables.

L'index est tenu à jour par des **triggers** SQL : insertion, renommage et suppression d'un média,
et mise à jour de ses métadonnées (artiste/album écrits par ffprobe ou TheMovieDB). Aucune
synchronisation manuelle n'est nécessaire, et la migration v3 remplit l'index pour les
bibliothèques existantes.

## Requête utilisateur → requête FTS

`toFtsQuery()` (pure, testée) transforme la saisie : chaque mot devient une **phrase entre
guillemets** — les opérateurs FTS saisis par l'utilisateur (`OR`, `NEAR`, `*`) sont donc inertes —
et le dernier mot accepte un préfixe pour chercher au fil de la frappe.

```
daft pu   →   "daft" AND "pu"*
a OR b    →   "a" AND "OR" AND "b"*
***       →   null  (aucun mot indexable → aucun résultat)
```

## Filtres et tri

Tout passe par le même constructeur de requête (`buildQuery`), donc recherche, filtres et tri se
combinent librement.

| Filtre  | Colonne                                  |
| ------- | ---------------------------------------- |
| Type    | `media.type`                             |
| Source  | `media.source_id`                        |
| Genre   | `media_metadata.genre`                   |
| Année   | `media_metadata.year`                    |
| Non vus | `playback_state.completed = 0` ou absent |

Tris disponibles : nom (insensible à la casse), date d'ajout, durée, année — croissant ou
décroissant, les valeurs inconnues toujours en fin de liste (`NULLS LAST`). Quand une recherche est
active, le tri par défaut est la **pertinence** (`bm25` via `f.rank`).

Les menus Genre et Année sont alimentés par `media:facets`, qui liste les valeurs réellement
présentes en bibliothèque.

## Interface

- **Barre de recherche** dans l'en-tête, temporisée à 180 ms ; saisir ouvre la vue **Recherche**
  (résultats groupés : Vidéos en grille, Musique en liste), effacer revient à la vue précédente.
- **Barre de filtres** sur Vidéos, Musique et Recherche. Sur Musique, les filtres s'appliquent aux
  pistes puis le regroupement artistes/albums est recalculé.
- Le compteur décrit ce que la vue affiche (vidéos sur Vidéos, pistes sur Musique).

## Performance

Mesurée par un test automatisé sur **5000 médias** : une recherche filtrée et triée répond en
**moins de 100 ms** (`backend/core/db/search.test.ts`). Le filtre « non vus » reste sans effet tant
que l'état de lecture n'est pas écrit (issue #17).
