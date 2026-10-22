# Chaînes en direct (IPTV)

Une **source IPTV** est une playlist M3U — une URL `http(s)` ou un fichier local — dont
l'application garde une copie des chaînes en base. Rien n'est téléchargé : le direct n'existe
qu'au moment où on le regarde, seule la liste est mémorisée.

> La lecture des flux HLS fait l'objet de l'issue #28 ; cette page décrit pour l'instant
> l'import et le modèle de données.

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

## API

| Canal IPC          | Rôle                                                       |
| ------------------ | ---------------------------------------------------------- |
| `iptv:sources`     | Les listes connues, avec nombre de chaînes et de disparues |
| `iptv:add`         | Ajoute une playlist (URL ou fichier) et la charge aussitôt |
| `iptv:refresh`     | Recharge une liste                                         |
| `iptv:remove`      | Supprime la liste, ses chaînes et ses logos                |
| `iptv:channels`    | Chaînes, filtrées par source, groupe, recherche, favorites |
| `iptv:groups`      | Rubriques et effectifs                                     |
| `iptv:favorite`    | Épingle une chaîne                                         |
| `iptv:cache-logos` | Complète le cache des logos                                |

Comme pour les podcasts, une erreur réseau est mémorisée sur la source (`last_error`) et jamais
propagée : une liste injoignable n'empêche pas de regarder les autres.
