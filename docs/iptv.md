# Chaînes en direct (IPTV)

Une **source IPTV** est une playlist M3U — une URL `http(s)` ou un fichier local — dont
l'application garde une copie des chaînes en base. Rien n'est téléchargé : le direct n'existe
qu'au moment où on le regarde, seule la liste est mémorisée.

Code : `backend/core/playlists/m3u.ts` (format), `backend/core/iptv/service.ts` (import),
`backend/core/iptv/live.ts` (lecture), `frontend/src/views/IptvView.tsx` et le lecteur vidéo
habituel, `frontend/src/components/Player.tsx`, en mode direct.

## Le format, et ce qu'on en lit

Une ligne de playlist de chaînes porte des attributs que le format M3U d'origine n'a jamais
prévus — personne ne les a normalisés, ce sont ceux que Kodi, VLC et les fournisseurs se sont mis
à écrire, et que tout le monde lit aujourd'hui :

```
#EXTINF:-1 tvg-id="6ter.fr@SD" tvg-logo="https://…/2nd5Cox.png" group-title="Entertainment",6ter (1080p)
http://145.239.5.177/314/index.m3u8
```

`backend/core/playlists/m3u.ts` les lit via `parseM3uChannels()`. `parseM3u()` reste la vue
« playlist utilisateur » du même fichier : chemin, durée, titre, sans les attributs. Les deux
partagent le même analyseur, donc l'import de playlists bénéficie au passage d'une correction —
une ligne `#EXTINF` porteuse d'attributs ne correspondait à rien auparavant, et son titre était
perdu.

Le titre commence à la **première virgule hors guillemets** : `group-title="Sport, France"` en
contient une, et couper à la première venue amputerait le nom d'une chaîne sur deux.

Certains serveurs refusent le flux à qui ne se présente pas comme un navigateur ; la playlist le
dit par une ligne `#EXTVLCOPT:http-user-agent=…` (ou `http-referrer=…`) placée avant ou après le
`#EXTINF`. Ces en-têtes sont gardés avec la chaîne (migration 10) et passés à ffmpeg : 24 chaînes
sur 210 de la liste française d'iptv-org en déclarent un.

Le nom retenu est `tvg-name` quand il existe — plus propre que le titre affiché, souvent
encombré de mentions de qualité — et le titre sinon.

## Identité d'une chaîne

`channel_key` est **l'URL du flux**, pas `tvg-id`. Dans les listes publiques, un même `tvg-id`
revient sur plusieurs entrées (qualités, flux de secours) : s'en servir comme clé en perdrait une
partie au moment de l'insertion. `tvg-id` est conservé à part, dans `epg_id`, pour le guide des
programmes.

## Mise à jour différentielle

Rafraîchir ne supprime jamais rien. Dans une seule transaction :

1. toutes les chaînes de la source sont marquées absentes (`missing_at`) ;
2. chaque chaîne lue dans la playlist les démarque au passage.

Ce qui reste marqué à la fin est exactement ce qui a disparu. Procéder dans cet ordre évite de
comparer des horodatages — deux rafraîchissements dans la même seconde rendraient la comparaison
aveugle.

Une chaîne disparue est exclue des listes par défaut mais garde sa ligne, donc son statut de
favorite : retirée un jour par le fournisseur puis revenue le lendemain, elle retrouve sa place
sans que l'utilisateur ait à refaire son choix.

## Logos

Mis en cache sur disque comme les pochettes de podcasts, dans `iptv-logos/` du dossier de données,
et servis par `media://`. Une playlist publique en compte des milliers : les télécharger tous
bloquerait l'import plusieurs minutes pour des images que personne ne verra. L'import en prend une
première tranche de 120, six à la fois, favorites puis ordre de la liste ; le reste se complète à
la demande via `iptvCacheLogos(sourceId, limit)`. Un logo indisponible n'est pas une erreur : la
chaîne s'affiche sans image.

## Mesure

Sur `https://iptv-org.github.io/iptv/countries/fr.m3u` (210 chaînes, 52 ko), import depuis le
fichier comme depuis l'URL : 210 chaînes, 119 logos en cache sur 120 tentés, moins d'une seconde
hors réseau. Rafraîchissement immédiat : `added: 0, missing: 0, total: 210` — aucun doublon.

À noter pour la vue des chaînes : iptv-org compose parfois plusieurs rubriques dans un seul
attribut (`group-title="Animation;Kids"`). Elles sont stockées telles quelles ; les découper est
une décision d'affichage, pas d'import.

## Lecture

