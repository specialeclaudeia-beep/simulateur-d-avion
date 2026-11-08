/**
 * Chargement des données réelles utiles aux avions : aéroports, compagnies,
 * modèles d'avions et trafic quotidien (data/*.json, voir data/README.md).
 *
 * Les fichiers sont copiés tels quels par Vite (`?url`) et téléchargés en
 * arrière-plan, pour ne pas retarder l'affichage de la carte.
 */
import airportsUrl from '../../data/airports.json?url';
import airlinesUrl from '../../data/airlines.json?url';
import aircraftUrl from '../../data/aircraft.json?url';
import manufacturersUrl from '../../data/manufacturers.json?url';
import trafficUrl from '../../data/traffic.json?url';

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  tier: number;
  pax: number;
}

export interface Airline {
  iata: string;
  name: string;
  country: string;
  logo: string | null;
}

export interface AircraftModel {
  id: string;
  mfr: string;
  name: string;
  family: string;
  kind: 'pax' | 'cargo';
  category: 'regional_turboprop' | 'regional_jet' | 'narrowbody' | 'widebody' | 'jumbo';
  seats?: number;
  seatsMax?: number;
  cargoT?: number;
  rangeKm: number;
  cruiseKmh: number;
  lengthM: number;
  wingspanM: number;
}

export interface Manufacturer {
  id: string;
  name: string;
}

/** Vol régulier : [numéro, départ, arrivée, modèle, jours ?] (jours : masque 7 bits, lundi = bit 0). */
export type TrafficRow = [string, string, string, string, number?];

export interface TrafficAirline {
  color: string;
  cargo: boolean;
  fleet: Record<string, number>;
  flights: TrafficRow[];
}

export interface Traffic {
  generated: string;
  flightsPerDay: number;
  airlines: Record<string, TrafficAirline>;
}

export interface WorldData {
  airports: Map<string, Airport>;
  airlines: Map<string, Airline>;
  aircraft: Map<string, AircraftModel>;
  manufacturers: Map<string, Manufacturer>;
  traffic: Traffic;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return (await res.json()) as T;
}

let cache: Promise<WorldData> | null = null;

/** Charge (une seule fois) toutes les données utiles aux vols. */
export function loadWorldData(): Promise<WorldData> {
  cache ??= (async () => {
    const [airports, airlines, aircraft, manufacturers, traffic] = await Promise.all([
      getJson<Airport[]>(airportsUrl),
      getJson<Airline[]>(airlinesUrl),
      getJson<AircraftModel[]>(aircraftUrl),
      getJson<Manufacturer[]>(manufacturersUrl),
      getJson<Traffic>(trafficUrl),
    ]);
    return {
      airports: new Map(airports.map((a) => [a.iata, a])),
      airlines: new Map(airlines.map((a) => [a.iata, a])),
      aircraft: new Map(aircraft.map((a) => [a.id, a])),
      manufacturers: new Map(manufacturers.map((m) => [m.id, m])),
      traffic,
    };
  })();
  return cache;
}
