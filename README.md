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

## Stack

Electron 44 · React 19 · TypeScript · electron-vite · better-sqlite3 · FFmpeg
— voir [ADR 001](docs/adr/001-stack.md) pour la justification.

## Documentation

- [Contribuer](docs/CONTRIBUTING.md) — workflow, commandes, structure du code
- [ADR](docs/adr/) — décisions d'architecture

## Licence

MIT
