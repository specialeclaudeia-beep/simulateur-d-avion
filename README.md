# Simulateur de compagnie aérienne

Jeu web gratuit, jouable dans le navigateur sur téléphone (Android), sur tablette et sur
ordinateur. On crée sa compagnie, on choisit son pays et son hub, on achète des avions, on forme
des pilotes et on ouvre des lignes réelles, le tout sur une Terre vue du ciel où vole le vrai
trafic aérien.

Trois façons de jouer, chacune avec sa propre sauvegarde : **partie libre sans concurrence**,
**partie libre avec concurrence** et **mode par échelons**.

## Lancer le jeu

```bash
npm install
npm run dev        # serveur de développement (accessible aussi depuis le téléphone sur le même Wi-Fi)
npm run build      # vérifie les types puis construit la version finale dans dist/
npm run preview    # tester la version finale
npm test           # tests du moteur de jeu (vitest)
```

`npm run dev` affiche une adresse « Network » (par ex. `http://192.168.1.20:5173`) :
ouvre-la dans Chrome sur Android pour jouer sur le téléphone.

## Installer le jeu comme une appli

Sur Android, dans Chrome : bouton « Installer le jeu » en bas de la page d'accueil (ou dans
l'onglet **Ma compagnie** pendant une partie), ou menu ⋮ puis « Installer l'application ». Le
jeu s'ouvre alors en plein écran depuis l'écran d'accueil du téléphone.

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

## L'accueil et les modes de jeu

Le jeu s'ouvre toujours sur la **page d'accueil** : le globe qui tourne en fond, le compte du
joueur en haut à droite et trois boutons au milieu. Quand une partie existe, une pastille
« Reprendre » au-dessus des boutons relance la dernière partie jouée en un toucher.

- **Mon compte** (en haut à droite) : un profil gardé sur l'appareil, sans serveur ni mot de
  passe. Pseudo, couleur, emblème, grade selon le temps de jeu (d'« Élève pilote » à « Légende
  des airs »), chiffres de carrière, trophées du mode par échelons. C'est aussi là qu'on gère ses
  parties enregistrées : exporter (fichier ou code à copier), importer, supprimer.
- **Partie libre** (premier bouton) : deux choix.
  - *Sans concurrence* : le joueur est seul sur ses lignes, seuls la voiture et le train lui
    disputent des passagers. Pour apprendre et construire tranquillement.
  - *Avec concurrence* : chaque ligne a pour concurrentes les vraies compagnies qui la
    desservent, et la situation bouge (guerre des prix, nouvelle venue sur une ligne où le joueur
    est presque seul, rivale qui abandonne face à un joueur bien installé).
- **Mode par échelons** (deuxième bouton) : voir ci-dessous.
- **Paramètres** (troisième bouton) : son, graphismes, touches du clavier.

**Trois sauvegardes séparées** : une par mode (libre sans concurrence, libre avec concurrence,
échelons). Commencer une nouvelle partie ne remplace l'ancienne de son mode qu'au moment où la
compagnie est créée. Une partie de l'ancienne version du jeu se retrouve en partie libre avec
concurrence, sans rien perdre.

**Pendant une partie**, le bouton de menu de la barre du haut (ou la touche Échap) ouvre le menu
du jeu : reprendre, objectifs (mode par échelons), paramètres, retour à l'accueil. La partie est
toujours enregistrée en quittant. Le menu met le temps en pause seulement s'il était accéléré.

### Le mode par échelons

On commence tout petit dans un pays : un hub, deux avions à hélices, trois aéroports à relier.
Chaque échelon a **trois objectifs** :

1. **relier** un certain nombre d'aéroports du pays (un aéroport compte quand sa ligne a fait
   20 vols ; le hub compte aussi) ;
2. **satisfaire** les passagers (taux de satisfaction à atteindre) ;
3. **gagner de l'argent** (bénéfices de l'échelon, hors achats d'avions et de hubs).

