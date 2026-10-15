# Télécommande

Code : `shared/remote.ts` (protocole), `backend/core/remote/` (serveur HTTP + WebSocket, page
mobile), `backend/remote.ts` (cycle de vie et IPC), `frontend/src/remote/` (application des
commandes, manette).

Deux télécommandes, un seul vocabulaire : le téléphone et la manette produisent les mêmes
commandes (`RemoteCommand`), appliquées au même endroit (`frontend/src/remote/bridge.ts`).

## Activer

**Paramètres → Télécommande → Activer**, puis ouvre sur le téléphone l'adresse affichée :

```
http://192.168.1.24:8723/?t=5Hk2-rWcN8pQvT1xAbCdEf
```

Le serveur est **désactivé par défaut**. Une fois activé, il écoute sur toutes les interfaces
(`0.0.0.0`) — le téléphone est sur le réseau, pas sur la machine — et **chaque requête doit porter
le jeton**. Le port se change dans le même écran ; un port déjà pris est signalé au lieu d'échouer
en silence. **Nouveau jeton** déconnecte les appareils déjà appairés.

Le jeton est tiré au sort (16 octets) au premier lancement et conservé dans la table `settings`
de la base locale. Il fait partie de l'URL : c'est ce qui permet de n'avoir rien à saisir sur le
téléphone, au prix d'un secret qui apparaît dans l'historique du navigateur mobile.

## Architecture

```
téléphone ──HTTP/WS──► RemoteServer ──IPC remote:command──► fenêtre (bridge.ts)
                       (main)        ◄──IPC remote:publish── état du lecteur, 1×/s
manette ─────────────────────────────── Gamepad API ───────► bridge.ts
```

Le serveur vit dans le process principal, seul à voir à la fois le réseau et la fenêtre. Il ne
connaît pas les lecteurs : il relaie des commandes et diffuse le dernier état publié. Le frontend
publie son état une fois par seconde — et seulement si le serveur écoute — en interrogeant le
lecteur actif par scrutation, pour ne pas provoquer un rendu React par seconde de lecture.

Le lecteur vidéo plein cadre a la priorité sur la file audio : c'est lui qui occupe l'écran.

## Authentification

Le jeton se transmet de deux façons, au choix :

| Forme     | Exemple                         |
| --------- | ------------------------------- |
| Paramètre | `/api/state?t=<jeton>`          |
| En-tête   | `Authorization: Bearer <jeton>` |

Sans jeton valide : `401`. Sur `/`, la réponse est une page qui renvoie vers les Paramètres ; sur
`/api/*` et `/ws`, c'est un JSON d'erreur. La comparaison est à temps constant
(`timingSafeEqual`).

## API HTTP

### `GET /`

La page de télécommande (HTML autonome, sans dépendance externe).

### `GET /api/state`

L'état du lecteur.

```json
{
  "source": "video",
  "playing": true,
  "title": "Interstellar.mkv",
  "subtitle": null,
  "position": 1284.5,
  "duration": 10140,
  "volume": 0.8,
  "muted": false,
  "view": "Vidéos"
}
```

`source` vaut `video`, `audio` ou `none` (rien en lecture). `position` et `duration` sont en
secondes, `volume` entre 0 et 1, `view` est le titre de l'écran affiché dans l'application.

### `POST /api/command`

Corps : une commande JSON. Réponse : l'état (`200`), ou `400` si la commande est inconnue ou mal
formée — rien n'est alors transmis au lecteur. Le corps est plafonné à 4 Kio.

```bash
TOKEN=5Hk2-rWcN8pQvT1xAbCdEf
curl -s "http://192.168.1.24:8723/api/state?t=$TOKEN"
curl -s -X POST "http://192.168.1.24:8723/api/command?t=$TOKEN" \
     -H 'content-type: application/json' -d '{"type":"toggle"}'
```

## WebSocket

`GET /ws?t=<jeton>` — bascule en WebSocket (RFC 6455, implémentation maison dans
`backend/core/remote/websocket.ts` : messages texte, ping/pong, aucune extension).

- **Serveur → client** : `{"type":"state","state":{…}}`, à la connexion puis à chaque changement.
- **Client → serveur** : une commande JSON par message, même format que `POST /api/command`. Une
  commande invalide est ignorée (la socket reste ouverte).

Un ping est envoyé toutes les 30 s : un téléphone dont l'écran s'éteint est détecté et retiré de
la liste des clients. La page se reconnecte d'elle-même, et au retour au premier plan.

