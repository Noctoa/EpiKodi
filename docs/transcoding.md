# Transcodage à la volée

Code : `backend/core/compat.ts` (décision), `backend/core/transcode.ts` (ffmpeg),
`backend/media-protocol.ts` (flux), `frontend/src/components/Player.tsx` (lecture décalée).

## Ce que Chromium sait lire, mesuré et non supposé

Le décodeur d'Electron est une version restreinte de FFmpeg. Plutôt que de se fier à la
documentation, une matrice conteneur × codec a été générée avec ffmpeg puis ouverte dans
l'application, en relevant `webkitVideoDecodedByteCount` et `webkitAudioDecodedByteCount` :

| Fichier testé         | Résultat                                                  |
| --------------------- | --------------------------------------------------------- |
| mp4 / h264 + aac      | lecture native                                            |
| mkv / h264 + aac      | lecture native                                            |
| mkv / **hevc** + aac  | lecture native (contrairement à ce qu'on suppose souvent) |
| webm / vp9 + opus     | lecture native                                            |
| mov / h264 + aac      | lecture native                                            |
| **avi** / xvid + mp3  | refusé au démultiplexage (`DEMUXER_ERROR_COULD_NOT_OPEN`) |
| mkv / **mpeg4** + mp3 | le conteneur s'ouvre, **la vidéo ne décode pas**          |
| mkv / h264 + **ac3**  | la vidéo décode, **l'audio ne décode pas**                |

D'où les listes de `compat.ts` : conteneurs `mp4, matroska, webm, ogg, mp3, flac, wav`,
vidéo `h264, hevc, vp8, vp9, av1`, audio `aac, mp3, opus, vorbis, flac, pcm_*`.

## Trois modes

`planPlayback()` (pure, testée) choisit, à partir des informations ffprobe déjà collectées :

| Mode        | Quand                                            | Coût                                                   |
| ----------- | ------------------------------------------------ | ------------------------------------------------------ |
| `direct`    | tout est lisible                                 | nul, le fichier est servi tel quel                     |
| `remux`     | seul le conteneur pose problème (un avi en h264) | quasi nul, aucun ré-encodage                           |
| `transcode` | un codec est illisible                           | seul le flux fautif est ré-encodé, l'autre est recopié |

Un `.mkv` en h264 + ac3 ne fait donc ré-encoder **que** la piste audio.

## Le flux

`media://stream/<chemin>?t=<secondes>` lance ffmpeg qui écrit un **MP4 fragmenté** sur sa sortie
standard (`-movflags frag_keyframe+empty_moov`), seul format que `<video>` accepte sans connaître
la taille à l'avance.

Conséquence : **pas de requêtes Range**, donc pas de saut natif. Le lecteur gère le saut en
redemandant un flux qui commence à la position voulue (`-ss` avant `-i`, saut direct sur image
clé), et affiche `décalage + currentTime`. La durée vient de ffprobe, le conteneur fragmenté ne
l'annonçant pas.

Limite connue : `-ss` recule jusqu'à l'image clé précédente, donc la lecture reprend un peu avant
la position demandée — au plus l'intervalle entre deux images clés. Le temps affiché est borné à la
durée réelle pour éviter un compteur qui la dépasse.

## Accélération matérielle

`ffmpeg -encoders` ment : sur la machine de développement, `h264_vaapi` y figure mais échoue sur
`/dev/dri/renderD128` (« No usable encoding entrypoint ») alors qu'il fonctionne sur `renderD129`.
`detectHwEncoder()` **teste donc réellement** chaque candidat par un encodage d'une seconde, et
retient le premier qui aboutit : nvenc, puis qsv, puis vaapi sur chaque `/dev/dri/renderD*`. Le
résultat est mis en cache pour la session, et le repli `libx264 -preset veryfast` marche partout.

L'accélération n'est utilisée que si la vidéo doit vraiment être ré-encodée : un remux ne lance
aucun encodeur.

## Nettoyage

Chaque flux est lié à sa requête : changer de position ou fermer la fenêtre déclenche
`request.signal`, qui tue le process ffmpeg. `stopAllStreams()` est appelé à la fermeture de
l'application. Aucun fichier temporaire n'est écrit : tout passe par un tube.
