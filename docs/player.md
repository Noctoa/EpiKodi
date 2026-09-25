# Lecteur

Code : `frontend/src/components/Player.tsx` (UI), `backend/core/subtitles.ts` (sous-titres),
`backend/main.ts` (flag Chromium, IPC `player:*`).

## Décodage

Le décodage est fait par Chromium (`<video>`), qui embarque une partie de FFmpeg : h264, hevc,
vp8/vp9, av1, aac, mp3, opus, flac, vorbis, dans les conteneurs mp4, webm, mkv, ogg. Le fichier est
servi par le protocole `media://` avec support des requêtes Range (seek instantané).

Ce que Chromium refuse (avi, mpeg4 part 2, ac3…) est remuxé ou ré-encodé à la volée par ffmpeg :
voir [docs/transcoding.md](transcoding.md). Le lecteur affiche alors une pastille « remux » ou
« transcodage » avec la raison.

## Contrôles

| Action          | Souris                 | Clavier   |
| --------------- | ---------------------- | --------- |
| Lecture / pause | clic vidéo, bouton ▶   | Espace, K |
| −10 s / +10 s   | boutons ↺ ↻, barre     | ← → , J L |
| Volume          | curseur, bouton 🔊     | ↑ ↓ , M   |
| Plein écran     | bouton ⛶, double-clic  | F         |
| Sous-titres     | menu CC                |           |
| Piste audio     | menu 🎧 (si > 1 piste) |           |
| Quitter         |                        | Échap     |

Les contrôles se masquent après 2,5 s sans mouvement pendant la lecture (curseur masqué aussi).
La barre montre la partie mise en tampon et la position.

## Sous-titres

`<track>` n'accepte que le **WebVTT**. Le backend fournit donc du VTT quelle que soit la source :

- **Externes** : fichiers à côté de la vidéo dont le nom commence par celui de la vidéo :
  `Film.srt`, `Film.fr.srt`, `Film.en.vtt`, `Film.ass`. Le suffixe donne la langue/le label.
  `.srt` → conversion maison (`srtToVtt`, détection UTF-8 / latin-1) ; `.ass/.ssa/.sub` → ffmpeg.
- **Internes** (pistes du conteneur, mkv surtout) : listées par ffprobe, extraites à la demande par
  `ffmpeg -map 0:<index> -f webvtt pipe:1`. Seules les pistes texte sont proposées (pas les
  bitmaps PGS/DVD, que ffmpeg ne peut pas convertir en texte).

Le frontend reçoit le VTT par IPC et le charge via un `Blob` URL (`media-src blob:` dans la CSP).

## Pistes audio (VF / VO)

Chromium sait décoder plusieurs pistes audio mais l'API `HTMLMediaElement.audioTracks` est
derrière un flag : `app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks')`
dans `backend/main.ts`. Le menu 🎧 n'apparaît que si le fichier a plus d'une piste.

## Test e2e

En dev, `EPIKODI_E2E=script.js npm run dev -- --open video.mkv` exécute `script.js` dans la fenêtre
et affiche son résultat (`[e2e] …`) — voir `backend/main.ts`. Servira à l'issue #19.