Dès que **deux objectifs sur trois** sont atteints, on peut partir dans un nouveau pays, à plus
grande échelle, avec **une amélioration à choisir** parmi trois. En atteignant les trois, on en
choisit deux. Changer de pays, c'est repartir ailleurs en plus grand : tout est revendu, la
compagnie garde son nom, ses améliorations, son meilleur pilote et une partie de ses bénéfices
(au plus la moitié du capital de l'échelon suivant).

| Échelon | Capital | Aéroports à relier | Satisfaction | Bénéfices | Avions | Lignes | Plus gros avions |
|---|---|---|---|---|---|---|---|
| 1. Régional | 40 M$ | 3 | 60 % | 1,5 M$ | 2 | 3 | turbopropulseurs |
| 2. Inter-régional | 80 M$ | 5 | 64 % | 4 M$ | 4 | 5 | jets régionaux |
| 3. National | 150 M$ | 8 | 68 % | 8 M$ | 6 | 8 | moyen-courriers |
| 4. Grand national | 300 M$ | 12 | 72 % | 20 M$ | 9 | 12 | moyen-courriers |
| 5. International | 600 M$ | 18 | 75 % | 40 M$ | 13 | 18 | gros-porteurs |
| 6. Mondial | 1,2 Md$ | 25 | 78 % | 100 M$ | 18 | 25 | très gros-porteurs |

Le mode par échelons se joue toujours avec concurrence. Les lignes vers l'étranger s'ouvrent à
l'échelon 5. Seuls sont proposés les pays et les hubs assez bien reliés pour l'échelon ; quand
l'objectif couvre tous les aéroports reliés du pays, il s'affiche « Relier tout le pays ». Après
le dernier échelon, toutes les limites tombent et la partie continue sans contrainte.

**Les améliorations** (trois sont proposées à chaque changement de pays) : flotte élargie
(+2 avions), nouvelles licences (+2 lignes), bureau de recrutement (embaucher des pilotes
expérimentés ; avant, on forme les siens), division fret (avions-cargos), terminaux premium
(+1 niveau de qualité des hubs), grand atelier (+1 niveau de maintenance), avions plus gros (une
catégorie d'avance), hub supplémentaire, droits internationaux, négociateur (−5 % sur les
avions), école de pilotes (formations deux fois plus rapides, à moitié prix), investisseurs
(+20 % de capital de départ).

En cas de faillite, on recommence l'échelon en cours (même pays, même capital, hub au choix)
sans perdre ses améliorations. Les règles sont dans `src/game/campaign.ts`, le passage
d'un échelon à l'autre dans `src/game/campaignFlow.ts`.

## Paramètres et clavier

Les paramètres s'ouvrent depuis l'accueil et depuis le menu du jeu. Ils valent pour toutes les
parties sur cet appareil et ne voyagent pas avec une sauvegarde (un téléphone et un ordinateur
n'ont pas les mêmes besoins).

- **Son** : tout couper, volume de la musique, volume des effets sonores, sons des boutons et
  des messages, passage au morceau suivant.
- **Graphismes** : qualité du rendu (Économie, Équilibré, Élevé : netteté de la carte, flous,
  ombres, animations), détail du jeu (Faible, Moyen, Élevé : nombre d'avions affichés, lumières
  des villes, étiquettes, traînées), limite d'images par seconde (30, 60, 120 ou sans limite) et
  compteur d'images par seconde. Un téléphone démarre sur les réglages moyens, un ordinateur
  sur les réglages élevés.
- **Touches** : chaque action a sa touche, modifiable d'un clic (une touche déjà prise est
  retirée à l'action qui l'avait) ; bouton pour revenir aux touches d'origine.

| Action | Touche d'origine |
|---|---|
| Pause / reprendre | Espace |
| Accélérer / ralentir le temps | + / - |
| Déplacer la carte | flèches |
| Zoomer / dézoomer | Page ↑ / Page ↓ |
| Voir le globe entier | G |
| Remettre le nord en haut | N |
| Afficher / masquer le trafic | T |
| Suivre l'avion sélectionné | S |
| Ma compagnie, Hubs, Flotte, Pilotes, Lignes, Finances | C, H, F, P, L, B |
| Fermer / retour / menu | Échap |
| Couper / remettre le son | M |
| Plein écran | V |

Les touches ne font rien pendant qu'on écrit dans un champ, ni avec Ctrl, Alt ou Cmd.

## La carte et le globe

- **La Terre vue du ciel** (MapLibre GL, projection globe) : images satellite sans nuages du
  globe entier jusqu'au détail des pistes d'aéroport. Mers, déserts, forêts, montagnes et
  rivières sont les vrais. Glisser, pincer pour zoomer ; un bouton de la barre du haut ramène au
  globe entier.
- **Par-dessus l'image** (données OpenStreetMap, gratuites et sans clé) : frontières, pistes,
  routes, voies ferrées, sommets avec leur altitude, et tous les noms en français (petits pays
  et rivières masqués de loin). Le réglage « détail du jeu » décide de ce qui s'ajoute :
  bâtiments de très près et noms de quartiers seulement en détail élevé.
- **Jour / nuit** suivant la vraie position du soleil, calculé par la carte graphique : ombre
  avec crépuscule progressif, lumières des villes la nuit (images NASA Black Marble, de plus en
  plus détaillées en zoomant). La nuit reste fluide à toutes les vitesses du temps.
- **Horloge du jeu** : temps réel par défaut, puis pause, ×10, ×100, ×1000, ×10000. Si le jeu
  est en retard sur l'heure réelle, le bouton « Maintenant » la rattrape.
- **Pays cliquables** : toucher un pays le met en surbrillance et affiche sa fiche (nom,
  drapeau).
- **Fluidité** : le style de la carte ne garde qu'une quarantaine de calques ; la nuit et les
  avions sont dessinés par deux calques WebGL écrits pour le jeu (`nightGl.ts`,
  `aircraftGl.ts`) ; toutes les animations passent par une seule boucle (`src/core/frames.ts`)
  qui applique la limite d'images par seconde choisie et mesure les FPS réels.

## Les avions qui volent

- **Trafic réel** : environ 100 000 vols par jour de 590 vraies compagnies, sur leurs lignes
  actuelles, avec leurs vrais numéros de vol et les avions de leur flotte (voir `data/README.md`).
  10 000 à 16 000 avions sont en l'air à tout moment, synchronisés sur l'horloge du jeu
  (×1 à ×10 000).
- **Sur la carte** : chaque avion suit l'arc de grand cercle entre ses deux aéroports, orienté selon
  son cap, avec la silhouette de sa catégorie (turbopropulseur, jet régional, monocouloir,
  gros-porteur, quadriréacteur), une taille selon son envergure réelle et la couleur de sa compagnie.
  La carte graphique fait avancer chaque avion à chaque image : le mouvement est continu, même
  quand le processeur ne recalcule les positions que de temps en temps. Vu de loin, un échantillon
  stable est dessiné pour rester fluide sur téléphone (sa taille dépend du réglage « détail du
  jeu »).
- **Toucher un avion** : fiche du vol (compagnie et logo, numéro, départ → arrivée avec heures,
  modèle, passagers / places ou charge cargo, altitude, vitesse, arrivée dans…), trajectoire
  parcourue et restante, bouton « Suivre » pour que la caméra accompagne l'avion (il reste visible
  à côté de sa fiche).
