/**
 * Format commun d'un vol, partagé entre le trafic réel (les autres compagnies)
 * et les vols du joueur (fil « mécaniques de jeu »).
 *
 * Tous les temps sont en temps de jeu (ms depuis 1970, comme `clock.now()`).
 */
export interface Flight {
  /** Identifiant unique et stable (sert à garder la sélection d'une image à l'autre). */
  id: string;
  /** Code IATA de la compagnie, ou identifiant de la compagnie du joueur. */
  airline: string;
  airlineName: string;
  /** Couleur de l'avion sur la carte (#rrggbb). */
  color: string;
  /** Identifiant d'un modèle de data/aircraft.json. */
  aircraftId: string;
  /** Numéro de vol affiché (ex. « AF 1234 »). */
  callsign: string;
  /** Codes IATA des aéroports de départ et d'arrivée. */
  from: string;
  to: string;
  /** Heure de décollage et d'atterrissage (temps de jeu, ms). */
  depMs: number;
  arrMs: number;
  /** Avion de passagers : passagers à bord / sièges. */
  pax?: number;
  seats?: number;
  /** Avion cargo : charge à bord / charge maximale (tonnes). */
  cargoT?: number;
  cargoMaxT?: number;
  /** Vol de la compagnie du joueur (mis en avant sur la carte). */
  player?: boolean;
  /** Immatriculation de l'avion (ex. F-GZQA), affichée dans la fiche. */
  registration?: string;
  /** Identifiant de l'avion dans l'état du jeu (vols du joueur). */
  ref?: string;
}

/**
 * Source de vols : renvoie les vols en l'air à l'instant `nowMs`.
 * Le jeu peut en enregistrer plusieurs (trafic réel, vols du joueur…).
 */
export type FlightProvider = (nowMs: number) => Iterable<Flight>;
