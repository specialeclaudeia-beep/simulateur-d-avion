/**
 * Règles de calcul d'un vol : durée, demande, prix du billet, recettes et coûts,
 * usure et risque de panne. Fonctions pures (elles ne modifient rien).
 */
import {
  AIRPORT_FEE_PER_CARGO_T,
  AIRPORT_FEE_PER_PAX,
  AIRPORT_LANDING_BASE,
  AIRPORT_LANDING_PER_SEAT,
  AIRPORT_TIER_MULT,
  BLOCK_OVERHEAD_MIN,
  BLOCK_SPEED_FACTOR,
  BREAKDOWN_BASE,
  BREAKDOWN_WEAR,
  CARGO_T_PER_PAX,
  COMPETITOR_STRENGTH,
  DAY,
  DEPRECIATION_PER_YEAR,
  DOMESTIC_VAT_SHARE,
  FUEL_OVERHEAD,
  HOME_HUB_BONUS,
  MAINT_PER_HOUR_BASE,
  MAINT_PER_HOUR_PER_SEAT,
  MAINTENANCE_BREAKDOWN_EFFECT,
  MIN_STARS,
  PILOT_STAR_HOURS,
  PRICE_ELASTICITY_MARKET,
  PRICE_ELASTICITY_SHARE,
  CABIN_PER_SEAT_HOUR,
  CREW_PER_HOUR,
  CREW_PER_HOUR_PER_SEAT,
  DOMESTIC_VAT_MAX,
  SERVICE_PER_CARGO_T,
  SERVICE_PER_PAX,
  TURNAROUND_MIN,
  WEAR_PER_CYCLE,
  WEAR_PER_HOUR,
  baseCargoRate,
  baseFare,
} from './config';
import type { AircraftModel, Airport, GameData, Route } from './data';
import type { Aircraft, GameState, Hub, LegCosts, Line, Pilot } from './state';

export const YEAR = 365.25 * DAY;

// ───────────────────────── Avions ─────────────────────────

/** « Taille » d'un avion : ses sièges, ou 3 sièges par tonne de fret. */
export function sizeEquiv(m: AircraftModel): number {
  return m.seats ?? (m.cargoT ?? 0) * 3;
}

export function seatsOf(m: AircraftModel): number {
  return m.kind === 'pax' ? (m.seats ?? 0) : 0;
}

export function cargoCapOf(m: AircraftModel): number {
  return m.kind === 'cargo' ? (m.cargoT ?? 0) : 0;
}

/** Durée d'un vol (minutes, porte à porte). */
export function blockMinutes(km: number, m: AircraftModel): number {
  return Math.round(BLOCK_OVERHEAD_MIN + (km / (BLOCK_SPEED_FACTOR * m.cruiseKmh)) * 60);
}

export function turnaroundMinutes(m: AircraftModel): number {
  return TURNAROUND_MIN[m.category] ?? 45;
}

export function ageYears(ac: Aircraft, now: number): number {
  return Math.max(0, (now - ac.builtAt) / YEAR);
}

/** Remise moyenne négociée chez un constructeur (milieu de sa fourchette). */
export function averageDiscount(data: GameData, mfr: string): number {
  const d = data.manufacturerById.get(mfr)?.contractDiscount ?? [0.3, 0.3];
  return (d[0] + d[1]) / 2;
}

/** Valeur de revente d'un avion selon son âge et son état. */
export function marketValue(data: GameData, m: AircraftModel, age: number, condition: number): number {
  const fresh = m.priceUsd * (1 - averageDiscount(data, m.mfr));
  return fresh * DEPRECIATION_PER_YEAR ** age * (0.6 + (0.4 * condition) / 100);
}

export function aircraftValue(data: GameData, ac: Aircraft, now: number): number {
  return marketValue(data, data.model(ac.modelId), ageYears(ac, now), ac.condition);
}

// ───────────────────────── Pilotes ─────────────────────────

export function starsFromHours(hours: number): number {
  let s = 1;
  for (let i = 2; i <= 5; i++) if (hours >= PILOT_STAR_HOURS[i]) s = i;
  return s;
}

/** Pourquoi ce pilote ne peut pas piloter ce modèle (ou null s'il le peut). */
export function pilotProblem(p: Pilot, m: AircraftModel): string | null {
  if (p.training) return `${p.firstName} ${p.lastName} est en formation`;
  if (!p.ratings.includes(m.family)) return `${p.firstName} ${p.lastName} n'est pas qualifié(e) sur la famille ${m.family}`;
  const min = MIN_STARS[m.category] ?? 1;
  if (p.stars < min) return `Il faut un pilote ${min} étoiles pour un ${m.name}`;
  return null;
}

// ───────────────────────── Lignes ─────────────────────────

/** Pourquoi ce modèle ne peut pas desservir la ligne (ou null s'il le peut). */
export function routeProblem(data: GameData, m: AircraftModel, from: Airport, to: Airport, km: number): string | null {
  if (m.rangeKm < km) return `Rayon d'action trop court (${m.rangeKm} km pour ${km} km)`;
  if (data.runwayOf(from) < m.runwayM) return `Piste trop courte à ${from.city || from.iata}`;
  if (data.runwayOf(to) < m.runwayM) return `Piste trop courte à ${to.city || to.iata}`;
  return null;
}

/** Prix de référence d'un billet sur la ligne (USD, à 100 %). */
export function referenceFare(data: GameData, a: Airport, b: Airport, km: number): number {
  return baseFare(km) * ((data.coef(a.country) + data.coef(b.country)) / 2);
}

