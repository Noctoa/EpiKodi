# Playlists, favoris et reprise de lecture

Code : `backend/core/playlists/m3u.ts` (format d'échange), `backend/core/db/repositories/`
(`playlists.ts`, `playback.ts`), `frontend/src/views/PlaylistsView.tsx`, `FavoritesView.tsx`.

## Reprise de lecture

La position est enregistrée **toutes les 5 secondes** pendant la lecture, et une dernière fois à
la fermeture du lecteur — sans attendre le prochain tour, pour que la position soit exacte même
si l'on quitte entre deux enregistrements.

Au-delà de **95 %** de la durée, le média est considéré comme vu : sa position repasse à zéro et
il sort de « Continuer à regarder ». C'est ce qui évite qu'un film terminé propose éternellement
de reprendre dans les dernières secondes.

À la réouverture, rien n'est imposé : une bannière propose **Reprendre** ou **Recommencer**. Elle
n'apparaît qu'au-delà de 10 secondes, pour ne pas encombrer l'écran après un faux départ.

Effet de bord utile : le filtre **« non vus »** de la recherche (issue #9) était jusqu'ici sans
effet, faute de quelqu'un pour écrire l'état de lecture. Il fonctionne désormais.

## Favoris

Une étoile dans la vue détail, et une section **Favoris** dans la barre latérale. Les favoris
sont stockés dans `playback_state`, à côté de la position et du nombre de lectures.

## Playlists

Création, renommage, suppression, et réordonnancement par **glisser-déposer** — l'ordre est
persistant, stocké dans `playlist_items.position`. Un média s'ajoute depuis sa vue détail,
bouton **☰ Ajouter à…**.

Supprimer un média de la bibliothèque le retire automatiquement des playlists
(`ON DELETE CASCADE`), il n'y a donc jamais d'entrée orpheline.

## Import et export M3U

Le **M3U étendu** est le format d'échange que lisent VLC, Kodi et la plupart des lecteurs :

```
#EXTM3U
#EXTINF:185,Artiste - Titre
/musique/a.mp3
```

L'export écrit la durée et le titre de chaque média. L'import est volontairement **conservateur** :
seules les lignes dont le fichier est déjà en bibliothèque sont ajoutées — importer une playlist
n'indexe pas de nouveaux médias. Le nombre d'entrées introuvables est rapporté à l'utilisateur
plutôt que passé sous silence.

Le parseur est tolérant : en-tête facultatif, commentaires inconnus ignorés, description sans
média abandonnée, `-1` et `0` traités comme une durée inconnue. 14 tests couvrent l'aller-retour,
la mise en correspondance et les cas limites.

## Accueil

Deux sections : **Continuer à regarder** (médias entamés, avec la position de reprise en pastille)
et **Récemment ajoutés**. Elles sont rechargées en arrivant sur l'écran — l'état de lecture change
au fil de l'usage, l'afficher tel qu'il était au démarrage serait trompeur.