Chromium ne lit pas le HLS nativement dans `<video>` d'Electron, et une partie des chaînes n'est
même pas du HLS. Deux voies ont été évaluées avant de choisir.

### hls.js ou ffmpeg : la mesure

Sur la liste française (échantillon de chaînes joignables) :

| Constat                                               | hls.js (MSE dans l'interface)                                                                 | ffmpeg (remux)   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| Son **eac3** (6ter, franceinfo…) ou **mp2** (flux TS) | muet : MSE refuse `ec-3`, `ac-3`, `mp2t` (`MediaSource.isTypeSupported`, mesuré dans l'appli) | ré-encodé en AAC |
| Flux **MPEG-TS brut** sur HTTP (5 sur 198 URL)        | illisible, ce n'est pas du HLS                                                                | lu               |
| `User-Agent` exigé (24 chaînes sur 210)               | impossible : en-tête interdit au `fetch` du navigateur                                        | `-user_agent`    |
| Serveur sans CORS                                     | refusé                                                                                        | sans objet       |

Les quatre lignes jouent contre hls.js ; la seule faveur qu'on pouvait lui prêter — démarrer plus
vite — ne tient pas non plus, ffmpeg démarrant en quelques secondes (ci-dessous). **ffmpeg** est
donc retenu, branché sur le mécanisme existant : le même MP4 fragmenté que le transcodage à la
volée ([docs/transcoding.md](transcoding.md)), le même lecteur.

### Le flux

`media://live/stream.mp4?u=<url du flux>` → `handleLive` (`backend/media-protocol.ts`) →
`startLive` (`backend/core/iptv/live.ts`) :

1. L'URL doit être celle d'une chaîne importée (`iptvChannelByUrl`) : l'interface ne peut pas faire
   télécharger une adresse arbitraire. Seuls `http(s)` sont acceptés, et ffmpeg tourne avec une
   liste blanche de protocoles (`-protocol_whitelist`) : une playlist HLS désigne elle-même ses
   segments, elle ne doit pas pouvoir y glisser un `file:`.
2. ffmpeg recopie la vidéo et ré-encode le son en AAC (toujours : c'est presque gratuit et règle
   d'un coup eac3, ac3 et mp2). Sans `-map`, il retient la meilleure variante d'un HLS.
3. La réponse attend que ffmpeg ait **décrit ses flux** (bilan `Stream mapping` sur stderr) et
   produit un premier octet. Si la vidéo n'est pas lisible par Chromium (mpeg2 de certains flux
   satellite), ffmpeg est relancé en ré-encodage — matériel si possible, comme pour les fichiers —
   avant que rien ne soit parti vers le lecteur.
4. Un flux mort répond 502 au lieu d'un 200 vide. `<video>` ne sait dire que « échec » :
   l'interface demande le motif par `player:live-error`, que `describeLiveError` traduit (accès
   refusé, flux introuvable, serveur muet…). Sans image en 15 s, la chaîne est déclarée muette.

**Piège rencontré** : l'URL du flux voyage en paramètre et non dans le chemin. Avec un chemin en
`….m3u8`, Chromium choisit son lecteur HLS intégré d'après l'extension, tente de lire notre MP4
comme une playlist, et l'image ne vient jamais — sans la moindre erreur. Le même contenu servi
sous un nom en `.mp4` démarre aussitôt.

### Libération du flux

Chaque process ffmpeg est lié à sa requête : changer de chaîne ou fermer le lecteur l'annule, ce
qui tue ffmpeg ; `stopAllStreams()` arrête le reste à la fermeture de l'application. Côté
interface, le lecteur retire la source de `<video>` en se fermant : mesuré, un élément retiré de
la page sans cela garde sa requête — et ffmpeg — plus de 8 secondes.

### Coupures, chaînes mortes, qualité

**Mesuré d'abord** : sur un direct local coupé en plein milieu, ffmpeg n'attend pas — il échoue
au rechargement de la playlist (« Failed to reload playlist ») et termine le flux dans la seconde.
Ses options `-reconnect*` rattrapent un hoquet HTTP, pas une coupure de dix secondes. La reprise
est donc l'affaire du lecteur (`frontend/src/player/live.ts`, `Player.tsx`) :

- **Reconnexion automatique** : un direct qui a déjà montré une image et qui s'arrête (fin du
  flux, erreur) est relancé seul après 1, 2, 4, 8, puis 15 s, six fois au plus (« Connexion perdue —
  reconnexion (n/6)… »). Le compteur repart de zéro dès qu'une image revient. Au-delà, le motif
  s'affiche avec **Réessayer**.
