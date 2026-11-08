/**
 * Vols du joueur pour la carte.
 *
 * Le calque des avions (src/map/aircraft.ts) demande régulièrement la liste des
 * vols en l'air à un « fournisseur » ; celui-ci renvoie ceux de la compagnie du
 * joueur au format commun `Flight` (src/flights/types.ts). La position se
 * calcule ensuite le long de l'arc de grand cercle d'après l'horloge du jeu.
 */
import type { Flight } from '../flights/types';
import type { Aircraft, GameState } from './state';

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
    // Pas le code à 2 lettres : il peut être celui d'une vraie compagnie (et afficher son logo).
    airline: 'player',
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

/** Vols du joueur en l'air à l'instant `nowMs`. */
export function playerFlights(nowMs: number): Flight[] {
  const s = source();
  if (!s) return [];
  const out: Flight[] = [];
  for (const ac of s.aircraft) {
    const leg = ac.leg;
    if (ac.status === 'flying' && leg && leg.dep <= nowMs && nowMs < leg.arr) out.push(toFlight(s, ac));
  }
  return out;
}
