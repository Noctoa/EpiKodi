# Interface

Code : `frontend/src/navigation.ts` (état pur), `frontend/src/components/` (Sidebar, Grid,
MediaDetail, MediaList, MiniPlayer), `frontend/src/views/` (une par section),
`frontend/src/library/grouping.ts` (artistes / albums).

## Structure

```
┌──────────────────────────────────────────────────┐
│ EpiKodi        ⚠ ffmpeg / analyse…   [Ouvrir un média…] │
├──────────┬───────────────────────────────────────┤
│ Accueil  │  ← Titre de la vue                    │
│ Vidéos   │                                       │
│ Musique  │      grille de vignettes / détail     │
│ Podcasts │                                       │
│ Sources  │                                       │
│ Paramètres                                       │
├──────────┴───────────────────────────────────────┤
│ ♪ mini-lecteur audio (persistant)                │
└──────────────────────────────────────────────────┘
```

## Navigation

`navigation.ts` garde une **pile de vues** : cliquer dans la barre latérale remet la pile à plat
(section + accueil), ouvrir un élément empile (`Musique → Artiste → Album → Détail`), et
**Échap / Retour arrière** dépile. Les sous-vues de musique surlignent quand même « Musique ».

| Vue        | Contenu                                                              |
| ---------- | -------------------------------------------------------------------- |
| Accueil    | Compteurs + « Récemment ajoutés »                                    |
| Vidéos     | Grille 16/9, miniature + durée                                       |
| Musique    | Artistes → Albums (triés par année) → Pistes (n° de piste)           |
| Podcasts   | Vide en attendant l'issue #13                                        |
| Sources    | Dossiers, ajout, rescan avec progression, suppression                |
| Paramètres | Version, état de FFmpeg, chemins de la base et des miniatures        |
| Détail     | Grande affiche, métadonnées, Lire / Lire ensuite / Ajouter à la file |

## Navigation clavier (usage « salon »)

Dans une grille : **←→↑↓** déplacent le focus (le nombre de colonnes est déduit de la mise en
page réelle), **Entrée** ouvre le détail, **P** lit directement, **Début / Fin** vont aux
extrémités. Partout : **Échap** ou **Retour arrière** reviennent en arrière. Le lecteur vidéo
garde ses propres raccourcis (voir `docs/player.md`).

## Regroupement musique

`groupByArtist()` classe les pistes par `albumArtist` (sinon `artist`, sinon « Artiste inconnu »),
puis par album (sinon « Sans album »). Les albums d'un artiste sont triés par année, les pistes par
numéro. Les entrées inconnues sont reléguées en fin de liste. Tout est pur et testé
(`grouping.test.ts`).

## Composant `Grid`

Une seule grille pour tout (vidéos, artistes, albums, accueil) : elle reçoit des `GridTile`
(`{ key, title, subtitle, thumbnailUrl, icon, badge, square, highlight }`) et deux actions,
`onOpen` et `onPlay`. Les vignettes audio sont carrées, les vidéos en 16/9.
