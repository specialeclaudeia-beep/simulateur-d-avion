/**
 * État d'une partie : tout ce qui est sauvegardé.
 *
 * L'état ne contient que des données simples (pas de classes, pas de
 * fonctions) pour pouvoir être enregistré tel quel en JSON. Les dates sont
 * en millisecondes de temps de jeu (comme `clock.now()`).
 */
import type { Difficulty } from './config';

/**
 * Version 2 : modes de jeu (partie libre avec ou sans concurrence, mode par
 * échelons). Les parties de la version 1 deviennent des parties libres avec
 * concurrence, sans rien perdre (voir migrate() dans save.ts).
 */
export const SAVE_VERSION = 2;

// ───────────────────────── Modes de jeu ─────────────────────────

/** Partie libre (le jeu d'origine) ou mode par échelons (pays par pays, à petite échelle d'abord). */
export type GameMode = 'libre' | 'echelons';

/**
 * Ce qui a changé sur une ligne par rapport aux vraies compagnies qui la
 * desservent (mode « avec concurrence ») : nouvelles venues, départs, guerre
 * des prix en cours.
 */
export interface Rivalry {
  /** Compagnies arrivées sur la ligne depuis le début de la partie (codes IATA). */
  entrants: string[];
  /** Compagnies qui ont abandonné la ligne. */
  gone: string[];
  /** Guerre des prix en cours : qui la mène et jusqu'à quand. */
  war: { airline: string; until: number } | null;
}

/** Améliorations à choisir entre deux échelons (voir campaign.ts). */
export type PerkId =
  | 'fleet'
  | 'lines'
  | 'recruit'
  | 'cargo'
  | 'quality'
  | 'workshop'
  | 'bigger'
  | 'hub'
  | 'intl'
  | 'deal'
  | 'school'
  | 'capital';

/** Les trois objectifs d'un échelon : relier des aéroports, satisfaire les passagers, gagner de l'argent. */
export type GoalId = 'airports' | 'satisfaction' | 'profit';

/** Avancement du mode par échelons. */
export interface Campaign {
  /** Échelon en cours (1 = le premier pays). */
  level: number;
  /** Améliorations choisies depuis le début (une même amélioration peut être prise plusieurs fois). */
  perks: PerkId[];
  /** Pays déjà terminés (durée en jours de jeu, objectifs atteints, bénéfices réalisés). */
  done: { country: string; level: number; days: number; goals: number; profit: number }[];
  /** Objectifs de l'échelon en cours. */
  goals: Record<GoalId, number>;
  /** Objectifs déjà atteints (un objectif atteint reste acquis). */
  reached: Record<GoalId, boolean>;
  /** Assez d'objectifs atteints : le pays suivant est ouvert. */
  cleared: boolean;
  /** Dernier échelon réussi : la campagne est finie, plus aucune limite. */
  finished: boolean;
  levelStartedAt: number;
  /** Capital de départ de cet échelon. */
  capital: number;
}

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
  /**
   * Cumuls du mois relevés à la fin de chaque jour (UTC), pour les graphiques
   * jour par jour. Absent dans les parties d'avant ce relevé.
   */
  days?: DaySnap[];
}

/** Cumul du mois à la fin d'un jour : la différence entre deux relevés donne le jour. */
export interface DaySnap {
  /** Jour du mois (1 à 31). */
  d: number;
  revenue: number;
  opex: number;
  flights: number;
  pax: number;
  cargoT: number;
  cash: number;
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
  stats: GameStats;
  log: LogEntry[];
  settings: Settings;
  mode: GameMode;
  /** Les autres compagnies se disputent-elles les passagers ? (faux : partie libre « sans concurrence ») */
  competition: boolean;
  /** Évolution de la concurrence, par ligne (clé GameData.routeKey). */
  rivalry: Record<string, Rivalry>;
  /** Mode par échelons seulement. */
  campaign: Campaign | null;
}

/** Statistiques de la partie depuis sa création (écran « Statistiques »). */
export interface GameStats {
  flights: number;
  pax: number;
  cargoT: number;
  km: number;
  /** Recettes des vols (billets et fret). */
  revenue: number;
  /** Tout l'argent encaissé (vols, ventes d'avions et de hubs), hors emprunts. */
  earned: number;
  /** Tout l'argent dépensé (achats, frais, salaires, impôts…), hors remboursements d'emprunts. */
  spent: number;
  /** Heures de vol de toute la flotte. */
  hours: number;
  /** Avions achetés (neufs et d'occasion). */
  bought: number;
  /** Avions détruits dans un accident. */
  crashes: number;
  /** Temps réel passé à jouer (millisecondes, jeu ouvert et visible). */
  playMs: number;
  /** Heure réelle de création de la partie (absente pour les parties d'avant les statistiques). */
  startedReal?: number;
}

export function newStats(now?: number): GameStats {
  return { flights: 0, pax: 0, cargoT: 0, km: 0, revenue: 0, earned: 0, spent: 0, hours: 0, bought: 0, crashes: 0, playMs: 0, startedReal: now };
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
