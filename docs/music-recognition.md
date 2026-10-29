# Reconnaissance musicale et pochettes

Code : `backend/core/music/` — `acoustid.ts` (empreinte et reconnaissance), `artwork.ts`
(pochettes et photos), `recognizer.ts` (file de traitement), `http.ts` (cadence, reprises).

La vue Musique range les pistes par artiste puis par album d'après leurs tags. Ce module lui
fournit ce qui manque : les tags d'un morceau qui n'en a pas, la pochette d'un album qui n'en
embarque pas, et une photo pour chaque artiste.

## Pourquoi pas Shazam

Shazam n'a pas d'API publique : ShazamKit est réservé aux plateformes Apple, et les API
« Shazam » qu'on trouve en ligne sont rétro-ingéniérées, instables et contraires à ses
conditions d'utilisation. La même idée existe en libre, c'est celle de MusicBrainz Picard :

```
fichier → fpcalc (Chromaprint, en local) → empreinte → AcoustID → enregistrement MusicBrainz
                                                                  titre, artiste, album, année
```

Seule l'empreinte quitte la machine, jamais le fichier.

## Déroulement

Après l'analyse ffprobe, chaque morceau passe une fois dans la file, un à la fois :

1. **Sans artiste ou sans album dans ses tags**, il est reconnu à son empreinte. Seuls les tags
   manquants sont complétés : ce que l'utilisateur a écrit n'est jamais remplacé. Sans artiste,
   le titre est presque toujours le nom du fichier : il prend celui de l'enregistrement.
2. **Toujours sans artiste**, il est lu dans le nom du fichier. Un mp3 téléchargé depuis YouTube
   n'a souvent aucun tag (seulement `encoder: Lavf`), mais s'appelle « Artiste - Titre (Clip
   officiel).mp3 ». Le séparateur doit être entouré d'espaces (« Jay-Z » n'est pas coupé), et
   les mentions des plateformes (clip, audio, lyrics, HD…) et numéros de piste sont retirés.
   Un titre tagué qui répète l'artiste (« INO CASABLANCA - BUENA ONDA ») en est débarrassé.
3. **Artiste et titre connus, album inconnu** : l'album est retrouvé par une recherche de
   morceau sur Deezer, vérifiée par ressemblance. L'artiste principal selon Deezer devient
   l'artiste de l'album : « Ino Casablanca, Naïka - PAPA CASA » se range avec les autres
   morceaux d'Ino Casablanca, pas sous un artiste à part.
4. **Son album reçoit une pochette**, cherchée une seule fois pour toutes ses pistes :
   Cover Art Archive si la reconnaissance a donné l'identifiant de l'album, sinon Deezer par
   nom, sinon MusicBrainz par nom puis Cover Art Archive.
5. **Son artiste reçoit une photo**, depuis Deezer (MusicBrainz n'en a pas). Pour un featuring,
   c'est l'artiste principal : « Jul feat. SCH » prend la photo de Jul.

Les images sont rangées dans `music-art/` (dossier de données de l'application) et rattachées
aux pistes : `poster_path` pour la pochette, `backdrop_path` pour la photo, comme l'« image de
fond » d'un artiste dans Kodi. Une **pochette embarquée garde la priorité** : c'est celle que
l'utilisateur a choisie.

## Choisir le bon résultat

- **L'album, parmi tous ceux d'un morceau** : un même enregistrement figure sur l'album, le
  single, des compilations. Ordre de préférence : album studio, album à type secondaire (bande
  originale…), compilation, EP, single ; à égalité, la sortie la plus ancienne.
- **Le score AcoustID** : sous 0,8, la correspondance est ignorée. Un fichier sans tags vaut
  mieux qu'un fichier mal tagué.
- **Les résultats par nom** sont vérifiés par ressemblance du titre et de l'artiste (la même
  mesure que pour TheMovieDB). Les mentions d'édition ne comptent pas : « Discovery (Deluxe
  Edition) » retrouve « Discovery ». Un album homonyme d'un autre artiste est refusé.
- **Les fausses images** : faute de photo, Deezer renvoie une silhouette grise (URL en
  `…/artist//…`), écartée comme une absence.

## Cadence et pannes

| Service           | Clé                   | Cadence respectée |
| ----------------- | --------------------- | ----------------- |
| AcoustID          | oui, gratuite         | 3 requêtes/s      |
| MusicBrainz       | non (agent identifié) | 1 requête/s       |
| Deezer            | non                   | 50 requêtes/5 s   |
| Cover Art Archive | non                   | —                 |

- **Hors ligne** : la file s'arrête sans rien marquer, tout est repris au passage suivant.
- **MusicBrainz saturé** (503 fréquents, même à la cadence permise) : deux nouvelles tentatives
  espacées, puis l'album est remis au lendemain. La file continue.
- **Rien trouvé** : retenu un mois (table `music_artwork`), pour ne pas réinterroger les
  services à chaque démarrage, puis retenté.
- **Clé AcoustID refusée** : la reconnaissance s'arrête dès le premier refus, les pochettes
  continuent. L'erreur s'affiche dans les Paramètres.

## Réglages

**Paramètres → Musique : reconnaissance et pochettes** :

- **Pochettes et photos en ligne** : activé par défaut. Seuls des noms d'artistes et d'albums
  sont envoyés.
- **Clé AcoustID** : à créer gratuitement sur acoustid.org (rubrique « Applications »). Elle est
  chiffrée par le trousseau du système, comme celle de TheMovieDB. Une clé enregistrée remet en
  file les morceaux sans tags.
- `fpcalc` doit être installé (paquet `chromaprint`, ou `libchromaprint-tools` sous Debian).
  Sans lui, les pochettes fonctionnent, la reconnaissance non.

## Mesures

Bibliothèque de développement réelle, réseau réel, sans clé AcoustID : 8 morceaux Ino
Casablanca téléchargés sans aucun tag sont rangés sous leur artiste, dans leur album
(EXTASIAAAAA), avec pochette et photo, en 1,7 s pour toute la file. Restent sans image :
un album de fan (« Fire Emblem: The Binding Blade Enhanced Soundtrack »), absent de toutes les
bases, et deux artistes inconnus de Deezer ; ils sont listés sous « Introuvables » dans les
Paramètres.

Sur une copie de la bibliothèque de développement augmentée de cinq pistes d'albums connus,
réseau réel : 11 morceaux traités en 2,5 s, dont 4 pochettes et 4 photos en 1000 × 1000. La
pochette de Discovery n'a été cherchée qu'une fois pour ses deux pistes. Les deux artistes
absents de Deezer (une seule silhouette, ou seulement des homonymes) n'ont reçu aucune image,
plutôt qu'une fausse.
