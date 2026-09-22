# Lecteur audio

Code : `frontend/src/player/` (logique de file `queue.ts`, contexte `AudioPlayerContext.tsx`,
conversion `items.ts`), composants `MiniPlayer.tsx` et `QueuePanel.tsx`.

## Principe

Un **seul `<audio>`** pour toute l'application, rendu par `AudioPlayerProvider` à la racine
(`main.tsx`). Il n'est jamais démonté, donc la musique continue quelle que soit la vue. Le lecteur
vidéo (`Player.tsx`) reste un composant de vue : ouvrir une vidéo met l'audio en pause, et
inversement.

```
clic sur une piste ──► albumOrder(pistes affichées) ──► queue.ts (état pur) ──► <audio src>
                                                                │
   mini-lecteur / panneau de file  ◄────── useAudioPlayer() ◄───┘
```

## File d'attente (`queue.ts`)

État immuable `{ items, index, repeat, shuffle, order }`, fonctions pures testées :
`setQueue`, `enqueue` (sans doublon), `playNext` (insère après la courante), `remove`, `move`,
`nextIndex` / `prevIndex`, `cycleRepeat` (off → all → one), `toggleShuffle`.

- **Shuffle** : une permutation `order` est tirée (Fisher-Yates), la piste courante placée en tête ;
  chaque piste est lue une fois. Ajouts et suppressions maintiennent la permutation.
- **Repeat one** ne s'applique qu'à la fin automatique d'une piste ; « Suivant » passe toujours à
  la suivante. « Précédent » après 3 s revient au début de la piste.
- Un clic sur une piste de la bibliothèque remplace la file par **toutes les pistes audio affichées**,
  triées par album → n° de piste → titre (`albumOrder`), et démarre sur la piste cliquée : un
  album s'enchaîne dans le bon ordre même si les fichiers sont mal nommés.
- Au survol d'une piste : **⤴ Lire ensuite** et **+ Ajouter à la file**.

## Mini-lecteur

Barre persistante en bas : pochette, titre, artiste · album, ⏮ ▶ ⏭, aléatoire, répétition,
progression cliquable, volume, et **☰ n/total** qui ouvre le panneau de file (glisser-déposer pour
réordonner, ✕ pour retirer, clic pour sauter).

Volume, mode de répétition et aléatoire sont mémorisés (`localStorage`). Les touches média du
clavier fonctionnent via `navigator.mediaSession` (lecture/pause, précédent, suivant).

## Formats

Décodage par Chromium : mp3, flac, ogg/vorbis, opus, m4a/aac, wav. Le fichier est servi par le
protocole `media://` (voir `docs/player.md`).
