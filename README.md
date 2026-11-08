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
npm test           # tests du moteur de jeu (vitest)
```

`npm run dev` affiche une adresse « Network » (par ex. `http://192.168.1.20:5173`) :
ouvre-la dans Chrome sur Android pour jouer sur le téléphone.

## Installer le jeu comme une appli

Sur Android, dans Chrome : onglet **Ma compagnie** puis « 📲 Installer le jeu », ou menu ⋮
puis « Installer l'application ». Le jeu s'ouvre alors en plein écran depuis l'écran d'accueil.

- **Sans connexion** : le service worker (`src/pwa/sw.js`) garde sur l'appareil tous les
  fichiers du jeu, ainsi que les morceaux de carte déjà vus (1 500 au plus, les plus anciens
  sont effacés). Au build, `vite.config.ts` complète `dist/sw.js` avec la liste des fichiers
  et un numéro de version, qui change dès qu'un fichier change.
- **Mises à jour** : au lancement, la version en ligne est prise s'il y a du réseau ; sinon
  le jeu démarre avec la version gardée.
- Le service worker n'existe que dans la version construite (`npm run build`), jamais avec
  `npm run dev`.
- Site protégé par la connexion Netlify : le manifeste est demandé avec
  `crossorigin="use-credentials"` (dans `index.html`) : sans cela, Chrome n'envoie pas le
  cookie de connexion en le demandant, et le serveur refuse de le lui donner.

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

## Les avions qui volent

- **Trafic réel** : environ 100 000 vols par jour de 590 vraies compagnies, sur leurs lignes
  actuelles, avec leurs vrais numéros de vol et les avions de leur flotte (voir `data/README.md`).
  10 000 à 16 000 avions sont en l'air à tout moment, synchronisés sur l'horloge du jeu
  (×1 à ×10 000).
- **Sur la carte** : chaque avion suit l'arc de grand cercle entre ses deux aéroports, orienté selon
  son cap, avec la silhouette de sa catégorie (turbopropulseur, jet régional, monocouloir,
  gros-porteur, quadriréacteur), une taille selon son envergure réelle et la couleur de sa compagnie.
  Le numéro de vol s'affiche en zoomant. Vu de loin, un échantillon stable est dessiné pour rester
  fluide sur téléphone.
- **Toucher un avion** : fiche du vol (compagnie et logo, numéro, départ → arrivée avec heures,
  modèle, passagers / places ou charge cargo, altitude, vitesse, arrivée dans…), trajectoire
  parcourue et restante, bouton « Suivre » pour que la caméra accompagne l'avion.
- **Bouton ✈** en bas à gauche : nombre d'avions en vol, et masquer / afficher le trafic des autres
  compagnies.
- **Vols du joueur** : `aircraft.addProvider(fn)` ajoute une source de vols au format `Flight`
  (`src/flights/types.ts`) ; ils sont toujours affichés, un peu plus gros, avec un contour blanc.

## Le jeu : gérer sa compagnie

- **Créer sa compagnie** (4 étapes) : nom, code à 2 lettres (numéros de vol), couleur et logo
  (symbole et forme, ou image importée) ; pays du siège (vrais taux d'impôt, TVA, aéroports,
  trafic, niveau de vie), dans la liste ou en touchant le globe ; capital de départ (facile,
  normal, difficile) ; premier hub parmi les vrais aéroports du pays, classés par trafic et payés
  selon leur taille.
- **Hubs** : guide des premiers pas, améliorations (portes, licences de lignes, parking, qualité du
  terminal, atelier de maintenance), achat d'autres hubs dans le monde (25 % plus cher hors de
  son pays), revente.
- **Lignes** : ouverture d'une vraie ligne depuis un hub (demande et concurrents réels), prix du
  billet réglable, fermeture.
- **Avions** : contrats avec les vrais constructeurs (remise selon la quantité, délais de
  livraison), marché de l'occasion renouvelé chaque semaine, pannes, réparations, révisions,
  changement de base, revente.
