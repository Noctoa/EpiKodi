# Podcasts

Code : `backend/core/podcasts/` (parseur RSS et service), `backend/core/db/repositories/podcasts.ts`,
`frontend/src/views/PodcastsView.tsx`.

## Modèle

Les épisodes ne sont **pas** rangés dans `media` : ils portent des champs qui leur sont propres
(guid du flux, URL distante, copie téléchargée, position de lecture) et ne sont pas des fichiers
d'une source scannée. Deux tables dédiées (migration v6) :

```
podcasts (feed_url unique, titre, description, auteur, pochette, last_fetch_at, last_error)
   └──< podcast_episodes (guid unique par podcast, audio_url, local_path, position, completed)
```

`UNIQUE (podcast_id, guid)` fait tout le travail de déduplication : rafraîchir un flux met à jour
les titres et ajoute les nouveautés **sans jamais écraser** la progression ni la copie hors ligne.

## Le parseur

`parseFeed()` est pur et testé. Les flux réels sont irréguliers, il gère donc :

- les namespaces iTunes (`itunes:duration`, `itunes:image`, `itunes:summary`) ;
- les trois écritures de durée : `1590`, `26:30`, `01:26:30` ;
- le HTML et les CDATA dans les descriptions, ramenés à du texte lisible ;
- l'absence de `guid` (l'URL du fichier prend le relais), de date, de durée ou d'image ;
- un épisode sans fichier audio, ignoré plutôt que de faire échouer le flux entier.

Les épisodes sont triés du plus récent au plus ancien et plafonnés à 500 : un flux de
radio publique en annonce couramment plusieurs centaines. Mesure sur un flux réel de 3 Mo
(854 épisodes) : **82 ms**.

## Lecture

Un épisode se lit depuis sa copie locale si elle existe, sinon en streaming. Dans les deux cas
l'URL passe par le protocole `media://`, qui résout le localisateur :

```
media://local/<url ou chemin>  →  sources déclarées
                               →  miniatures de l'application
                               →  pochettes de podcasts
                               →  épisode : copie locale, sinon RemoteFileProvider (HTTP + Range)
```

Passer par `media://` plutôt que par l'URL distante directe garde la politique de sécurité
stricte (`media-src 'self' media: blob:`) et donne le saut dans l'épisode via les requêtes Range.

## Reprise, téléchargement, rafraîchissement

- **Reprise** : la position est enregistrée toutes les 5 secondes et à la fin de l'épisode, qui
  passe alors en « écouté ». Relancer l'épisode repart où l'on s'était arrêté.
- **Téléchargement** : le fichier est écrit sous `<id>.mp3.part` puis renommé — une coupure
  réseau ne laisse jamais un fichier tronqué passer pour valide. La progression est remontée à
  l'interface.
- **Rafraîchissement** : automatique au démarrage, en tâche de fond (l'interface n'attend pas le
  réseau), et manuel par flux. Un échec est mémorisé dans `last_error` et affiché, jamais propagé.

## Ajouter un abonnement

Deux entrées dans le même champ : coller l'adresse d'un flux RSS, ou taper un nom — la recherche
interroge alors l'annuaire public d'Apple (`itunes.apple.com/search`), qui ne demande ni clé ni
inscription et renvoie directement les URL de flux.
