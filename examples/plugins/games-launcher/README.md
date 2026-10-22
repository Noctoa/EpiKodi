# Jeux — lancer un émulateur depuis EpiKodi

Extension d'exemple qui ajoute une section **Jeux** dans la barre latérale, liste les ROM d'un
dossier et les lance dans l'émulateur configuré pour leur extension.

Elle ne modifie rien dans EpiKodi : elle déclare une entrée de menu (`contributes: ["menu"]`) et
la permission de démarrer un programme (`process:launch`). Voir [docs/plugins.md](../../../docs/plugins.md).

## Installer

```bash
cp -r examples/plugins/games-launcher ~/.config/epikodi/plugins/
cp ~/.config/epikodi/plugins/games-launcher/config.example.json \
   ~/.config/epikodi/plugins/games-launcher/config.json
$EDITOR ~/.config/epikodi/plugins/games-launcher/config.json
```

Puis **Paramètres → Extensions → Activer**. La section « Jeux » apparaît dans la barre latérale.

## Configurer

`config.json` :

- `romsDir` : dossier des ROM (`~` est développé). Parcouru sur deux niveaux, ce qui permet un
  sous-dossier par console. Les fichiers cachés sont ignorés.
- `emulators` : une entrée par extension de fichier, sans le point. `{rom}` est remplacé par le
  chemin du jeu ; sans marqueur, le chemin est ajouté en dernier argument. L'entrée `default`
  sert de repli.

Seules les extensions déclarées sont listées : c'est ce qui évite de montrer les fichiers
annexes (sauvegardes, notices) posés à côté des ROM.

## Jaquettes

Une image portant le nom de la ROM, à côté d'elle ou dans `<romsDir>/covers/` :

```
roms/snes/Super Mario World.sfc
roms/snes/Super Mario World.png      ← ou roms/covers/Super Mario World.png
```

Formats : png, jpg, webp. Les images partent en `data:` (une extension n'a pas de dossier servi
par l'application), donc chacune est plafonnée à 512 Ko et l'ensemble à 16 Mo — au-delà, les jeux
restent listés avec leur icône.
