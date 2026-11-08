/**
 * Données réelles du jeu (dossier data/, voir data/README.md).
 *
 * Les petits fichiers (pays, constructeurs, avions) sont inclus dans le code ;
 * les gros (aéroports, lignes, compagnies) sont téléchargés au démarrage.
 * On prépare ici les index (par code IATA, lignes par aéroport) et la demande
 * estimée de chaque ligne, calculée une seule fois.
 */
import countriesJson from '../../data/countries.json';
import manufacturersJson from '../../data/manufacturers.json';
import aircraftJson from '../../data/aircraft.json';
import metaJson from '../../data/meta.json';
import airportsUrl from '../../data/airports.json?url';
import routesUrl from '../../data/routes.json?url';
import airlinesUrl from '../../data/airlines.json?url';
import {
  DEMAND_AIRLINES_EXP,
  DEMAND_PAX_EXP,
  DEMAND_SCALE,
  FALLBACK_TAX,
  distanceFactor,
  wealthCoef,
} from './config';

// ───────────────────────── Types des fichiers ─────────────────────────

export type Tier = 1 | 2 | 3 | 4 | 5;

export interface Airport {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elev: number;
  tz: string | null;
  type: string;
  runways: number;
  runwayM: number | null;
  pax: number;
  paxYear: number | null;
  paxSrc: string;
  routes: number;
  tier: Tier;
  gates: number;
  price: number;
  wiki: string | null;
  rank: number;
  rankCountry: number;
}

export type RouteTuple = [string, string, number, number, 0 | 1 | 2, string[]];

export interface Airline {
  iata: string;
  name: string;
  icao: string | null;
  callsign: string | null;
  country: string;
  hub: string;
  routes: number;
  logo: string | null;
}

export interface Country {
  code: string;
  name: string;
  nameEn: string;
  continent: string;
  corporateTax: number | null;
  vat: number | null;
  population: number | null;
  gdpPerCapita: number | null;
  airports: number;
  hubs: number;
  pax: number;
  topAirport: string | null;
}

export interface Manufacturer {
  id: string;
  name: string;
  country: string;
  hq: string;
  founded: number;
  website: string;
  contractDiscount: [number, number];
  deliveryMonths: [number, number];
  logo: string | null;
}

export type AircraftCategory = 'regional_turboprop' | 'regional_jet' | 'narrowbody' | 'widebody' | 'jumbo';

export interface AircraftModel {
  id: string;
  mfr: string;
  name: string;
  family: string;
  kind: 'pax' | 'cargo';
  category: AircraftCategory;
  seats: number | null;
  seatsMax: number | null;
  cargoT?: number | null;
  rangeKm: number;
  cruiseKmh: number;
  runwayM: number;
  lengthM: number;
  wingspanM: number;
  fuelKgH: number;
  priceUsd: number;
  priceYear: number;
  priceSource: string;
  eis: number;
  inProduction: boolean;
}

export interface Meta {
  generated: string;
  tiers: { min: number; level: number; label: string }[];
  logoFallback: string;
}

/** Une ligne réelle, avec sa demande estimée. */
export interface Route {
  a: string;
  b: string;
  km: number;
  minutes: number;
  airlines: string[];
  /** Passagers par jour et par sens, tous transporteurs confondus. */
  demand: number;
}

// ───────────────────────── Libellés ─────────────────────────

export const TIER_LABEL: Record<Tier, string> = {
  5: 'Méga-hub',
  4: 'Hub international',
  3: 'Grand aéroport',
  2: 'Aéroport régional',
  1: 'Aéroport local',
};

export const CATEGORY_LABEL: Record<AircraftCategory, string> = {
  regional_turboprop: 'Turbopropulseur régional',
  regional_jet: 'Jet régional',
  narrowbody: 'Moyen-courrier',
  widebody: 'Gros-porteur',
  jumbo: 'Très gros-porteur',
};

