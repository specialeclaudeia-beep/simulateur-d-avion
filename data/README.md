# Données réelles du jeu

Ce dossier contient les données du simulateur de compagnie aérienne, au format JSON compact
(UTF-8, une seule ligne par fichier). Elles sont **générées** par les scripts de
`scripts/data/` : ne pas les modifier à la main, sauf les fiches avions et constructeurs qui
se modifient dans `scripts/data/curated/`.

| Fichier | Contenu | Taille |
|---|---|---|
| `airports.json` | 4 038 aéroports avec vols réguliers, trafic, classement, prix du hub | ~1,5 Mo |
| `routes.json` | 30 205 lignes régulières actuelles (paires d'aéroports) | ~1 Mo |
| `airlines.json` | 603 compagnies qui opèrent ces lignes | ~100 Ko |
| `countries.json` | 249 pays et territoires : fiscalité, population, PIB, nombre de hubs | ~50 Ko |
| `manufacturers.json` | 10 constructeurs réels (Airbus, Boeing, Embraer, ATR, De Havilland Canada, COMAC, UAC, plus Bombardier, Saab et Beechcraft pour l'occasion) | 3 Ko |
| `aircraft.json` | 71 modèles d'avions (passagers et cargo), neufs et d'occasion | 22 Ko |
| `traffic.json` | trafic réel quotidien : ~100 000 vols par jour avec numéro de vol, modèle d'avion, couleur et flotte de chaque compagnie | ~4,6 Mo (1 Mo compressé) |
| `meta.json` | date de génération, compteurs, formules utilisées | 1 Ko |

Conseil côté jeu : charger `countries`, `manufacturers`, `aircraft` et `meta` au démarrage, puis
`airports` et `routes` en arrière-plan (ils sont gros mais se compressent très bien en gzip,
environ 5 fois moins).

## Régénérer les données

```bash
pip install pandas lxml                  # seulement pour lire les tableaux Wikipédia
python3 scripts/data/fetch.py            # télécharge les sources dans scripts/data/.cache/ (non versionné)
python3 scripts/data/build.py            # écrit data/*.json
python3 scripts/data/fetch_traffic.py    # vols et immatriculations réels (~20 Mo, quelques minutes)
python3 scripts/data/build_traffic.py    # écrit data/traffic.json (et recopie les fiches avions)
```

`fetch.py --force` retélécharge tout. Les lignes aériennes sont mises à jour chaque semaine à
la source, il suffit de relancer les deux scripts pour avoir le réseau du moment. Wikidata
limite parfois à une requête par minute : le script attend et réessaie tout seul.

## Format des fichiers

### `airports.json` — tableau trié du plus grand au plus petit trafic

```json
{"iata":"CDG","icao":"LFPG","name":"Charles De Gaulle","city":"Paris","country":"FR",
 "lat":49.0032,"lon":2.56702,"elev":387,"tz":"Europe/Paris","type":"large",
 "runways":5,"runwayM":4215,"pax":72029407,"paxYear":2025,"paxSrc":"aci",
 "routes":286,"tier":5,"gates":120,"price":361000000,
 "wiki":"https://en.wikipedia.org/wiki/Charles_de_Gaulle_Airport","rank":14,"rankCountry":1}
```

| Champ | Sens |
|---|---|
| `iata`, `icao` | codes de l'aéroport (`iata` sert d'identifiant partout) |
| `country` | code pays ISO 3166-1 alpha-2 (lien vers `countries.json`) |
| `lat`, `lon`, `elev` | position (degrés) et altitude (pieds) |
| `tz` | fuseau horaire IANA (utile pour les horaires et le jour/nuit) |
| `type` | `large`, `medium`, `small` selon OurAirports |
| `runways`, `runwayM` | nombre de pistes ouvertes et longueur de la plus longue (mètres) : un avion ne peut s'y poser que si `runwayM >= aircraft.runwayM` |
| `pax`, `paxYear` | passagers annuels et année du chiffre (`null` si estimé) |
| `paxSrc` | `aci` (classement mondial ACI via Wikipédia), `wikipedia` (classements régionaux), `wikidata`, ou `estimation` |
| `routes` | nombre de destinations régulières au départ |
| `tier` | taille : 5 méga-hub (≥ 30 M), 4 hub international (≥ 10 M), 3 grand aéroport (≥ 3 M), 2 régional (≥ 0,5 M), 1 local |
| `gates` | nombre de portes estimé : `max(2, passagers / 600 000)` |
| `price` | prix d'achat du hub en USD (voir plus bas) |
| `rank`, `rankCountry` | classement mondial et dans le pays, selon `pax` |

### `routes.json` — tableau de lignes `[a, b, km, minutes, sens, compagnies]`

```json
["CDG","NCE",692,95,0,["AF","KU","U2"]]
```

- `a`, `b` : codes IATA, toujours dans l'ordre alphabétique (chaque paire n'apparaît qu'une fois).
- `km` : distance ; `minutes` : durée de vol programmée.
- `sens` : `0` = dans les deux sens, `1` = seulement de `a` vers `b`, `2` = seulement de `b` vers `a`.
- `compagnies` : codes IATA des compagnies qui l'opèrent aujourd'hui (lien vers `airlines.json`).

Pour tracer les avions sur la carte, la trajectoire est l'arc de grand cercle entre les deux
aéroports (c'est ce que suivent réellement les vols long-courriers, à quelques détours près).

### `airlines.json`

```json
{"iata":"AF","name":"Air France","icao":"AFR","callsign":"AIRFRANS","country":"FR",
 "hub":"CDG","routes":409,"logo":"https://commons.wikimedia.org/wiki/Special:FilePath/Air%20France%20Logo.svg"}
```

`hub` est l'aéroport d'où la compagnie a le plus de lignes, `routes` son nombre de lignes au
départ. `logo` vient de Wikimedia Commons (322 compagnies sur 603) ; s'il est `null`, utiliser
`meta.logoFallback` en remplaçant `{iata}` (petites images PNG de pics.avs.io).

### `countries.json`

```json
{"code":"FR","name":"France","nameEn":"France","continent":"EU","corporateTax":25.0,"vat":20.0,
 "population":68720337,"gdpPerCapita":48986,"airports":55,"hubs":10,"pax":199688378,"topAirport":"CDG"}
```

- `corporateTax` : impôt sur les sociétés (%), `vat` : TVA ou taxe sur les ventes (%). Taux
  principal, simplifié (quand Wikipédia donne une fourchette, on prend le haut). C'est une
  approximation suffisante pour un jeu, pas une donnée fiscale exacte.
- `population`, `gdpPerCapita` (USD) : Banque mondiale, dernière année disponible.
- `airports` : aéroports avec vols réguliers ; `hubs` : ceux de niveau 3 ou plus ; `pax` : trafic cumulé.

### `manufacturers.json`

`id`, `name`, `country`, `hq`, `founded`, `website`, `logo` (Wikimedia Commons ; `null` pour De
Havilland Canada qui n'en a pas sur Wikidata), plus deux réglages de jeu pour les contrats :
`contractDiscount` (fourchette de remise sur le prix catalogue, les compagnies réelles paient
souvent 40 à 60 % de moins que le catalogue) et `deliveryMonths` (délai de livraison min-max).

### `aircraft.json`

```json
{"id":"a320neo","mfr":"airbus","name":"A320neo","family":"A320","kind":"pax","category":"narrowbody",
 "seats":165,"seatsMax":194,"rangeKm":6300,"cruiseKmh":833,"runwayM":2100,"lengthM":37.6,
 "wingspanM":35.8,"fuelKgH":2200,"priceUsd":110600000,"priceYear":2018,"priceSource":"catalogue",
 "eis":2016,"inProduction":true}
```

- `kind` : `pax` ou `cargo` (les cargos ont `cargoT`, la charge utile en tonnes, à la place des sièges).
- `category` : `regional_turboprop`, `regional_jet`, `narrowbody`, `widebody`, `jumbo` (utile pour
  la taille de l'icône sur la carte, avec `wingspanM`).
- `family` : qualification de type ; un pilote formé sur une famille peut piloter tous ses modèles.
- `seats` : configuration typique 2 classes ; `seatsMax` : maximum certifié.
- `fuelKgH` : consommation moyenne approximative en croisière.
- `priceUsd` : prix catalogue. `priceSource` = `catalogue` quand c'est le prix publié par le
  constructeur (Airbus 2018, Boeing 2019, leurs dernières grilles publiques), `estimation`
  sinon (Embraer, ATR, De Havilland, COMAC, UAC et modèles récents ne publient pas de prix).
- `eis` : année de mise en service ; `inProduction: false` = plus fabriqué neuf (occasion seulement).
  Pour ces modèles, `priceSource` vaut `occasion` et `priceUsd` est la valeur approximative d'un
  exemplaire en milieu de vie. Ce sont les avions les plus nombreux dans le ciel aujourd'hui
  (737-800 : ~4 500 en service, A320ceo : ~3 600 selon l'IATA), d'où leur présence.
- Les constructeurs `usedOnly: true` (Bombardier, Saab, Beechcraft) ne vendent plus d'avions neufs :
  pas de contrat possible, seulement le marché de l'occasion.

### `traffic.json` — le trafic réel qui vole sur la carte

```json
{"flightsPerDay":99894,"airlines":{"AF":{"color":"#002157","cargo":false,
  "fleet":{"a220-300":57,"a350-900":29},
  "flights":[["384","ABJ","CDG","a350-900",93],["1234","CDG","NCE","a220-300"],...]}}}
```

- `color` : couleur principale de la livrée (`scripts/data/curated/airline_colors.json`, ~200
  compagnies) ou couleur stable calculée depuis le code pour les autres.
- `fleet` : avions de la compagnie repérés dans la base d'immatriculations, par modèle du jeu.
  C'est un échantillon (la base ne couvre pas tous les pays), pas la flotte complète.
- `flights` : un vol régulier par ligne `[numéro, départ, arrivée, modèle, jours]`. Le vol a lieu
  chaque jour, sauf si `jours` est présent : masque de 7 bits (lundi = bit 0, dimanche = bit 6).
- L'heure de départ n'est pas dans le fichier : le jeu la tire de façon stable à partir du numéro
  (surtout en journée, heure locale ; vagues du matin et du soir), et calcule la durée avec la
  distance et la vitesse de croisière du modèle (`src/flights/realTraffic.ts`).

Comment il est construit (`scripts/data/build_traffic.py`) :

1. **Vrais numéros de vol** : base Standing Data de Virtual Radar Server (alimentée par les
   récepteurs ADS-B des passionnés), qui associe chaque indicatif radio (ex. `AFR1234`) aux aéroports
   desservis. On ne garde que les vols qui correspondent à une ligne actuelle de `routes.json`.
2. **Vraies flottes** : immatriculations de la même base (type OACI + compagnie), traduites en
   modèles du jeu ; à défaut, les équipements par ligne d'OpenFlights (2014) remis à jour avec la
   même catégorie d'avion.
3. **Fréquences** : la base cumule les numéros de plusieurs saisons, elle ne dit donc pas combien
   de vols ont lieu chaque jour. La fréquence d'une ligne vient d'un modèle de gravité (trafic des
   deux aéroports, distance, long-courriers moins fréquents), partagée entre les compagnies selon
   leurs numéros connus et leur base, puis recalée pour que le total mondial fasse ~100 000 vols par
   jour (IATA : ~38 millions de vols par an). Les long-courriers font ~8 % des vols, comme en réalité.
4. **Modèle par vol** : dans la flotte de la compagnie, un avion qui a l'autonomie et la piste
   nécessaires, de préférence de la bonne taille pour la distance.


## Règles de calcul

**Trafic passagers.** Par ordre de priorité : classement mondial ACI (Wikipédia, année ≥ 2023),
classements régionaux Wikipédia 2025 (Europe, Asie, Afrique, Amérique latine, Chine, Inde),
puis Wikidata (dernière année ≥ 2023, sinon 2019 pour éviter les années Covid). Pour les
1 189 aéroports sans chiffre fiable, le trafic est estimé à partir de leur activité réelle
(nombre de couples ligne × compagnie au départ) avec une loi ajustée sur les aéroports connus :
`pax = exp(a + b × ln(activité))`, coefficients dans `meta.json`. Un chiffre Wikidata plus de
25 fois éloigné de l'estimation est rejeté (souvent un ancien aéroport qui partage le même code).

**Prix d'un hub** (USD) :
`(2 000 000 + 3,5 × passagers annuels) × coefficient pays`, où le coefficient pays vaut
`(PIB par habitant / 12 000)^0,25`, borné entre 0,6 et 1,6, puis arrondi. Exemples : Atlanta
≈ 598 M$, Paris-CDG ≈ 361 M$, Nantes ≈ 39 M$. Ces constantes sont dans `build.py` et peuvent
être ajustées pour l'équilibrage.

## Sources et licences

| Source | Utilisation | Licence |
|---|---|---|
| [OurAirports](https://ourairports.com/data/) | aéroports, pistes, pays | domaine public |
| [Jonty/airline-route-data](https://github.com/Jonty/airline-route-data) | lignes régulières actuelles et compagnies, mises à jour chaque semaine | données publiques, pas de licence déclarée |
| [OpenFlights](https://openflights.org/data) | code OACI, indicatif et pays des compagnies | ODbL |
| [Wikidata](https://www.wikidata.org) | trafic passagers (P3872), noms de pays en français, logos (P154) | CC0 |
| [Wikipédia](https://en.wikipedia.org/wiki/List_of_busiest_airports_by_passenger_traffic) | classements de trafic ACI et régionaux, fiscalité par pays | CC BY-SA |
| [Banque mondiale](https://data.worldbank.org) | population, PIB par habitant | CC BY 4.0 |
| Wikimedia Commons | logos des compagnies et constructeurs | marques déposées de leurs propriétaires |
| [Standing Data (Virtual Radar Server)](https://github.com/vradarserver/standing-data) | numéros de vol réels par ligne, immatriculations et types des avions de chaque compagnie | CC0 |
| [IATA, *The global commercial aircraft fleet*](https://www.iata.org/en/iata-repository/publications/economic-reports/the-global-commercial-aircraft-fleet/) | choix des modèles en service à ajouter, part des long-courriers | — |
| Fiches constructeurs (Airbus, Boeing, Embraer, ATR, De Havilland, COMAC, UAC) | caractéristiques et prix catalogue des avions, saisis à la main | — |

Le jeu n'est pas publié : les logos réels sont utilisés pour un usage personnel uniquement.

## Limites connues

- `routes.json` ne dit pas combien de vols par jour ni quels avions ; `traffic.json` les estime
  (voir plus haut). Les fréquences sont donc plausibles mais pas exactes (ex. Ryanair y fait ~6 000
  vols par jour contre ~3 300 en réalité, car il a énormément de petites lignes).
- Les horaires sont inventés (stables d'un jour à l'autre), pas les vrais horaires des compagnies.
- Certains noms d'aéroports de la source des lignes sont anciens (ex. `KTI` est le nouvel
  aéroport Techo de Phnom Penh mais garde le nom de Kratie).
- Les caractéristiques des avions (consommation, piste, prix estimés) sont arrondies ; elles
  donnent les bons ordres de grandeur, pas des valeurs de certification.
