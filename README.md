# EpiKodi

[![CI](https://github.com/Noctoa/EpiKodi/actions/workflows/ci.yml/badge.svg)](https://github.com/Noctoa/EpiKodi/actions/workflows/ci.yml)

Centre multimédia open-source inspiré de Kodi : lecture et organisation de vidéos, musique,
podcasts et médias numériques depuis le stockage local et réseau, extensible par plugins et
thèmes.

> Projet professionnel simulé — Epitech 3ᵉ année. Planning : [GitHub Project](https://github.com/users/Noctoa/projects/2).

## Fonctionnalités visées

- Lecture vidéo et audio (formats courants natifs, transcodage FFmpeg pour le reste)
- Bibliothèque indexée (SQLite) depuis des dossiers locaux et partages réseau
- Podcasts (RSS), métadonnées enrichies via TheMovieDB
- Système de plugins et de thèmes
- Télécommande : manette et contrôle depuis un smartphone

## Prérequis

- Node.js ≥ 22 (développé avec 26)
- FFmpeg et ffprobe dans le `PATH` (`pacman -S ffmpeg`, `apt install ffmpeg`)

## Démarrage

```bash
git clone https://github.com/Noctoa/EpiKodi.git
cd EpiKodi
npm install
npm run dev
```

Ouvrir directement un fichier : `npm run dev -- --open /chemin/vers/video.mp4`

## Utilisation

1. **+ Dossier** dans le panneau Sources : choisis un dossier contenant vidéos ou musiques.
2. Le scan démarre tout seul et la liste se remplit au fur et à mesure.
3. Clique un média pour le lire. **Rescanner** met à jour après ajout/suppression de fichiers ;
   la bibliothèque est aussi rescannée à chaque démarrage.
4. Dans le lecteur : Espace, ← →, ↑ ↓, F (plein écran), M (muet), Échap. Menu **CC** pour les
   sous-titres (`.srt` à côté de la vidéo ou pistes internes), **🎧** pour la piste audio.
5. Musique : un clic lance l'album dans l'ordre des pistes ; le mini-lecteur en bas reste visible
   pendant la navigation. **⤴** lire ensuite, **+** ajouter à la file, **☰** voir la file.

Extensions reconnues : mp4, mkv, webm, avi, mov, m4v, ogv · mp3, flac, ogg, oga, m4a, wav, aac, opus.
Les dossiers cachés (`.xxx`) sont ignorés.

## Inspecter la base de données

La bibliothèque est un fichier SQLite créé au premier lancement :

```bash
sqlite3 ~/.config/epikodi/epikodi.db          # Linux (Windows : %APPDATA%\epikodi\epikodi.db)
sqlite> .tables
sqlite> SELECT * FROM sources;
sqlite> SELECT id, type, title, duration FROM media LIMIT 20;
```

Schéma et conventions : [docs/database.md](docs/database.md).

## Stack

Electron 44 · React 19 · TypeScript · electron-vite · SQLite (`node:sqlite`) · FFmpeg
— voir [ADR 001](docs/adr/001-stack.md) pour la justification.

## Documentation

- [Contribuer](docs/CONTRIBUTING.md) — workflow, commandes, structure du code
- [Base de données](docs/database.md) — schéma, repositories, migrations
- [Scanner](docs/scanner.md) — indexation des dossiers
- [Métadonnées](docs/metadata.md) — ffprobe, miniatures, enrichissement
- [Lecteur](docs/player.md) — contrôles, raccourcis, sous-titres, pistes audio
- [Lecteur audio](docs/audio.md) — file d'attente, mini-lecteur, aléatoire / répétition
- [ADR](docs/adr/) — décisions d'architecture

## Licence

MIT