export function referenceCargoRate(data: GameData, a: Airport, b: Airport, km: number): number {
  return baseCargoRate(km) * Math.sqrt((data.coef(a.country) + data.coef(b.country)) / 2);
}

/** Vol intérieur au pays de la compagnie (soumis à la TVA réduite). */
export function domesticVatRate(data: GameData, state: GameState, a: Airport, b: Airport): number {
  const c = state.company.country;
  if (a.country !== c || b.country !== c) return 0;
  return Math.min(DOMESTIC_VAT_MAX, (data.vat(c) * DOMESTIC_VAT_SHARE) / 100);
}

/** Bonus de fréquence : plus de vols par jour attirent un peu plus de passagers. */
export function frequencyFactor(legsPerDay: number): number {
  return 0.85 + 0.15 * Math.min(4, Math.max(1, legsPerDay));
}

export interface DemandContext {
  route: Route;
  line: Line;
  hub: Hub | undefined;
  reputation: number;
  condition: number;
  legsPerDay: number;
}

/** Attrait de la compagnie du joueur sur une ligne (≈ 1 = comme un concurrent moyen). */
export function attractiveness(ctx: DemandContext): number {
  const rep = 0.7 + (0.6 * ctx.reputation) / 100;
  const quality = 1 + 0.08 * ((ctx.hub?.quality ?? 1) - 1);
  const comfort = 0.85 + (0.15 * ctx.condition) / 100;
  const price = ctx.line.priceFactor ** -PRICE_ELASTICITY_SHARE;
  return HOME_HUB_BONUS * rep * quality * comfort * price * frequencyFactor(ctx.legsPerDay);
}

/** Passagers par jour et par sens que le joueur peut espérer sur la ligne, tous ses vols confondus. */
export function playerPaxPerDay(ctx: DemandContext): number {
  const A = attractiveness(ctx);
  const n = ctx.route.airlines.length * COMPETITOR_STRENGTH;
  const share = A / (A + n);
  return ctx.route.demand * ctx.line.priceFactor ** -PRICE_ELASTICITY_MARKET * share;
}

/** Tonnes de fret par jour et par sens pour le joueur. */
export function playerCargoPerDay(ctx: DemandContext): number {
  const A = HOME_HUB_BONUS * ctx.line.priceFactor ** -PRICE_ELASTICITY_SHARE * frequencyFactor(ctx.legsPerDay);
  const n = Math.floor(ctx.route.airlines.length / 3) * COMPETITOR_STRENGTH;
  const share = A / (A + n);
  return ctx.route.demand * CARGO_T_PER_PAX * ctx.line.priceFactor ** -PRICE_ELASTICITY_MARKET * share;
}

// ───────────────────────── Coûts d'un vol ─────────────────────────

export interface LegCostInput {
  model: AircraftModel;
  from: Airport;
  minutes: number;
  pax: number;
  cargoT: number;
  age: number;
  pilotStars: number;
  fuelPrice: number;
  /** Le départ se fait depuis un hub du joueur : pas de redevances. */
  fromPlayerHub: boolean;
  coefFrom: number;
  /** Richesse du pays de la compagnie (salaires des équipages). */
  coefCompany: number;
}

export function legCosts(i: LegCostInput): LegCosts {
  const hours = i.minutes / 60;
  const size = sizeEquiv(i.model);
  const fuelSkill = 1.04 - 0.02 * i.pilotStars;
  const fuel = i.model.fuelKgH * hours * FUEL_OVERHEAD * i.fuelPrice * fuelSkill;
  const maintenance = (MAINT_PER_HOUR_BASE + MAINT_PER_HOUR_PER_SEAT * size) * hours * (1 + 0.02 * i.age);
  const crew = (CREW_PER_HOUR + CREW_PER_HOUR_PER_SEAT * size + CABIN_PER_SEAT_HOUR * seatsOf(i.model)) * hours * i.coefCompany;
  const service = crew + (SERVICE_PER_PAX * i.pax + SERVICE_PER_CARGO_T * i.cargoT) * i.coefFrom;
  const airport = i.fromPlayerHub
    ? 0
    : (AIRPORT_LANDING_BASE + AIRPORT_LANDING_PER_SEAT * size + AIRPORT_FEE_PER_PAX * i.pax + AIRPORT_FEE_PER_CARGO_T * i.cargoT) *
      AIRPORT_TIER_MULT[i.from.tier] *
      i.coefFrom;
  return { fuel, airport, maintenance, service };
}

export function totalCosts(c: LegCosts): number {
  return c.fuel + c.airport + c.maintenance + c.service;
}

// ───────────────────────── Usure et pannes ─────────────────────────

export function wearPerLeg(minutes: number, age: number): number {
  return (WEAR_PER_HOUR * (minutes / 60) + WEAR_PER_CYCLE) * (1 + age / 20);
}

/** Probabilité qu'une panne soit découverte à l'arrivée d'un vol. */
export function breakdownChance(condition: number, pilotStars: number, baseMaintenanceLevel: number): number {
  const wear = Math.max(0, 100 - condition) / 100;
  const p = BREAKDOWN_BASE + BREAKDOWN_WEAR * wear ** 3;
  return p * (1.15 - 0.05 * pilotStars) * (1 - (MAINTENANCE_BREAKDOWN_EFFECT[baseMaintenanceLevel] ?? 0));
}
