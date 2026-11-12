/**
 * Sécurité des vols : probabilité d'accident de chaque vol, d'après les vraies
 * statistiques, puis ajustée selon l'avion, le pilote et l'entretien.
 *
 * Sources (taux de « perte de coque » = avion détruit, par million de vols) :
 * - Boeing, Statistical Summary of Commercial Jet Airplane Accidents 2025
 *   (flotte mondiale de jets, 1959-2025, taux par type d'avion) ;
 * - pour les avions qu'il ne couvre pas (turbopropulseurs, ERJ, Superjet…),
 *   ordres de grandeur IATA / Aviation Safety Network, notés « estimation ».
 * Un type sans aucun accident (787, A380, A220…) garde un plancher de
 * 0,1 par million : zéro accident observé ne veut pas dire zéro risque.
 *
 * Le tirage se fait au décollage : on sait alors si le vol finira mal, à
 * quelle phase et à quel moment, pour que l'avion s'écrase là où il est sur
 * la carte.
 */
import type { AircraftModel, GameData } from './data';
import { ageYears } from './economy';
import type { Aircraft, CrashPhase, Pilot } from './state';

/** Avions détruits par million de vols, par modèle (Boeing 2025 sauf mention). */
const HULL_LOSS_PER_M: Record<string, number> = {
  // Airbus
  'a220-100': 0.1, // 0,00 observé → plancher
  'a220-300': 0.1,
  'a300-600f': 0.91,
  a319ceo: 0.17,
  a320ceo: 0.17,
  a321ceo: 0.17,
  a321p2f: 0.17,
  a319neo: 0.1, // 0,04 observé, peu de vols → plancher
  a320neo: 0.1,
  a321neo: 0.1,
  a321xlr: 0.1,
  'a330-200': 0.36,
  'a330-300': 0.36,
  'a330-200f': 0.36,
  'a330-800': 0.1,
  'a330-900': 0.1,
  'a340-300': 0.56,
  'a340-600': 0.56,
  'a350-900': 0.46,
  'a350-1000': 0.46,
  a350f: 0.46,
  a380: 0.1,
  // Boeing
  b717: 0.1,
  'b737-700': 0.16,
  'b737-800': 0.16,
  'b737-900er': 0.16,
  'b737-800bcf': 0.16,
  'b737-7': 0.27, // 737 MAX
  'b737-8': 0.27,
  'b737-9': 0.27,
  'b737-10': 0.27,
  'b747-400': 1.17,
  'b747-400f': 1.17,
  'b747-8i': 0.1,
  'b747-8f': 0.1,
  'b757-200': 0.28,
  'b757-200f': 0.28,
  'b767-300er': 0.55,
  'b767-300f': 0.55,
  'b777-200er': 0.36,
  'b777-300er': 0.36,
  b777f: 0.36,
  'b777-8': 0.1,
  'b777-9': 0.1,
  'b777-8f': 0.1,
  'b787-8': 0.1,
  'b787-9': 0.1,
  'b787-10': 0.1,
  md11f: 3.41,
  // Avions régionaux
  crj200: 0.4, // estimation (CRJ-100/200)
  crj700: 0.1, // 0,09 observé (CRJ-700/900/1000)
  crj900: 0.1,
  e170: 0.17,
  e175: 0.17,
  e190: 0.17,
  e195: 0.17,
  'e190-e2': 0.1,
  'e195-e2': 0.1,
  erj145: 0.3, // estimation
  ssj100: 1.3, // estimation (plusieurs pertes pour une petite flotte)
  c909: 0.3, // estimation
  c919: 0.1,
  'mc21-300': 0.1,
  // Turbopropulseurs (estimation IATA / ASN : nettement plus risqués que les jets)
  'atr42-600': 0.9,
  'atr72-600': 0.9,
  'atr72-600f': 0.9,
  'dhc8-300': 1.0,
  'dhc8-400': 1.0,
  saab340: 1.2,
  b1900d: 2.0,
  'dhc6-300g': 3.0,
};

/** Si un modèle manque au tableau : moyenne de sa catégorie. */
const CATEGORY_DEFAULT: Record<AircraftModel['category'], number> = {
  regional_turboprop: 1.0,
  regional_jet: 0.3,
  narrowbody: 0.2,
  widebody: 0.4,
  jumbo: 0.5,
};

/**
 * Vols cargo : environ 30 % des avions détruits (Boeing 2016-2025) pour moins
 * de 10 % des vols, donc environ 3 fois plus de risque (nuit, charges, avions âgés).
 */
const CARGO_FACTOR = 3;

/**
 * Pilote : l'inexpérience (peu d'heures, peu d'heures sur le type) est un
 * facteur connu des accidents. 3 étoiles = équipage moyen des statistiques.
 */
