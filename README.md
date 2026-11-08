# Simulateur de compagnie aérienne

Jeu web gratuit, jouable dans le navigateur sur téléphone (Android) et sur ordinateur.
On crée sa compagnie, on choisit son pays et son hub, on achète des avions, on forme
des pilotes et on ouvre des lignes réelles, le tout sur une carte du monde vivante.

## Lancer le jeu

```bash
npm install
npm run dev        # serveur de développement (accessible aussi depuis le téléphone sur le même Wi-Fi)
npm run build      # version finale dans dist/
npm run preview    # tester la version finale
```

`npm run dev` affiche une adresse « Network » (par ex. `http://192.168.1.20:5173`) :
ouvre-la dans Chrome sur Android pour jouer sur le téléphone.

## Ce qui est en place : la carte et le globe

- **Globe 3D** (MapLibre GL, projection globe) : glisser, pincer pour zoomer, du globe
  entier jusqu'aux rues. Bouton 🌍 pour revenir au globe.
- **Détails selon le zoom** (fond OpenFreeMap / OpenStreetMap, gratuit et sans clé) :
  noms en français, petits pays et rivières masqués de loin, forêts, déserts, glaciers,
  zones urbaines, routes, bâtiments en 3D de très près.
- **Relief** : ombrage des montagnes (AWS Terrain Tiles) et sommets avec leur altitude.
- **Jour / nuit** suivant la vraie position du soleil : ombre avec crépuscule progressif,
  lumières des villes la nuit (images NASA Black Marble, de plus en plus détaillées
  en zoomant, puis rues éclairées de près). L'ombre glisse à chaque image, même en ×10000.
- **Horloge du jeu** : temps réel par défaut, puis pause, ×10, ×100, ×1000, ×10000.
  Bouton « Maintenant » pour revenir à l'heure réelle.
- **Pays cliquables** : toucher un pays le met en surbrillance et affiche son nom et son
  drapeau (base du futur choix du pays de la compagnie).

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/core/` | Logique indépendante de l'affichage : horloge du jeu (`clock.ts`), position du soleil (`sun.ts`) |
| `src/map/` | Tout ce qui touche à la carte : création, fond de carte, jour/nuit, pays |
| `src/map/layerSlots.ts` | Emplacements où les futurs calques s'insèrent (lignes aériennes, aéroports, avions) |
| `src/ui/` | Interface par-dessus la carte (barre du temps, fiche pays) |
| `public/geo/` | Données géographiques servies telles quelles (contours des pays, lumières des villes) |
| `data/` | Données réelles du jeu (aéroports, trafic, lignes, avions), préparées à part |

Règle simple : tout ce qui dépend du temps lit `clock.now()` (jamais `Date.now()`), pour
que l'accélération du temps s'applique partout.

## Sources et licences

- Fond de carte : [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org),
  données © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- Relief : [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen, sources ouvertes).
- Lumières nocturnes : NASA Earth Observatory / GIBS, *Black Marble* VIIRS 2016 (domaine public), image mondiale puis tuiles détaillées selon le zoom.
- Contours des pays : [Natural Earth](https://www.naturalearthdata.com) (domaine public),
  noms français repris du projet simulateur-mss.
- Moteur de carte : [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause).
