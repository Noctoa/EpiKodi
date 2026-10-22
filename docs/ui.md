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

Au bord d'une grille, la flèche ne reste pas collée : `frontend/src/focus.ts` prend le relais et
cherche la cible la plus proche dans la direction demandée — section suivante, barre latérale,
bouton de la vue détail. Le score mêle la distance dans la direction visée et le décalage
latéral, pour descendre sur la vignette d'en dessous plutôt que sur la plus proche en diagonale
(`bestCandidate`, testé dans `focus.test.ts`).

La grille ne consomme la touche que si elle peut bouger ; sinon elle la laisse filer, et le
relais s'en saisit. Rien n'est détourné tant qu'aucun élément n'a le focus : les flèches font
alors défiler la page, comme partout ailleurs. Devant le lecteur, elles restent à la lecture.

Les boîtes modales retiennent le curseur : tant qu'un `[role="dialog"]` ou un `[role="menu"]` est
ouvert, les flèches ne cherchent que dedans, **Échap** ferme la boîte (et le retour global de
l'application est neutralisé, sinon on reviendrait en arrière derrière elle en la laissant
affichée), et le curseur retrouve à la fermeture le bouton qui l'avait ouverte. C'est le rôle du
hook `useModal` (`hooks.ts`), utilisé par « Corriger l'identification », la file de lecture et le
menu « Ajouter à… ».

Le curseur ne reste jamais orphelin : si l'élément qu'il marquait disparaît — changement d'écran,
sortie du lecteur, fermeture d'une boîte — il se repose sur le premier élément de la vue.

La télécommande emprunte exactement ce chemin : voir [docs/remote-api.md](remote-api.md).

## Mode TV

Une bascule, pas une deuxième interface : **F10** — ou Paramètres → Apparence → Mode TV — pose
l'attribut `data-tv` sur `<html>`, et `frontend/src/styles/tv.css` fait le reste. Le choix est
mémorisé dans le stockage local du rendu, et relu avant le premier rendu (`restoreTvModeEarly()`,
comme pour le thème) pour éviter de voir l'application changer de taille au démarrage.

L'échelle tient dans une variable. Toutes les tailles de texte des composants sont exprimées en
`rem`, et `html` porte `font-size: var(--font-size)` : pousser `--font-size` de 15 à 20 px
agrandit l'application entière, y compris les écrans qui ignorent tout du mode TV. Le reste de
`tv.css` ne traite que ce qu'une multiplication ne sait pas décider — barre latérale repliée en
icônes (le libellé passe dans l'attribut `title`, qui devient le nom accessible du bouton),
vignettes plus larges via `--tile-min`, cibles du lecteur agrandies.

Aucune couleur n'est touchée : c'est ce qui permet au mode TV de se combiner avec n'importe quel
thème. Un thème repeint, le mode TV redimensionne. Les tailles qu'un thème personnalisé injecte
dans `:root` cèdent la place tant qu'il est actif — `:root[data-tv]` est plus spécifique — et
reprennent dès qu'on le quitte.

Le pointeur se masque après quatre secondes sans souris (`data-idle`, posé par `tvmode.tsx`) et
revient au premier mouvement. Le sélecteur vise aussi les descendants : sans cela, le premier
`cursor: pointer` d'un bouton le ferait réapparaître.

## Regroupement musique

`groupByArtist()` classe les pistes par `albumArtist` (sinon `artist`, sinon « Artiste inconnu »),
puis par album (sinon « Sans album »). Les albums d'un artiste sont triés par année, les pistes par
numéro. Les entrées inconnues sont reléguées en fin de liste. Tout est pur et testé
(`grouping.test.ts`).

## Composant `Grid`

Une seule grille pour tout (vidéos, artistes, albums, accueil) : elle reçoit des `GridTile`
(`{ key, title, subtitle, thumbnailUrl, icon, badge, square, highlight }`) et deux actions,
`onOpen` et `onPlay`. Les vignettes audio sont carrées, les vidéos en 16/9.