const PILOT_FACTOR = [2.2, 2.2, 1.5, 1.0, 0.85, 0.75];
/** Sans pilote attitré (vol de convoyage) : équipage de remplacement, comme un débutant. */
const NO_PILOT_FACTOR = 1.8;

/**
 * Entretien : les statistiques supposent un avion entretenu selon les règles.
 * Au-dessus de 70 % d'état, rien ne change ; en dessous, le risque grimpe vite
 * (× 3 à 50 %, × 11 à 30 %, × 67 à 0 %).
 */
const CONDITION_OK = 70;
const CONDITION_SLOPE = 0.06;

/** Vieillissement des structures (fatigue, corrosion) au-delà de 25 ans : +4 % par an. */
const AGE_FROM = 25;
const AGE_SLOPE = 0.04;

export interface CrashRisk {
  /** Probabilité d'accident pour ce vol. */
  p: number;
  base: number;
  cargo: number;
  pilot: number;
  condition: number;
  age: number;
}

export function baseHullLossRate(model: AircraftModel): number {
  return (HULL_LOSS_PER_M[model.id] ?? CATEGORY_DEFAULT[model.category]) / 1e6;
}

/** Fréquence des accidents choisie dans les réglages de la partie. */
export const CRASH_FREQUENCY = { realiste: 1, frequent: 100, aucun: 0 } as const;
export type CrashFrequency = keyof typeof CRASH_FREQUENCY;

export function crashRisk(data: GameData, ac: Aircraft, pilot: Pilot | null, t: number, frequency: CrashFrequency = 'realiste'): CrashRisk {
  const model = data.model(ac.modelId);
  const base = baseHullLossRate(model);
  const cargo = model.kind === 'cargo' ? CARGO_FACTOR : 1;
  const pilotF = pilot ? PILOT_FACTOR[Math.max(0, Math.min(5, pilot.stars))] : NO_PILOT_FACTOR;
  const condition = ac.condition >= CONDITION_OK ? 1 : Math.exp(CONDITION_SLOPE * (CONDITION_OK - ac.condition));
  const age = 1 + Math.max(0, ageYears(ac, t) - AGE_FROM) * AGE_SLOPE;
  const p = Math.min(0.5, base * cargo * pilotF * condition * age * CRASH_FREQUENCY[frequency]);
  return { p, base, cargo, pilot: pilotF, condition, age };
}

/**
 * Phase de vol des accidents mortels (Boeing 2016-2025, arrondi) : la plupart
 * arrivent au décollage ou à l'atterrissage, peu en croisière.
 * `at` : moment de l'accident, en fraction du vol.
 */
export const PHASES: { phase: CrashPhase; share: number; at: [number, number]; fatal: number; killed: [number, number] }[] = [
  { phase: 'decollage', share: 0.2, at: [0, 0.01], fatal: 0.45, killed: [0.05, 1] },
  { phase: 'montee', share: 0.08, at: [0.03, 0.12], fatal: 0.85, killed: [0.6, 1] },
  { phase: 'croisiere', share: 0.12, at: [0.2, 0.75], fatal: 0.95, killed: [0.9, 1] },
  { phase: 'approche', share: 0.2, at: [0.85, 0.97], fatal: 0.7, killed: [0.3, 1] },
  { phase: 'atterrissage', share: 0.4, at: [1, 1], fatal: 0.2, killed: [0.02, 0.4] },
];

export const PHASE_LABEL: Record<CrashPhase, string> = {
  decollage: 'au décollage',
  montee: 'en montée',
  croisiere: 'en croisière',
  approche: 'en approche',
  atterrissage: 'à l’atterrissage',
};

/** Personnel navigant : 2 pilotes + 1 membre d'équipage de cabine pour 50 sièges (règle européenne). */
export function crewOf(model: AircraftModel): number {
  return 2 + (model.kind === 'pax' && model.seats ? Math.max(1, Math.ceil(model.seats / 50)) : 0);
}

/** Montréal 1999 : responsabilité sans faute de 151 880 DTS par victime (≈ 200 000 $). */
export const LIABILITY_PER_DEATH = 200_000;
export const LIABILITY_PER_INJURED = 30_000;
/** Part des indemnisations restant à la charge de la compagnie (franchise) ; l'assureur paie le reste. */
export const LIABILITY_DEDUCTIBLE = 0.1;
/** L'assurance corps rembourse la valeur de l'avion, moins une franchise. */
export const HULL_DEDUCTIBLE = 0.1;
export const CRASH_REPUTATION_FATAL = 25;
export const CRASH_REPUTATION = 8;

/** « 1 vol sur 4,2 millions » : lecture d'une probabilité pour l'écran. */
export function oneIn(p: number): number {
  return p > 0 ? 1 / p : Infinity;
}
