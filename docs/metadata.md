# Métadonnées & enrichissement

Après le scan (#4), un média n'a qu'un chemin, une taille et un titre dérivé du nom de fichier.
L'**enrichissement** remplit `media_metadata` avec ce que contient réellement le fichier.

Code : `backend/core/ffmpeg.ts` (wrapper), `backend/core/enricher.ts` (file de traitement),
orchestration dans `backend/library.ts`.

## Pipeline

```
scan → media (probed_at = NULL) → Enricher (4 en parallèle) → ffprobe → media_metadata
                                                             → ffmpeg  → thumbnails/<id>.jpg
                                                             → probed_at = maintenant
```

- `ffprobe -print_format json -show_format -show_streams` : durée, conteneur, codecs, résolution,
  bitrate, tags (titre, artiste, album, année, piste, genre). Parsé par `parseProbe()` (pure, testée
  sur des sorties réelles dans `__fixtures__/`).
- Vidéo : miniature prise à 10 % de la durée (`-ss`), largeur 480 px.
- Audio : pochette embarquée (flux `attached_pic`) extraite si présente.
- Le **titre** est remplacé par le tag `title` pour l'audio uniquement (les tags vidéo sont rarement
  fiables ; TheMovieDB s'en chargera, #14).
- Miniatures dans `~/.config/epikodi/thumbnails/`, servies au frontend via `media://`.

## Robustesse

- Toujours `execFile(bin, [args])` — jamais de shell, un nom de fichier ne peut rien injecter.
- Fichier corrompu / illisible → `probed_at` est quand même posé, pas de nouvelle tentative à chaque
  démarrage, le média reste lisible avec son titre de fichier.
- Miniature ratée → simple avertissement, les métadonnées sont conservées.
- Fichier modifié (mtime/taille) → le scanner remet `probed_at` à `NULL`, ré-analyse automatique.
- ffmpeg absent → détecté au démarrage (`system:ffmpeg`), bandeau ⚠ dans l'UI, tout le reste fonctionne.

## Événements

`library:changed` (max 2/s) prévient le frontend qu'il doit recharger la liste, avec le nombre de
médias encore en attente d'analyse.
