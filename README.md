# EpiKodi

[![CI](https://github.com/Noctoa/EpiKodi/actions/workflows/ci.yml/badge.svg)](https://github.com/Noctoa/EpiKodi/actions/workflows/ci.yml)

Centre multimédia open-source inspiré de Kodi : lecture et organisation de vidéos, musique,
podcasts et médias numériques depuis le stockage local et réseau, extensible par plugins et
thèmes.

> Projet professionnel simulé — Epitech 3ᵉ année. Planning : [GitHub Project](https://github.com/users/Noctoa/projects/2).

## Fonctionnalités visées

- Lecture vidéo et audio : formats courants en natif, remux ou transcodage FFmpeg à la volée
  pour le reste (avi, xvid, ac3…), avec accélération matérielle si disponible
- Bibliothèque indexée (SQLite) depuis des dossiers locaux et des partages réseau (SMB, WebDAV)
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

1. **Sources → + Ajouter un dossier** : choisis un dossier contenant vidéos ou musiques.
   **+ Partage réseau** ajoute un partage Samba (`smb://utilisateur@nas/media`) ou un serveur
   WebDAV ; le mot de passe est chiffré par le trousseau du système.
2. Le scan démarre tout seul et la liste se remplit au fur et à mesure.
3. Navigue avec la barre latérale (Accueil, Vidéos, Musique, Podcasts, Sources, Paramètres).
   Une vignette ouvre le détail, ▶ lit directement. Au clavier : flèches, Entrée, Échap. **Rescanner** met à jour après ajout/suppression de fichiers ;
   la bibliothèque est aussi rescannée à chaque démarrage.
4. Dans le lecteur : Espace, ← →, ↑ ↓, F (plein écran), M (muet), Échap. Menu **CC** pour les
   sous-titres (`.srt` à côté de la vidéo ou pistes internes), **🎧** pour la piste audio.
5. Musique : un clic lance l'album dans l'ordre des pistes ; le mini-lecteur en bas reste visible
   pendant la navigation. **⤴** lire ensuite, **+** ajouter à la file, **☰** voir la file.
6. La barre de recherche en haut cherche dans les titres, artistes, albums et noms de fichiers
   (sans accents ni casse). La barre de filtres permet de restreindre par source, genre, année ou
   « non vus », et de trier par nom, date d'ajout, durée ou année.

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
- [Interface](docs/ui.md) — navigation, grille, vues, raccourcis clavier
- [Recherche](docs/search.md) — index FTS5, filtres, tri
- [Transcodage](docs/transcoding.md) — formats non supportés, remux, accélération matérielle
- [Stockage réseau](docs/network-storage.md) — partages SMB, WebDAV, identifiants, pont ffmpeg
- [ADR](docs/adr/) — décisions d'architecture

## Licence

MIT