- **Bouton « … en vol »** : nombre d'avions en vol, et masquer / afficher le trafic des autres
  compagnies.
- **Vols du joueur** : `aircraft.addProvider(fn)` ajoute une source de vols au format `Flight`
  (`src/flights/types.ts`) ; ils sont toujours affichés, un peu plus gros, avec un contour blanc.

## Le jeu : gérer sa compagnie

- **Créer sa compagnie** (4 étapes en partie libre, 3 en mode par échelons où le capital est
  fixé par l'échelon) : nom, code à 2 lettres (numéros de vol), couleur et logo (symbole et
  forme, ou image importée) ; pays du siège (vrais taux d'impôt, TVA, aéroports, trafic, niveau
  de vie), dans la liste ou en touchant le globe ; capital de départ (facile, normal,
  difficile) ; premier hub parmi les vrais aéroports du pays, classés par trafic et payés selon
  leur taille.
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
  migration), une par mode de jeu. Chaque navigateur garde les siennes : pour passer de l'un à
  l'autre, « Copier le code » puis « Coller un code », ou export / import d'un fichier (dans
  « Mon compte » à l'accueil, ou dans l'onglet Ma compagnie). Une sauvegarde illisible est mise de
  côté, jamais effacée. Le temps peut continuer quand le jeu est fermé (jusqu'à 7 jours) : au
  retour, un résumé dit ce qui s'est passé pendant l'absence.

## Un affichage par appareil

- **Téléphone tenu droit** : la carte en haut, les écrans du jeu dans un panneau qui monte du
  bas (on peut l'agrandir en plein écran) ; à l'accueil, le globe entier au-dessus du menu.
- **Téléphone couché** : le panneau passe à droite et la carte reste visible à gauche ; à
  l'accueil, le titre à gauche et les trois boutons à droite.
- **Écran large** (900 px et plus : ordinateur, tablette couchée) : panneau de 420 px à droite,
  barre d'onglets flottante, clavier.

Toucher un avion ou un pays ferme le panneau qui cacherait sa fiche. La règle « panneau sur le
côté ou en bas » est dans `sidePanel()` (`src/ui/game/ui.ts`), la marge que la caméra laisse
autour des panneaux dans `mapPadding()`.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/core/` | Logique indépendante de l'affichage : horloge du jeu (`clock.ts`), position du soleil (`sun.ts`), cadence des images (`frames.ts`), paramètres (`settings.ts`), compte du joueur (`profile.ts`) |
| `src/map/` | Tout ce qui touche à la carte : création (`createMap.ts`), fond satellite et noms (`baseStyle.ts`), nuit (`dayNight.ts`, `nightGl.ts`, `nightLightsDetail.ts`), pays (`countries.ts`), outils WebGL (`gl.ts`) |
| `src/map/aircraft.ts` | Calque des avions : positions, toucher, trajectoire, caméra qui suit ; dessin par la carte graphique dans `aircraftGl.ts`, silhouettes dans `aircraftIcons.ts` |
| `src/map/layerSlots.ts` | Emplacements où les calques s'insèrent (lignes aériennes, aéroports, avions) |
| `src/map/networkLayer.ts` | Réseau du joueur sur la carte (hubs, destinations, lignes) et aperçus pendant les choix |
| `src/flights/` | Vols : format commun (`types.ts`), trafic réel (`realTraffic.ts`), calculs de grand cercle (`geo.ts`), chargement des données (`data.ts`) |
| `src/game/` | Moteur du jeu, sans affichage : état et sauvegardes (`state.ts`, `save.ts`), nouvelle partie (`newGame.ts`), simulation (`sim.ts`), actions du joueur (`actions.ts`), concurrence (`competition.ts`), mode par échelons (`campaign.ts`, `campaignFlow.ts`), économie, flotte, hubs, pilotes, réglages chiffrés (`config.ts`) |
| `src/audio/` | Son : musique (`music.ts`), bruitages des avions (`flightSounds.ts`) et de l'interface (`uiSounds.ts`), moteur audio (`engine.ts`) |
| `src/ui/` | Écrans hors partie et éléments posés sur la carte : accueil et compte (`home.ts`), paramètres (`settingsScreen.ts`), menu du jeu (`menu.ts`), clavier (`keyboard.ts`), pile des écrans ouverts (`layers.ts`), barre du temps (`hud.ts`), fiches pays et vol, icônes (`icons.ts`), styles (`screens.css`, `../style.css`) |
| `src/ui/game/` | Interface du jeu : enchaînement accueil, création, partie (`index.ts`), création de compagnie (`wizard.ts`), barre d'onglets et panneau (`ui.ts`), écrans (`views/`, dont `campaign.ts` pour les objectifs et le changement d'échelon), export et import des parties (`saves.ts`), styles (`game.css`) |
| `src/pwa/` | Appli installable : service worker pour jouer sans connexion (`sw.js`), proposition d'installation de Chrome (`index.ts`) |
| `tests/` | Tests du moteur (`npm test`) : `game.test.ts`, `modes.test.ts` (modes de jeu, sauvegardes, reprise d'une vraie partie de la version 1 gardée dans `fixtures/`). Avec `CALIB=1 npm test`, `calibration.test.ts` et `campaign.calib.test.ts` affichent des parties simulées pour régler l'équilibre économique et la durée des échelons |
| `public/geo/` | Données géographiques servies telles quelles (contours des pays, lumières des villes) |
| `data/` | Données réelles du jeu (aéroports, trafic, lignes, avions), préparées à part |

Règle simple : tout ce qui dépend du temps lit `clock.now()` (jamais `Date.now()`), pour
que l'accélération du temps s'applique partout.

Le moteur (`src/game/`) ne touche jamais au DOM : l'interface appelle ses actions
(`game.run(action, …)`), qui renvoient un message d'erreur en français ou modifient la partie.
Les vols du joueur sont donnés au calque des avions par `playerFlights()` (`src/game/flights.ts`).

L'interface est écrite sans bibliothèque (HTML et CSS à la main). Son style « vol de nuit »
(couleurs, polices, tailles) tient dans les variables CSS de `src/style.css`.

## Sources et licences

- Images satellite : [Sentinel-2 cloudless 2020](https://s2maps.eu) par [EOX IT Services GmbH](https://eox.at)
  (contient des données Copernicus Sentinel modifiées, 2020), licence
  [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) : usage non commercial,
  avec mention de la source (affichée sur la carte).
- Frontières, routes et noms : [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org),
  données © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- Lumières nocturnes : NASA Earth Observatory / GIBS, *Black Marble* VIIRS 2016 (domaine public), image mondiale puis tuiles détaillées selon le zoom.
- Contours des pays : [Natural Earth](https://www.naturalearthdata.com) (domaine public),
  noms français repris du projet simulateur-mss.
- Trafic aérien : [Standing Data](https://github.com/vradarserver/standing-data) de Virtual Radar Server (CC0),
  [OpenFlights](https://openflights.org/data) (ODbL), [Jonty/airline-route-data](https://github.com/Jonty/airline-route-data).
- Polices : [Barlow et Barlow Condensed](https://github.com/jpt/barlow) (Jeremy Tribby) et
  [B612 Mono](https://b612-font.com) (Airbus, ENAC, Intactile Design), sous licence SIL Open Font
  License 1.1, installées avec le jeu par les paquets `@fontsource`.
- Icônes : dessinées pour le jeu (`src/ui/icons.ts`).
- Moteur de carte : [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause).
