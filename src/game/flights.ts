/**
 * Vols du joueur pour la carte.
 *
 * Format commun avec le calque des avions (fil « avions qui volent ») : la
 * carte demande à chaque image la liste des vols en cours via un
 * « fournisseur » (provider). La position se calcule le long de l'arc de
 * grand cercle entre `from` et `to`, d'après l'horloge du jeu :
 *   progression = (clock.now() − depMs) / (arrMs − depMs).
 *
 * Branchement (dans main.ts, une fois le calque des avions disponible) :
 *   connectAircraftLayer(aircraftLayer, (ref) => ouvrirLaFicheAvion(ref));
 */
import type { GameData } from './data';
import { interpolate, bearing, type LonLat } from './geo';
import type { Aircraft, GameState } from './state';

/** Un vol en cours (même définition que src/flights/types.ts du calque des avions). */
export interface Flight {
  id: string;
  /** Code IATA de la compagnie (ou code choisi par le joueur). */
  airline: string;
  airlineName: string;
  /** Couleur #rrggbb. */
  color: string;
  /** Identifiant du modèle dans data/aircraft.json. */
  aircraftId: string;
  /** Numéro de vol, ex. « GW 102 ». */
  callsign: string;
  from: string;
  to: string;
  /** Décollage et arrivée, en temps de jeu (ms). */
  depMs: number;
  arrMs: number;
  pax?: number;
  seats?: number;
  cargoT?: number;
  cargoMaxT?: number;
  player?: boolean;
  /** Immatriculation de l'avion (ex. F-GZQA). */
  registration?: string;
  /** Identifiant de l'avion dans la partie (pour ouvrir sa fiche). */
  ref?: string;
}

type StateSource = () => GameState | null;
let source: StateSource = () => null;

/** Indique où lire la partie en cours (appelé par le jeu au démarrage). */
export function setFlightSource(fn: StateSource): void {
  source = fn;
}

function toFlight(s: GameState, ac: Aircraft): Flight {
  const leg = ac.leg!;
  return {
    id: leg.id,
    airline: s.company.code,
    airlineName: s.company.name,
    color: s.company.color,
    aircraftId: ac.modelId,
    callsign: leg.callsign,
    from: leg.from,
    to: leg.to,
    depMs: leg.dep,
    arrMs: leg.arr,
    ...(leg.cargoMaxT > 0 ? { cargoT: leg.cargoT, cargoMaxT: leg.cargoMaxT } : { pax: leg.pax, seats: leg.seats }),
    player: true,
    registration: ac.registration,
    ref: ac.id,
  };
}

/** Vols du joueur en l'air à l'instant `nowMs` (le second paramètre, la zone visible, est ignoré : ils sont peu nombreux). */
export function playerFlights(nowMs: number, _bounds?: unknown): Flight[] {
  const s = source();
  if (!s) return [];
  const out: Flight[] = [];
  for (const ac of s.aircraft) {
    const leg = ac.leg;
    if (ac.status === 'flying' && leg && leg.dep <= nowMs && nowMs < leg.arr) out.push(toFlight(s, ac));
  }
  return out;
}

export interface FlightPosition extends LonLat {
  /** Cap en degrés (0 = nord). */
  heading: number;
  /** Avancement du vol entre 0 et 1. */
  progress: number;
}

/** Position d'un vol à l'instant `nowMs` (utile pour centrer la carte sur un avion). */
export function flightPosition(data: GameData, f: Pick<Flight, 'from' | 'to' | 'depMs' | 'arrMs'>, nowMs: number): FlightPosition | null {
  const a = data.airportByIata.get(f.from);
  const b = data.airportByIata.get(f.to);
  if (!a || !b) return null;
  const progress = Math.min(1, Math.max(0, (nowMs - f.depMs) / (f.arrMs - f.depMs)));
  const p = interpolate(a, b, progress);
  const ahead = interpolate(a, b, Math.min(1, progress + 0.01));
  return { ...p, heading: progress >= 1 ? bearing(a, b) : bearing(p, ahead), progress };
}

/** Forme minimale du calque des avions dont on a besoin. */
export interface AircraftLayerLike {
  addProvider(fn: (nowMs: number, bounds?: unknown) => Flight[]): void;
  onSelect?(fn: (flight: Flight | null) => void): void;
}

/** Affiche les vols du joueur sur le calque des avions et ouvre la fiche d'un avion touché. */
export function connectAircraftLayer(layer: AircraftLayerLike, openAircraft: (ref: string) => void): void {
  layer.addProvider(playerFlights);
  layer.onSelect?.((f) => {
    if (f?.player && f.ref) openAircraft(f.ref);
  });
}
