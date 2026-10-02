# Écrire une extension

Code : `backend/core/plugins/` — `manifest.ts` (format et validation), `host.ts` (ce qui tourne
dans le process du plugin), `manager.ts` (découverte et cycle de vie),
`provider-adapter.ts` (branchement sur les métadonnées).

Un exemple complet et fonctionnel est fourni : `examples/plugins/tvmaze-provider`.

## Installer une extension

Une extension est un dossier à déposer ici :

```
~/.config/epikodi/plugins/<mon-extension>/
├── manifest.json
└── index.js
```

Puis **Paramètres → Extensions → Activer**. L'écran liste aussi les manifestes invalides, avec le
détail des champs fautifs, et l'erreur d'une extension qui a planté.

Pour essayer l'exemple :

```bash
cp -r examples/plugins/tvmaze-provider ~/.config/epikodi/plugins/
```

## Le manifeste

```json
{
  "id": "mon-extension",
  "name": "Mon extension",
  "version": "1.0.0",
  "description": "Ce qu'elle fait",
  "author": "Moi",
  "main": "index.js",
  "permissions": ["network"],
  "contributes": ["metadataProvider", "hooks"]
}
```

| Champ         | Règle                                                           |
| ------------- | --------------------------------------------------------------- |
| `id`          | minuscules, chiffres et tirets, 3 à 50 caractères — sert de clé |
| `main`        | chemin **à l'intérieur** du dossier ; `../` est refusé          |
| `permissions` | `network`, `library:read`, `library:write`                      |
| `contributes` | `metadataProvider`, `hooks`, `menu`                             |

Un manifeste incomplet n'est pas chargé : chaque champ fautif est signalé dans les Paramètres
plutôt que de provoquer une erreur obscure plus tard.

## Le code

Du CommonJS, qui exporte `activate` et, si besoin, `deactivate` :

```js
exports.activate = (api) => {
  api.log('bonjour')

  api.on('media:scanned', (media) => {
    api.log(`nouveau média : ${media.title}`)
  })

  api.registerMetadataProvider({
    id: 'ma-source',
    name: 'Ma source',
    async search({ title, year, kind }) {
      const r = await api.fetch(`https://exemple.org/api?q=${encodeURIComponent(title)}`)
      const data = await r.json()
      return data.map((x) => ({ externalId: String(x.id), kind: 'tv', title: x.name }))
    },
    async details(externalId) {
      /* … renvoie une fiche complète, ou null */
    }
  })
}

exports.deactivate = () => {
  // libérer minuteries, connexions, fichiers ouverts
}
```

### L'API remise à `activate`

| Membre                            | Disponible si      | Rôle                                                |
| --------------------------------- | ------------------ | --------------------------------------------------- |
| `api.manifest`, `api.directory`   | toujours           | ton manifeste, ton dossier                          |
| `api.log(msg)`, `api.warn(msg)`   | toujours           | journalisé avec le préfixe de ton extension         |
| `api.on(event, handler)`          | `hooks`            | `media:scanned`, `media:played`                     |
| `api.registerMetadataProvider(p)` | `metadataProvider` | ta source rejoint celles de l'application           |
| `api.addMenuItem(item)`           | `menu`             | une entrée dans la barre latérale                   |
| `api.fetch(url, init)`            | `network`          | identique à `fetch` ; **absent sans la permission** |

Une permission non demandée n'est pas refusée au moment de l'appel : elle n'est tout simplement
pas présente dans l'objet `api`.

### Fournir des métadonnées

Une source déclarée par une extension est utilisée **exactement comme TheMovieDB** : elle apparaît
dans « Corriger l'identification », ses résultats sont fusionnés et triés avec les autres, et
appliquer une fiche enregistre affiche, synopsis, note, genres et casting. Le cœur de
l'application ne sait pas qu'il parle à une extension — c'est tout l'intérêt de l'abstraction
`MetadataProvider`.

Forme attendue d'une fiche :

```js
{
  externalId: '5421',          // ton identifiant, préfixé par l'application
  kind: 'tv',                  // ou 'movie'
  title: 'Titre',
  year: 2007,
  overview: 'Synopsis…',
  rating: 8.0,
  posterUrl: 'https://…',
  genres: ['Action'],
  cast: ['Nom', 'Autre nom'],  // dans `details` seulement
  runtime: 25
}
```

## Isolation : ce qui est garanti, et ce qui ne l'est pas

Chaque extension active tourne dans **son propre process** (`utilityProcess`), un par extension.

**Ce qui est garanti** : une extension qui lève une exception, boucle à l'infini ou plante
n'emporte pas l'application. L'erreur est capturée, affichée dans les Paramètres, et le reste
continue de fonctionner. Un appel qui ne répond pas est abandonné au bout de 20 secondes.

**Ce qui ne l'est pas** : ce n'est pas un bac à sable de sécurité. Le process reste un process
Node, et une extension malveillante pourrait lire des fichiers. Une extension est du code que
l'utilisateur installe volontairement, au même titre qu'une extension d'éditeur de texte.
N'installe que des extensions dont tu connais la provenance.

## Mettre au point

La sortie de l'extension (`api.log`, `console.log`, erreurs) est reprise dans la console de
l'application, préfixée par son identifiant :

```
[plugin:tvmaze-provider] prêt — TVmaze enregistré comme source de métadonnées
[plugins] mon-extension : le plugin s’est arrêté (code 1)
```

Après modification du code, désactive puis réactive l'extension dans les Paramètres : son process
est relancé, sans redémarrer EpiKodi.
