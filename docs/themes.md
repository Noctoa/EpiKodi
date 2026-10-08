# Thèmes

Code : `frontend/src/styles/tokens.css` (les variables), `frontend/src/theme.tsx` (application),
`backend/core/themes/` (format, validation, découverte).

## Le principe

Toute couleur, tout rayon et toute taille réglable de l'interface passe par une **variable CSS**
définie dans `tokens.css`. Aucun composant ne contient de couleur en dur — c'est ce qui permet à
un thème de tout repeindre sans toucher au code, et c'est aussi pourquoi le changement est
**instantané** : le navigateur recalcule les variables, aucun composant n'est rendu à nouveau.

Un seul `#000` subsiste volontairement, dans le lecteur : le fond derrière la vidéo, qui doit
rester noir quel que soit le thème.

## Les variables

| Groupe            | Variables                                                               |
| ----------------- | ----------------------------------------------------------------------- |
| Fonds             | `--bg`, `--surface`, `--surface-2`                                      |
| Texte             | `--text`, `--text-muted`                                                |
| Accent            | `--accent`, `--accent-hover`, `--accent-soft`                           |
| États             | `--danger`, `--danger-soft`, `--warning`, `--warning-soft`, `--success` |
| Calques sur média | `--overlay`, `--overlay-strong`, `--overlay-gradient`, `--on-media…`    |
| Formes et tailles | `--radius`, `--font`, `--font-size`, `--tile-min`                       |

`--tile-min` fixe la largeur minimale d'une vignette : c'est elle qui permet à un thème « salon »
d'agrandir la grille pour une lecture à distance.

Les calques posés sur une image ou une vidéo restent sombres dans tous les thèmes : ils se
superposent à du contenu dont on ne maîtrise pas la luminosité.

## Les thèmes intégrés

**Système** (par défaut) suit le réglage clair/sombre du bureau, via `prefers-color-scheme`.
**Sombre** et **Clair** l'imposent. Techniquement, l'attribut `data-theme` est posé sur `<html>` ;
son absence signifie « système ».

Le dernier choix est mémorisé localement et réappliqué **avant le premier rendu**, pour éviter un
passage visible du sombre au clair au démarrage.

## Écrire un thème

Un dossier contenant un `theme.json` :

```json
{
  "id": "salon",
  "name": "Salon",
  "description": "Grandes vignettes et contraste élevé",
  "base": "dark",
  "tokens": {
    "--bg": "#000000",
    "--accent": "#ffc400",
    "--tile-min": "300px",
    "--font-size": "17px"
  }
}
```

`base` indique le thème intégré dont on part : seules les variables listées sont surchargées, le
reste est hérité. Un thème ne contient **aucun code**, uniquement des valeurs.

Deux emplacements, pour deux usages :

```
~/.config/epikodi/themes/<id>/theme.json      un thème seul
~/.config/epikodi/plugins/<id>/theme.json     un thème livré avec une extension
```

Pour essayer l'exemple fourni :

```bash
cp -r examples/themes/salon ~/.config/epikodi/themes/
```

Puis **Paramètres → Apparence** : survole un thème pour l'essayer, clique pour le garder.

## Validation

Les valeurs d'un thème finissent injectées dans une feuille de style : elles sont donc validées
avant d'être appliquées. Sont acceptées les couleurs (`#fff`, `rgb()`, `hsl()`), les longueurs
(`px`, `rem`, `%`…) et les piles de polices. Sont refusés `url()`, `@import`, `expression()`, et
tout caractère permettant de sortir de la déclaration (`;`, `}`, `<`).

Une seule valeur refusée invalide le thème entier plutôt que d'être ignorée en silence : le
fichier est signalé dans les Paramètres, avec le détail du champ fautif. Un thème fautif
n'empêche pas les autres de se charger.