- **Pilotes** : recrutement (étoiles, salaire, qualifications par famille d'avions), formation,
  licenciement. Un pilote qualifié se présente dès qu'un nouveau type d'avion arrive dans la flotte.
  On met un pilote dans un avion et on lui donne ses lignes : les vols suivent des horaires
  réalistes (de 5 h 30 à 23 h, heure locale).
- **Économie** : billets selon la distance et le niveau de vie, kérosène qui varie, taxes
  d'aéroport, équipages, maintenance, assurance, intérêts, impôt sur les sociétés du pays (pertes
  reportées), TVA sur les vols intérieurs, emprunts, faillite si la trésorerie reste négative.
- **Carte** : le réseau du joueur à sa couleur (lignes pleines si un avion y vole, pointillées
  sinon) ; ses avions volent au milieu du trafic réel ; toucher un hub, une ligne ou un avion ouvre
  sa fiche.
- **Sauvegarde** : automatique dans le navigateur (`localStorage`, avec numéro de version et
  migration). Chaque navigateur garde la sienne : pour passer de l'un à l'autre, « Copier le
  code » puis « Coller un code » (onglet Ma compagnie), ou export / import d'un fichier. Une
  sauvegarde illisible est mise de côté, jamais effacée. Le temps peut continuer quand le jeu
  est fermé (jusqu'à 7 jours).

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/core/` | Logique indépendante de l'affichage : horloge du jeu (`clock.ts`), position du soleil (`sun.ts`) |
| `src/map/` | Tout ce qui touche à la carte : création, fond de carte, jour/nuit, pays |
| `src/flights/` | Vols : format commun (`types.ts`), trafic réel (`realTraffic.ts`), calculs de grand cercle (`geo.ts`), chargement des données (`data.ts`) |
| `src/map/aircraft.ts` | Calque des avions : animation, toucher, trajectoire, caméra qui suit ; silhouettes dans `aircraftIcons.ts` |
| `src/map/layerSlots.ts` | Emplacements où les futurs calques s'insèrent (lignes aériennes, aéroports, avions) |
| `src/map/networkLayer.ts` | Réseau du joueur sur la carte (hubs, destinations, lignes) et aperçus pendant les choix |
| `src/game/` | Moteur du jeu, sans affichage : état et sauvegarde (`state.ts`, `save.ts`), simulation (`sim.ts`), actions du joueur (`actions.ts`), économie, flotte, hubs, pilotes, réglages chiffrés (`config.ts`) |
| `src/ui/` | Interface par-dessus la carte (barre du temps, fiche pays, fiche vol) |
| `src/ui/game/` | Interface du jeu : création de compagnie (`wizard.ts`), barre d'onglets et panneau (`ui.ts`), écrans (`views/`), styles (`game.css`) |
| `src/pwa/` | Appli installable : service worker pour jouer sans connexion (`sw.js`), proposition d'installation de Chrome (`index.ts`) |
| `tests/` | Tests du moteur (`npm test`) ; `calibration.test.ts` (avec `CALIB=1 npm test`) affiche des comptes simulés pour régler l'équilibre économique |
| `public/geo/` | Données géographiques servies telles quelles (contours des pays, lumières des villes) |
| `data/` | Données réelles du jeu (aéroports, trafic, lignes, avions), préparées à part |

Règle simple : tout ce qui dépend du temps lit `clock.now()` (jamais `Date.now()`), pour
que l'accélération du temps s'applique partout.

Le moteur (`src/game/`) ne touche jamais au DOM : l'interface appelle ses actions
(`game.run(action, …)`), qui renvoient un message d'erreur en français ou modifient la partie.
Les vols du joueur sont donnés au calque des avions par `playerFlights()` (`src/game/flights.ts`).

## Sources et licences

- Fond de carte : [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org),
  données © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- Relief : [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen, sources ouvertes).
- Lumières nocturnes : NASA Earth Observatory / GIBS, *Black Marble* VIIRS 2016 (domaine public), image mondiale puis tuiles détaillées selon le zoom.
- Contours des pays : [Natural Earth](https://www.naturalearthdata.com) (domaine public),
  noms français repris du projet simulateur-mss.
- Trafic aérien : [Standing Data](https://github.com/vradarserver/standing-data) de Virtual Radar Server (CC0),
  [OpenFlights](https://openflights.org/data) (ODbL), [Jonty/airline-route-data](https://github.com/Jonty/airline-route-data).
- Moteur de carte : [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause).