- **Image figée** : un flux peut aussi se taire sans finir ni échouer. Une image immobile plus de
  12 s pendant la lecture déclenche la même reconnexion.
- **Chaîne morte** : une chaîne qui n'a **jamais** démarré n'est pas relancée — elle est morte, et
  le dire tout de suite laisse zapper ailleurs. Délai maximal au démarrage : 15 s.
- **Qualité manuelle** : ffmpeg expose chaque variante d'un HLS comme un programme, numéroté dans
  l'ordre de la playlist maître (vérifié avec `ffprobe -show_programs`). `fetchVariants`
  (`backend/core/iptv/hls.ts`) lit cette playlist — en se présentant comme ffmpeg, Pluto TV
  refusant l'agent d'EpiKodi — et le lecteur propose un menu ; le choix part en `q=<rang>` et
  devient `-map 0:p:<rang>:v:0? -map 0:p:<rang>:a:0?`. Par défaut, ffmpeg prend la meilleure.
  Un flux à qualité unique, ou du MPEG-TS brut, n'affiche pas de menu.

Banc de test dans l'application, contre un direct local (mire générée par ffmpeg, servie en HTTP)
qu'on coupe à volonté :

| Scénario                                    | Résultat                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Chaîne morte (port fermé)                   | erreur « serveur de la chaîne injoignable » en 4,1 s, on peut zapper    |
| Chaîne lente (serveur qui ne répond jamais) | « Connexion à la chaîne… », interface libre, erreur à 15,0 s            |
| Serveur coupé 10 s pendant la lecture       | « reconnexion (1/6)… », la lecture repart seule 12,5 s après la coupure |
| Source suspendue 25 s (image figée)         | reconnexion par la surveillance, lecture repartie à 28,5 s              |
| Qualité manuelle (Pluto TV, 5 variantes)    | 684p en automatique → 240p au choix de « 0.6 Mb/s », en 5 s             |

Les 4,1 s de la chaîne morte viennent des tentatives de `-reconnect_on_network_error` sur une
connexion refusée ; c'est le prix d'un direct qui survit aux hoquets du réseau.

### Mesure

Dans l'application (test e2e, `EPIKODI_E2E`), 24 chaînes prises à intervalle régulier dans la
liste française :

- **14 démarrent**, temps jusqu'à la première image : médiane **3,5 s**, 90ᵉ centile 6,9 s,
  maximum 7,6 s ; **11 sur 14 en moins de 5 s**. Les plus lentes sont les flux Pluto TV
  (redirection, puis variante HD) ;
- **10 échouent côté serveur**, chacune avec un motif affiché : 7 accès refusés (restriction
  géographique), 1 flux introuvable (404), 1 réponse illisible, 1 serveur muet (15 s) ;
- dans le vrai lecteur : CNEWS en 2,7 s, Gong en 0,9 s, « 1080p · 5.4 Mb/s » affiché ;
  **exactement un ffmpeg** pendant qu'une chaîne joue, **zéro** une seconde après l'avoir quittée,
  zéro après la fermeture de l'application ;
- pas de régression du lecteur de fichiers : un mp4 direct (0,2 s) et un mkv h264 + ac3 transcodé
  (0,8 s) démarrent, le saut de 10 s fonctionne.

Le critère « moins de 5 s » est tenu en médiane, pas pour chaque chaîne : le temps est dominé par
le téléchargement du premier segment chez le fournisseur, que ni ffmpeg ni hls.js ne raccourcit.
Réduire `-analyzeduration` a été essayé sans gain mesurable sur le HLS.

## API

| Canal IPC              | Rôle                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `iptv:sources`         | Les listes connues, avec nombre de chaînes et de disparues |
| `iptv:add`             | Ajoute une playlist (URL ou fichier) et la charge aussitôt |
| `iptv:refresh`         | Recharge une liste                                         |
| `iptv:remove`          | Supprime la liste, ses chaînes et ses logos                |
| `iptv:channels`        | Chaînes, filtrées par source, groupe, recherche, favorites |
| `iptv:groups`          | Rubriques et effectifs                                     |
| `iptv:favorite`        | Épingle une chaîne                                         |
| `iptv:cache-logos`     | Complète le cache des logos                                |
| `player:live-error`    | Pourquoi une chaîne n'a pas démarré ou s'est arrêtée       |
| `player:live-variants` | Qualités d’une chaîne HLS                                  |

Comme pour les podcasts, une erreur réseau est mémorisée sur la source (`last_error`) et jamais
propagée : une liste injoignable n'empêche pas de regarder les autres.