/** Longueur de piste supposée quand la source ne la donne pas (selon la taille de l'aéroport). */
const RUNWAY_FALLBACK = [0, 1800, 2400, 2800, 3200, 3500];

/** Plus courte distance acceptée pour une ligne (quelques lignes de la source font 0 km). */
const MIN_ROUTE_KM = 50;

// ───────────────────────── Données chargées ─────────────────────────

export class GameData {
  readonly airportByIata = new Map<string, Airport>();
  readonly routesByAirport = new Map<string, Route[]>();
  readonly routeByKey = new Map<string, Route>();
  readonly airlineByCode = new Map<string, Airline>();
  readonly countryByCode = new Map<string, Country>();
  readonly manufacturerById = new Map<string, Manufacturer>();
  readonly modelById = new Map<string, AircraftModel>();
  /** Familles d'avions (qualification de type des pilotes). */
  readonly families = new Map<string, { name: string; large: boolean; models: AircraftModel[] }>();
  private readonly coefCache = new Map<string, number>();

  constructor(
    readonly airports: Airport[],
    routeTuples: RouteTuple[],
    readonly airlines: Airline[],
    readonly countries: Country[],
    readonly manufacturers: Manufacturer[],
    readonly models: AircraftModel[],
    readonly meta: Meta,
  ) {
    for (const a of airports) this.airportByIata.set(a.iata, a);
    for (const al of airlines) this.airlineByCode.set(al.iata, al);
    for (const c of countries) this.countryByCode.set(c.code, c);
    for (const m of manufacturers) this.manufacturerById.set(m.id, m);
    for (const m of models) {
      this.modelById.set(m.id, m);
      const fam = this.families.get(m.family) ?? { name: m.family, large: false, models: [] };
      fam.models.push(m);
      fam.large ||= m.category === 'widebody' || m.category === 'jumbo';
      this.families.set(m.family, fam);
    }
    this.buildRoutes(routeTuples);
  }

  // ── Aéroports ──

  airport(iata: string): Airport {
    const a = this.airportByIata.get(iata);
    if (!a) throw new Error(`Aéroport inconnu : ${iata}`);
    return a;
  }

  runwayOf(a: Airport): number {
    return a.runwayM ?? RUNWAY_FALLBACK[a.tier];
  }

  /** Aéroports d'un pays qui ont au moins une ligne (classés du plus grand au plus petit). */
  airportsOfCountry(code: string): Airport[] {
    return this.airports.filter((a) => a.country === code && this.routesByAirport.has(a.iata));
  }

  // ── Pays ──

  country(code: string): Country | undefined {
    return this.countryByCode.get(code);
  }

  /** Coefficient de richesse d'un pays (billets, salaires, redevances). */
  coef(countryCode: string): number {
    let c = this.coefCache.get(countryCode);
    if (c === undefined) {
      c = wealthCoef(this.countryByCode.get(countryCode)?.gdpPerCapita);
      this.coefCache.set(countryCode, c);
    }
    return c;
  }

  corporateTax(countryCode: string): number {
    return this.countryByCode.get(countryCode)?.corporateTax ?? FALLBACK_TAX;
  }

  vat(countryCode: string): number {
    return this.countryByCode.get(countryCode)?.vat ?? 0;
  }

  /** Pays où l'on peut installer sa compagnie : au moins un aéroport avec des lignes. */
  playableCountries(): Country[] {
    const withAirports = new Set<string>();
    for (const a of this.airports) if (this.routesByAirport.has(a.iata)) withAirports.add(a.country);
    return this.countries
      .filter((c) => withAirports.has(c.code))
      .sort((x, y) => x.name.localeCompare(y.name, 'fr'));
  }

  // ── Lignes ──

  static routeKey(a: string, b: string): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  route(a: string, b: string): Route | undefined {
    return this.routeByKey.get(GameData.routeKey(a, b));
  }

  routesFrom(iata: string): Route[] {
    return this.routesByAirport.get(iata) ?? [];
  }

