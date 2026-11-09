/**
 * Trafic aérien réel : les vols réguliers des vraies compagnies (data/traffic.json),
 * rejoués chaque jour selon l'horloge du jeu.
 *
 * Chaque vol a un horaire fixe (même heure tous les jours où il est programmé),
 * tiré de façon stable à partir de son numéro : surtout en journée, heure locale
 * de l'aéroport de départ, avec des départs en soirée pour les long-courriers.
 * La durée dépend de la distance et de la vitesse de croisière du modèle.
 *
 * Pour rester fluide avec ~100 000 vols par jour, tout est rangé dans des
 * tableaux typés ; un objet `Flight` complet n'est créé que pour l'avion touché.
 */
import type { Flight } from './types';
import type { WorldData } from './data';
import { angleBetween, EARTH_KM, lateralOffset, toVec } from './geo';

const DAY = 86_400_000;
const MIN = 60_000;

/** Hachage 32 bits stable (FNV-1a). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Heure locale de départ (minutes après minuit), surtout en journée, avec des
 * vagues le matin et en fin d'après-midi comme dans les vrais aéroports.
 */
function localDepartureMinutes(r: number, longHaul: boolean): number {
  // Poids par heure locale (0 h → 23 h).
  const W = longHaul ? LONG_HAUL_WAVES : SHORT_HAUL_WAVES;
  let x = r * W.total;
  for (let hr = 0; hr < 24; hr++) {
    x -= W.w[hr];
    if (x <= 0) return hr * 60 + Math.floor(((-x / W.w[hr]) % 1) * 60);
  }
  return 12 * 60;
}

function waves(w: number[]): { w: number[]; total: number } {
  return { w, total: w.reduce((a, b) => a + b, 0) };
}
// prettier-ignore
const SHORT_HAUL_WAVES = waves([0.2, 0.1, 0.05, 0.05, 0.1, 0.6, 2.2, 3, 2.6, 2.2, 2, 2, 2, 2, 2.1, 2.3, 2.6, 2.8, 2.6, 2.3, 1.9, 1.4, 0.8, 0.4]);
// prettier-ignore
const LONG_HAUL_WAVES = waves([0.6, 0.6, 0.3, 0.1, 0.1, 0.2, 0.5, 0.9, 1.2, 1.4, 1.6, 1.6, 1.5, 1.5, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.4, 2.3, 2, 1.4]);

export class RealTraffic {
  readonly count: number;
  /** Nombre de vols (avec leurs jours) par semaine / 7 : moyenne quotidienne. */
  readonly perDay: number;

  // Données par vol (index i).
  readonly airline: Uint16Array;
  readonly from: Uint16Array;
  readonly to: Uint16Array;
  readonly model: Uint8Array;
  readonly days: Uint8Array;
  /** Heure de décollage en minutes après minuit UTC. */
  readonly depMin: Uint16Array;
  /** Durée du vol en minutes (décollage → atterrissage). */
  readonly durMin: Uint16Array;
  /** Angle du grand cercle (radians), pour l'interpolation. */
  readonly omega: Float32Array;
  /** Graine stable du vol (remplissage, rang d'affichage…). */
  readonly seed: Uint32Array;
  readonly numbers: string[];

  // Tables d'index.
  readonly airlineCodes: string[];
  readonly airlineColors: string[];
  readonly airlineCargo: boolean[];
  readonly airportCodes: string[];
  /** Position 3D unitaire de chaque aéroport (x, y, z), et lon/lat. */
  readonly airportVec: Float64Array;
  readonly airportLonLat: Float64Array;
  readonly modelIds: string[];

  private maxDurMs = 0;

