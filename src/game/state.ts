/**
 * État d'une partie : tout ce qui est sauvegardé.
 *
 * L'état ne contient que des données simples (pas de classes, pas de
 * fonctions) pour pouvoir être enregistré tel quel en JSON. Les dates sont
 * en millisecondes de temps de jeu (comme `clock.now()`).
 */
import type { Difficulty } from './config';

export const SAVE_VERSION = 1;

// ───────────────────────── Compagnie ─────────────────────────

export type LogoShape = 'circle' | 'square' | 'shield' | 'diamond';

export type Logo =
  | { kind: 'symbol'; symbol: string; shape: LogoShape; fg: string; bg: string }
  | { kind: 'image'; dataUrl: string };

export interface Company {
  name: string;
  /** Code à deux caractères (comme les codes IATA des compagnies), utilisé pour les numéros de vol. */
  code: string;
  color: string;
  logo: Logo;
  /** Pays d'administration (code ISO), pour les impôts. */
  country: string;
  difficulty: Difficulty;
  founded: number;
}

// ───────────────────────── Hubs et lignes ─────────────────────────

export interface Hub {
  iata: string;
  boughtAt: number;
  pricePaid: number;
  /** Total dépensé en améliorations. */
  invested: number;
  gates: number;
  lineSlots: number;
  parking: number;
  quality: number;
  maintenance: number;
}

export interface Line {
  id: string;
  /** Numéro de base des vols de la ligne (ex. 120 → vols 120, 121, 122…). */
  number: number;
  hub: string;
  dest: string;
  km: number;
  /** Prix du billet par rapport au prix de référence (1 = 100 %). */
  priceFactor: number;
  openedAt: number;
  stats: LineStats;
  /** Statistiques du mois en cours (remises à zéro chaque mois). */
  month: LineStats;
}

export interface LineStats {
  flights: number;
  pax: number;
  seats: number;
  cargoT: number;
  capT: number;
  revenue: number;
  costs: number;
}

// ───────────────────────── Avions ─────────────────────────

export type AircraftStatus =
  | 'delivery' // en livraison (until = date d'arrivée)
  | 'idle' // au sol sans programme ou sans pilote
  | 'ground' // escale ou attente du prochain départ (until)
  | 'flying' // en vol (leg)
  | 'maintenance' // révision (until)
  | 'broken' // en panne, attend une réparation
  | 'repair'; // en réparation (until)

export interface LegCosts {
  fuel: number;
  airport: number;
  maintenance: number;
  service: number;
}

/** Un vol (trajet entre deux aéroports). */
export interface Leg {
  id: string;
  kind: 'line' | 'ferry';
  lineId: string | null;
  from: string;
  to: string;
  dep: number;
  arr: number;
  callsign: string;
  pax: number;
  seats: number;
  cargoT: number;
  cargoMaxT: number;
  /** Recette brute (billets ou fret), TVA comprise. */
  revenue: number;
  vat: number;
  costs: LegCosts;
}

export interface Breakdown {
  severity: 'minor' | 'major';
  hours: number;
  cost: number;
  at: number;
}

export interface AircraftStats {
  flights: number;
  pax: number;
  cargoT: number;
  revenue: number;
  costs: number;
}

export interface Aircraft {
  id: string;
  modelId: string;
  registration: string;
  /** Nom de baptême facultatif. */
  name: string | null;
  builtAt: number;
  acquiredAt: number;
  pricePaid: number;
  /** État général sur 100 (100 = neuf). */
  condition: number;
  hours: number;
  cycles: number;
  /** Hub de rattachement (code IATA). */
  base: string;
  /** Aéroport où se trouve l'avion quand il est au sol. */
  location: string;
  status: AircraftStatus;
  until: number | null;
  leg: Leg | null;
  pilotId: string | null;
  /** Lignes desservies à tour de rôle (identifiants de lignes). */
  program: string[];
  programIndex: number;
  breakdown: Breakdown | null;
  stats: AircraftStats;
}

// ───────────────────────── Pilotes ─────────────────────────

export interface PilotTraining {
  kind: 'initial' | 'type';
  family: string;
  until: number;
}

export interface Pilot {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  birthYear: number;
  hours: number;
  stars: number;
  /** Familles d'avions sur lesquelles le pilote est qualifié (ex. « A320 »). */
  ratings: string[];
  salary: number;
  hiredAt: number;
  aircraftId: string | null;
  training: PilotTraining | null;
}

export interface PilotCandidate {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  birthYear: number;
  hours: number;
  stars: number;
  ratings: string[];
  salary: number;
  signingFee: number;
}

// ───────────────────────── Marchés ─────────────────────────

export interface UsedListing {
  id: string;
  modelId: string;
  builtAt: number;
  condition: number;
  hours: number;
  price: number;
}

// ───────────────────────── Finances ─────────────────────────

export type LedgerKey =
  | 'tickets'
  | 'cargo'
  | 'fuel'
  | 'airport'
  | 'maintenance'
  | 'checks'
  | 'repairs'
  | 'service'
  | 'salaries'
  | 'hubs'
  | 'insurance'
  | 'compensation'
  | 'vat'
  | 'interest'
  | 'tax'
  | 'aircraftPurchase'
  | 'hubPurchase'
  | 'upgrades'
  | 'training'
  | 'recruitment'
  | 'lineOpening'
  | 'assetSales';

export interface MonthLedger {
  month: string;
  entries: Partial<Record<LedgerKey, number>>;
  flights: number;
  pax: number;
  cargoT: number;
  /** Trésorerie à la fin du mois (remplie à la clôture). */
  cashEnd?: number;
}

// ───────────────────────── Journal et réglages ─────────────────────────

export type LogKind = 'info' | 'good' | 'bad' | 'money';

export interface LogEntry {
  t: number;
  kind: LogKind;
  text: string;
  ref?: { type: 'aircraft' | 'pilot' | 'hub' | 'line'; id: string };
}

export interface Settings {
  /** Révision automatique quand l'avion repasse à son hub sous ce seuil d'état. */
  autoMaintenance: boolean;
  maintenanceThreshold: number;
  /** Réparation lancée automatiquement en cas de panne. */
  autoRepair: boolean;
  /** Le temps continue (à vitesse réelle) quand le jeu est fermé. */
  offlineProgress: boolean;
}

// ───────────────────────── Partie ─────────────────────────

export interface GameState {
  version: number;
  id: string;
  startedAt: number;
  /** Dernier instant simulé. */
  time: number;
  seed: number;
  company: Company;
  cash: number;
  debt: number;
  hubs: Hub[];
  aircraft: Aircraft[];
  pilots: Pilot[];
  lines: Line[];
  market: { used: UsedListing[]; pilots: PilotCandidate[]; refreshedAt: number };
  /** Nombre d'avions achetés neufs chez chaque constructeur (remise de fidélité). */
  relations: Record<string, number>;
  ledger: MonthLedger;
  history: MonthLedger[];
  taxLossCarry: number;
  fuelPrice: number;
  reputation: number;
  negativeSince: number | null;
  bankrupt: boolean;
  nextDay: number;
  nextMonth: number;
  counters: { aircraft: number; pilot: number; line: number; listing: number; candidate: number; flight: number; lineNumber: number };
  stats: { flights: number; pax: number; cargoT: number; km: number; revenue: number };
  log: LogEntry[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  autoMaintenance: true,
  maintenanceThreshold: 60,
  autoRepair: false,
  offlineProgress: true,
};

export function emptyStats(): LineStats {
  return { flights: 0, pax: 0, seats: 0, cargoT: 0, capT: 0, revenue: 0, costs: 0 };
}