## Commandes

| Commande                               | Effet                                                            |
| -------------------------------------- | ---------------------------------------------------------------- |
| `{"type":"toggle"}`                    | Lecture / pause                                                  |
| `{"type":"play"}` / `{"type":"pause"}` | Lecture, pause                                                   |
| `{"type":"stop"}`                      | Ferme le lecteur vidéo, ou vide la file audio                    |
| `{"type":"next"}` / `{"type":"prev"}`  | Piste suivante / précédente (sans effet sur une vidéo)           |
| `{"type":"seek","position":90}`        | Position absolue, en secondes                                    |
| `{"type":"seek-by","delta":-10}`       | Saut relatif, borné à ±600 s                                     |
| `{"type":"volume","value":0.4}`        | Volume, borné à [0, 1]                                           |
| `{"type":"mute"}`                      | Bascule muet                                                     |
| `{"type":"key","key":"up"}`            | Navigation : `up`, `down`, `left`, `right`, `ok`, `back`, `home` |

Toute commande venue du réseau repasse par `parseCommand` (`shared/remote.ts`), qui valide le type,
exige des nombres finis, borne les valeurs et jette les champs en trop.

Tant que l'on pilote à la télécommande, `<body>` porte la classe `remote-nav` et l'élément
focalisé porte l'attribut `data-cursor` : c'est lui qui est surligné. Un attribut plutôt qu'une
classe, parce que React réécrit le `className` qu'il a rendu ; et le focus du document plutôt
qu'une marque posée par chaque grille, parce que l'accueil en affiche deux et que chacune suivait
son propre index — il y avait alors deux curseurs à l'écran.

Deux raisons de ne pas s'en remettre à `:focus-visible` : il ne s'allume que pour une frappe
clavier réelle, et `:focus` lui-même s'éteint dès que la fenêtre perd le focus du système — or
piloter depuis un téléphone, c'est justement ne pas être devant. La classe tombe au premier
mouvement de souris.

Le liseré entoure la **vignette**, pas la carte : une carte est étirée à la hauteur de sa ligne
(les titres font une ou deux lignes), le contour dessinait donc une grande boîte vide qui
débordait sur la section suivante.

En changeant d'écran, le curseur se pose sur le premier élément de la vue, et `ok` **clique**
l'élément sous le curseur : un `keydown` synthétique ne déclenche pas l'action par défaut d'un
bouton — seul un événement de confiance le fait — donc « OK » sur « ▶ Lire » ne faisait rien.
Quand rien n'est focalisé, la première touche pose le curseur sans rien déclencher ; `back` fait
exception et revient en arrière même sans curseur.

Les touches de navigation sont rejouées en événements clavier (`ArrowUp`, `Entrée`, `Échap`…)
plutôt que traitées à part : les raccourcis existent déjà dans le lecteur et dans l'application,
la télécommande n'en est pas une deuxième implémentation. Elle hérite donc du focus directionnel
décrit dans [docs/ui.md](ui.md) : d'une vignette à l'autre dans une grille, puis d'une zone à
l'autre — section suivante, barre latérale, boutons de la vue détail. Devant une vidéo, `ok` vaut
lecture / pause, comme sur une télécommande de salon.

## Manette

Gamepad API, mappage « standard » (Xbox, DualShock, 8BitDo). Le navigateur n'émet aucun événement
de bouton : l'état est scruté à chaque image — mais la boucle ne tourne que lorsqu'une manette est
branchée. Une manette n'apparaît qu'après une première pression (protection de la vie privée du
navigateur), et ne demande ni serveur ni jeton.

| Bouton          | Action                       |
| --------------- | ---------------------------- |
| Croix / stick G | Navigation (auto-répétition) |
| A / croix       | OK — lecture/pause sur vidéo |
| B / rond        | Retour                       |
| X / carré       | Lecture / pause              |
| Y / triangle    | Muet                         |
| L1 / R1         | Piste précédente / suivante  |
| L2 / R2         | −30 s / +30 s                |
| Start           | Accueil                      |

## Limites connues

- Le jeton circule en clair sur le réseau local (pas de TLS) : c'est un usage domestique, pas un
  service exposé sur Internet. Ne pas rediriger le port sur la box.
- Pas de découverte automatique (mDNS) : l'adresse se lit dans les Paramètres.
- La télécommande pilote la lecture et la navigation, mais ne parcourt pas la bibliothèque : on ne
  choisit pas un film depuis le téléphone.