  constructor(private world: WorldData) {
    const t = world.traffic;
    this.airlineCodes = Object.keys(t.airlines);
    this.airlineColors = this.airlineCodes.map((c) => t.airlines[c].color);
    this.airlineCargo = this.airlineCodes.map((c) => t.airlines[c].cargo);

    const apIndex = new Map<string, number>();
    const modelIndex = new Map<string, number>();
    this.airportCodes = [];
    this.modelIds = [];
    let n = 0;
    for (const c of this.airlineCodes) {
      for (const row of t.airlines[c].flights) {
        for (const code of [row[1], row[2]]) {
          if (!apIndex.has(code) && world.airports.has(code)) {
            apIndex.set(code, this.airportCodes.length);
            this.airportCodes.push(code);
          }
        }
        if (!modelIndex.has(row[3])) {
          modelIndex.set(row[3], this.modelIds.length);
          this.modelIds.push(row[3]);
        }
        n++;
      }
    }

    this.airportVec = new Float64Array(this.airportCodes.length * 3);
    this.airportLonLat = new Float64Array(this.airportCodes.length * 2);
    this.airportCodes.forEach((code, i) => {
      const a = world.airports.get(code)!;
      const v = toVec(a.lon, a.lat);
      this.airportVec.set([v.x, v.y, v.z], i * 3);
      this.airportLonLat.set([a.lon, a.lat], i * 2);
    });

    this.airline = new Uint16Array(n);
    this.from = new Uint16Array(n);
    this.to = new Uint16Array(n);
    this.model = new Uint8Array(n);
    this.days = new Uint8Array(n);
    this.depMin = new Uint16Array(n);
    this.durMin = new Uint16Array(n);
    this.omega = new Float32Array(n);
    this.seed = new Uint32Array(n);
    this.numbers = new Array<string>(n);

    let i = 0;
    let weekly = 0;
    this.airlineCodes.forEach((code, ai) => {
      for (const [num, a, b, m, mask] of t.airlines[code].flights) {
        const ia = apIndex.get(a);
        const ib = apIndex.get(b);
        const model = world.aircraft.get(m);
        if (ia === undefined || ib === undefined || !model) continue;
        const va = { x: this.airportVec[ia * 3], y: this.airportVec[ia * 3 + 1], z: this.airportVec[ia * 3 + 2] };
        const vb = { x: this.airportVec[ib * 3], y: this.airportVec[ib * 3 + 1], z: this.airportVec[ib * 3 + 2] };
        const omega = angleBetween(va, vb);
        const km = omega * EARTH_KM;
        // Vitesse moyenne ~88 % de la croisière (montée, descente) + 12 min de manœuvres en l'air.
        const dur = Math.round(12 + (km / (model.cruiseKmh * 0.88)) * 60);
        const seed = hash32(`${code}${num}${a}${b}`);
        const lonA = this.airportLonLat[ia * 2];
        const local = localDepartureMinutes(rnd(seed, 1), km > 4500);
        const utc = (((local - Math.round(lonA * 4)) % 1440) + 1440) % 1440;

        this.airline[i] = ai;
        this.from[i] = ia;
        this.to[i] = ib;
        this.model[i] = modelIndex.get(m)!;
        this.days[i] = mask ?? 127;
        this.depMin[i] = utc;
        this.durMin[i] = Math.min(65535, dur);
        this.omega[i] = omega;
        this.seed[i] = seed;
        this.numbers[i] = num;
        this.maxDurMs = Math.max(this.maxDurMs, dur * MIN);
        weekly += popcount(this.days[i]);
        i++;
      }
    });
    this.count = i;
    this.perDay = Math.round(weekly / 7);
  }

  /**
   * Appelle `fn(i, depMs)` pour chaque vol en l'air à l'instant `t`
   * (décollé et pas encore posé).
   */
  forEachAirborne(t: number, fn: (i: number, depMs: number) => void): void {
    const today = Math.floor(t / DAY);
    for (let d = today - Math.ceil(this.maxDurMs / DAY); d <= today; d++) {
      const dayStart = d * DAY;
      // 1er janvier 1970 = jeudi ; lundi = bit 0.
      const weekday = (((d + 3) % 7) + 7) % 7;
      const bit = 1 << weekday;
      const since = t - dayStart;
      for (let i = 0; i < this.count; i++) {
        const dep = this.depMin[i] * MIN;
        if (dep > since) continue;
        if (since - dep >= this.durMin[i] * MIN) continue;
        if ((this.days[i] & bit) === 0) continue;
        fn(i, dayStart + dep);
      }
    }
  }

  /** Fraction du trajet effectuée (0 → 1). */
  progress(i: number, depMs: number, t: number): number {
    return Math.min(1, Math.max(0, (t - depMs) / (this.durMin[i] * MIN)));
  }

  /** Écart latéral de ce vol ce jour-là (stable). */
  lateral(i: number, depMs: number): number {
    return lateralOffset(rnd(this.seed[i] ^ Math.floor(depMs / 60_000), 11), this.omega[i]);
  }

  /** Fiche complète d'un vol (créée seulement à la demande). */
  flight(i: number, depMs: number): Flight {
    const code = this.airlineCodes[this.airline[i]];
    const al = this.world.airlines.get(code);
    const model = this.world.aircraft.get(this.modelIds[this.model[i]])!;
    const seed = this.seed[i];
    const f: Flight = {
      id: `${code}${this.numbers[i]}-${this.airportCodes[this.from[i]]}-${depMs}`,
      airline: code,
      airlineName: al?.name ?? code,
      color: this.airlineColors[this.airline[i]],
      aircraftId: model.id,
      callsign: `${code} ${this.numbers[i]}`,
      from: this.airportCodes[this.from[i]],
      to: this.airportCodes[this.to[i]],
      depMs,
      arrMs: depMs + this.durMin[i] * MIN,
      lateral: this.lateral(i, depMs),
    };
    // Remplissage stable pour ce vol et ce jour : 60 à 98 % (moyenne mondiale ~83 %).
    const load = 0.6 + 0.38 * Math.sqrt(rnd(seed ^ Math.floor(depMs / DAY), 7));
    if (model.kind === 'cargo') {
      f.cargoMaxT = model.cargoT;
      f.cargoT = Math.round((model.cargoT ?? 0) * load * 10) / 10;
    } else {
      f.seats = model.seats;
      f.pax = Math.round((model.seats ?? 0) * load);
    }
    return f;
  }
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}
