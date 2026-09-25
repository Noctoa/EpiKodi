# Stockage réseau

Code : `backend/core/storage/` (abstraction et providers), `backend/library.ts` (résolution,
identifiants, pont HTTP).

## L'abstraction

Le scanner, le lecteur et l'enrichissement ne connaissent plus le système de fichiers : ils
parlent à un `StorageProvider`.

```
StorageProvider          list · stat · read(range) · available · locate · relative · ffmpegUrl
├── LocalProvider        fs — dossiers locaux et partages déjà montés par le système
├── SmbProvider          partages Windows/Samba, en espace utilisateur
└── HttpProvider         HTTP(S) et WebDAV
```

Chaque média est stocké en base sous un **localisateur** complet : chemin absolu pour une source
locale, `smb://user@nas/media/Films/film.mkv` ou `https://dav/media/film.mkv` pour une source
réseau. Les bases existantes restent valides, et un localisateur suffit à retrouver sa source.

## Décision : espace utilisateur plutôt que montage système

Trois voies ont été testées avant de trancher :

| Voie                     | Verdict                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `mount.cifs`             | demande les droits root à chaque montage — exclu pour une application de bureau    |
| `gio mount` (gvfs)       | dépend du paquet optionnel `gvfs-smb`, absent de la machine de test : trop fragile |
| Bibliothèque SMB en Node | retenue, aucun droit particulier, aucun paquet système                             |

Deux bibliothèques SMB sur trois sont **inutilisables sur Node moderne** : `@marsaud/smb2` et
`v9u-smb2` appellent DES et MD4 via `crypto`, que OpenSSL 3 refuse (`ERR_OSSL_EVP_UNSUPPORTED`).
`@tryjsky/v9u-smb2` corrige ce point et fonctionne, y compris dans Electron.

**NFS** n'a pas de client Node viable : un export se monte côté système (`fstab`, `autofs`) puis
s'ajoute comme un dossier ordinaire, que `LocalProvider` sert sans le distinguer d'un dossier local.

## Le pont HTTP local

ffmpeg et ffprobe ne connaissent que `http(s)` — `ffmpeg -protocols` ne liste pas `smb`. Un petit
serveur lié à `127.0.0.1` sur un port éphémère, protégé par un jeton aléatoire, leur présente
n'importe quelle source derrière une URL `http://`, en relayant les requêtes Range. C'est ce qui
permet d'extraire les tags et les miniatures d'un fichier distant, et de le transcoder.

## Performances et robustesse

- **Listing en lot** : `readdir(dossier, { stats: true })` ramène nom, taille, date et type en un
  seul aller-retour, au lieu d'un `stat` par fichier — décisif sur un partage distant.
- **Aucun hachage** : un fichier est considéré modifié sur sa taille et sa date, jamais relu.
- **Délais** : toute opération réseau expire au bout de 12 s.
- **Opérations sérialisées** : une connexion SMB ne supporte pas deux requêtes simultanées. Le
  scan et la vérification de disponibilité se bloquaient mutuellement ; les opérations sont donc
  mises en file par connexion.
- **Flux refermé deux fois** : la bibliothèque ferme le descripteur en fin de flux puis à la
  destruction, produisant un `STATUS_FILE_CLOSED` après les données. Il est absorbé, sinon une
  lecture réussie remonterait en échec.
- **Source injoignable** : l'échec du listing racine est remonté à l'interface (« hors ligne »),
  au lieu de rapporter « 0 fichier ». L'application démarre normalement et les médias déjà
  indexés restent consultables.

## Identifiants

Le mot de passe n'est jamais écrit en clair : il est chiffré par `safeStorage` (trousseau du
système) et stocké dans `sources.credentials`. L'URL conservée est nettoyée de tout mot de passe.
Si le trousseau est indisponible, le mot de passe reste en mémoire pour la session et un
avertissement est journalisé.

## Tester avec un vrai serveur

```bash
docker run -d --name epikodi-smb -p 1445:445 -v /chemin/vers/partage:/share dperson/samba \
  -p -u "epikodi;motdepasse" -s "media;/share;yes;no;no;epikodi"
```

Puis dans l'application : **Sources → + Partage réseau**, adresse
`smb://epikodi@localhost:1445/media`. Les tests de `backend/core/storage/smb.test.ts` visent ce
serveur et sont ignorés s'il ne répond pas.