  /** Nom lisible d'une compagnie réelle (code IATA sinon). */
  airlineName(code: string): string {
    return this.airlineByCode.get(code)?.name ?? code;
  }

  // ── Avions ──

  model(id: string): AircraftModel {
    const m = this.modelById.get(id);
    if (!m) throw new Error(`Modèle d'avion inconnu : ${id}`);
    return m;
  }

  /**
   * Prépare les lignes et estime leur demande (modèle gravitaire) :
   * les passagers au départ d'un aéroport (trafic annuel / 2 / 365) se
   * répartissent entre ses destinations selon le trafic de la destination,
   * la distance et le nombre de compagnies qui y volent déjà (signe d'une
   * ligne fréquentée). La demande d'une ligne est la moyenne des deux sens.
   */
  private buildRoutes(tuples: RouteTuple[]): void {
    const kept: { r: Route; nf: number; df: number }[] = [];
    const weightSum = new Map<string, number>();
    const addWeight = (iata: string, w: number) => weightSum.set(iata, (weightSum.get(iata) ?? 0) + w);

    for (const [a, b, km, minutes, , airlines] of tuples) {
      const A = this.airportByIata.get(a);
      const B = this.airportByIata.get(b);
      if (!A || !B || km < MIN_ROUTE_KM) continue;
      const r: Route = { a, b, km, minutes, airlines, demand: 0 };
      const nf = (1 + airlines.length) ** DEMAND_AIRLINES_EXP;
      const df = distanceFactor(km);
      kept.push({ r, nf, df });
      addWeight(a, B.pax ** DEMAND_PAX_EXP * df * nf);
      addWeight(b, A.pax ** DEMAND_PAX_EXP * df * nf);
    }

    for (const { r, nf, df } of kept) {
      const A = this.airportByIata.get(r.a)!;
      const B = this.airportByIata.get(r.b)!;
      const fromA = ((A.pax / 730) * (B.pax ** DEMAND_PAX_EXP * df * nf)) / weightSum.get(r.a)!;
      const fromB = ((B.pax / 730) * (A.pax ** DEMAND_PAX_EXP * df * nf)) / weightSum.get(r.b)!;
      r.demand = ((fromA + fromB) / 2) * DEMAND_SCALE;
      this.routeByKey.set(GameData.routeKey(r.a, r.b), r);
      for (const iata of [r.a, r.b]) {
        const list = this.routesByAirport.get(iata);
        if (list) list.push(r);
        else this.routesByAirport.set(iata, [r]);
      }
    }
  }
}

// ───────────────────────── Chargement ─────────────────────────

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Données « ${label} » indisponibles (${res.status})`);
  return (await res.json()) as T;
}

let loading: Promise<GameData> | null = null;

/** Charge toutes les données du jeu (une seule fois). */
export function loadGameData(): Promise<GameData> {
  loading ??= Promise.all([
    fetchJson<Airport[]>(airportsUrl, 'aéroports'),
    fetchJson<RouteTuple[]>(routesUrl, 'lignes'),
    fetchJson<Airline[]>(airlinesUrl, 'compagnies'),
  ]).then(
    ([airports, routes, airlines]) =>
      new GameData(
        airports,
        routes,
        airlines,
        countriesJson as unknown as Country[],
        manufacturersJson as unknown as Manufacturer[],
        aircraftJson as unknown as AircraftModel[],
        metaJson as unknown as Meta,
      ),
  );
  loading.catch(() => (loading = null));
  return loading;
}

/** Version synchrone pour les tests (données déjà lues depuis le disque). */
export function createGameData(raw: {
  airports: Airport[];
  routes: RouteTuple[];
  airlines: Airline[];
}): GameData {
  return new GameData(
    raw.airports,
    raw.routes,
    raw.airlines,
    countriesJson as unknown as Country[],
    manufacturersJson as unknown as Manufacturer[],
    aircraftJson as unknown as AircraftModel[],
    metaJson as unknown as Meta,
  );
}
