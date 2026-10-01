# Métadonnées externes (TheMovieDB)

Code : `backend/core/metadata/` — `filename.ts` (devine le titre), `score.ts` (pertinence),
`tmdb.ts` (client), `identify.ts` (file de traitement), `types.ts` (abstraction).

Ce document concerne l'identification des **films et séries** auprès d'une base externe.
L'analyse technique des fichiers (durée, codecs, miniatures) est décrite dans
[docs/metadata.md](metadata.md).

## Pourquoi une abstraction

```
MetadataProvider          search(guess) · details(externalId) · configured()
└── TmdbProvider          TheMovieDB
    (demain : TheTVDB, MusicBrainz… enregistrés par un plugin, issue #15)
```

Le cœur de l'application ne connaît que l'interface. `registerProvider()` et `providerFor()`
forment le point d'extension : une source supplémentaire s'ajoute sans toucher au scanner,
au lecteur ni à l'interface.

## Deviner le titre depuis le nom de fichier

C'est la partie la plus délicate : les fichiers réels portent des noms très bruités.
`guessFromFilename()` est pure et couverte par 12 tests. Elle retire la résolution, la source,
les codecs, les marqueurs de langue, les crochets et le groupe de release, puis isole une année.

| Nom de fichier                                | Résultat                                             |
| --------------------------------------------- | ---------------------------------------------------- |
| `Inception.2010.1080p.BluRay.x264-GROUPE.mkv` | Inception (2010)                                     |
| `Le.Film.2018.TRUEFRENCH.MULTI.VOSTFR.mkv`    | Le Film (2018)                                       |
| `[Team] Dune (2021) [2160p HDR].mkv`          | Dune (2021)                                          |
| `Blade.Runner.2049.2017.MULTI.mkv`            | Blade Runner 2049 (2017)                             |
| `The.Office.S03E12.FRENCH.HDTV.avi`           | The Office, saison 3, épisode 12                     |
| `Inception (2010)/film.mkv`                   | Inception (2010) — le dossier parent prend le relais |

Deux pièges traités explicitement : un nombre appartenant au titre ne doit pas être pris pour
une année (« Blade Runner 2049 »), et le dossier parent est préféré quand il en dit plus que le
fichier lui-même.

## Choisir le bon candidat

`scoreCandidate()` combine la ressemblance des titres (indice de Jaccard sur les mots,
insensible aux accents et à la ponctuation, avec bonus si l'un contient l'autre) et l'écart
d'année : identique `+0,30`, un an `+0,10`, plus de trois ans `−0,30`. Le titre original est
testé lui aussi, ce qui rattrape les films distribués sous un autre nom.

Au-dessus de **0,75**, la correspondance est retenue automatiquement. En dessous, le média est
marqué comme traité mais sans fiche : à l'utilisateur de trancher via **Corriger
l'identification**, qui relance une recherche sur le titre de son choix.

## Déroulement

```
scan (#4) → ffprobe (#5) → file d'identification → TheMovieDB → media_metadata + affiches
```

L'identification démarre quand l'enrichissement ffprobe est terminé, trois médias à la fois.
`media.identified_at` évite de réinterroger l'API pour un fichier déjà traité, y compris quand
aucune correspondance n'a été trouvée. Une clé refusée ou un quota atteint arrête la file
entière plutôt que de marquer tous les fichiers comme traités à tort.

Sont enregistrés : titre officiel, année, synopsis, note, premier genre, durée annoncée,
casting (JSON) et identifiant de la fiche. Affiches et images de fond sont **téléchargées sur
disque** : une fois le cache rempli, l'application fonctionne hors ligne.

## La clé d'API

L'API est gratuite mais demande une clé personnelle, à créer depuis les paramètres du compte sur
themoviedb.org. Elle se saisit dans **Paramètres → Métadonnées des films** et n'apparaît jamais
dans le code. Elle est chiffrée par le trousseau du système (`safeStorage`) avant d'être rangée
dans la table `settings`. Les deux formes distribuées par TMDB sont acceptées : la clé v3
(paramètre d'URL) et le jeton v4 (en-tête `Authorization`).

Sans clé, l'identification est simplement désactivée : le reste de l'application fonctionne
normalement, les titres restent ceux déduits des noms de fichiers.
