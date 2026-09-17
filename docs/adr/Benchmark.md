# ADR 001 — Choix de la stack technique

**Date** : 2026-09-17 · **Statut** : accepté · **Issue** : #1

## Contexte

Le sujet EpiKodi suggère « Electron / Qt / Tauri pour l'interface, FFmpeg pour le traitement
multimédia, APIs REST pour les intégrations externes, base de données locale pour les
métadonnées ». Le projet est réalisé **en solo sur ~2 semaines** (dépôt phase 2 le 01/10),
avec des exigences transverses lourdes : lecture vidéo/audio, système de plugins, thèmes,
télécommande réseau, packaging.

## Options évaluées

| Critère                      | Electron + React/TS                        | Tauri + React/TS                               | Qt 6 (C++ QML)                          |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------- | --------------------------------------- |
| Lecture vidéo                | `<video>` Chromium : h264/vp9/av1/opus/aac | WebView système (WebKitGTK) : codecs variables | QtMultimedia (backend ffmpeg) ou libVLC |
| Intégration FFmpeg           | `child_process` + streaming trivial        | `Command` côté Rust, plus verbeux              | QProcess ou lib native                  |
| Plugins                      | Import dynamique JS, sandbox possible      | Plugins Rust = recompilation ; JS côté front   | QPluginLoader (.so), ABI fragile        |
| Thèmes                       | CSS custom properties                      | CSS custom properties                          | QSS / QML, plus lourd                   |
| Télécommande (HTTP + WS)     | `http` + `ws` Node natifs                  | `axum`/`tokio` à ajouter                       | QHttpServer + QWebSocket                |
| BDD locale                   | `better-sqlite3`                           | `rusqlite` / plugin SQL                        | QtSql                                   |
| Packaging Linux/Windows      | electron-builder (AppImage, deb, nsis)     | tauri-bundler (idem)                           | linuxdeployqt / windeployqt, manuel     |
| Poids du binaire             | ~90 Mo                                     | ~10 Mo                                         | ~30 Mo                                  |
| Vitesse de dev solo (2 sem.) | *****                                      | ***                                         | **                                   |

## Décision

**Electron 44 + React 19 + TypeScript**, outillé par **electron-vite** (Vite 7), avec
**better-sqlite3** pour les métadonnées et **FFmpeg/ffprobe** en process externes.

Raisons principales :

1. Le lecteur Chromium couvre nativement les formats courants (mp4/h264, webm/vp9, mkv, mp3,
   flac, opus…) — vérifié dans le POC — et le transcodage FFmpeg ne sert que pour le reste.
2. Plugins et thèmes s'expriment naturellement en JS/CSS, ce qui rend le « défi technique »
   d'extensibilité réalisable dans le temps imparti.
3. Un seul langage (TS) du main process au renderer, un seul outil de build, un packaging
   éprouvé.

## Conséquences

- Binaire plus lourd (~90 Mo) et RAM plus élevée qu'en natif : acceptable pour un media center.
- Sécurité : `contextIsolation` activé, pas de `nodeIntegration` dans le renderer, API exposée
  via `contextBridge`. Les fichiers locaux sont servis par un protocole custom `media://` avec
  support des requêtes Range (seek), et non par `file://`.
- Les plugins tourneront dans le main process (Node) avec une API restreinte ; l'isolation
  forte (process séparé) est reportée à l'issue #15 si le temps le permet.
