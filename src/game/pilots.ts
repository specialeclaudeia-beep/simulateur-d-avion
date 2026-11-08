/**
 * Pilotes : candidats au recrutement, salaires, formations.
 */
import { PILOT_MARKET_SIZE, PILOT_SALARY, PILOT_SIGNING_MONTHS, TRAINING_COST, TYPE_RATING } from './config';
import type { Ctx } from './context';
import type { GameData } from './data';
import { starsFromHours } from './economy';
import { namePoolFor, randomName } from './names';
import { pick, pickWeighted, randInt, type Rng } from './rng';
import type { GameState, Pilot, PilotCandidate } from './state';
import { utcYear } from './time';

/** Familles les plus répandues (et donc les plus faciles à recruter). */
const FAMILY_WEIGHT: Record<string, number> = {
  A320: 5,
  '737': 5,
  ATR: 2.5,
  'E-Jet': 2.5,
  A220: 1.5,
  'Dash 8': 1,
  'DHC-6': 0.6,
  A330: 1.6,
  '787': 1.6,
  '777': 1.6,
  A350: 1.3,
  '767': 0.5,
  '747': 0.4,
  A380: 0.4,
  C919: 0.5,
  C909: 0.5,
  SSJ: 0.4,
  'MC-21': 0.3,
  // Modèles plus fabriqués mais encore très présents dans le ciel.
  CRJ: 1,
  ERJ: 0.6,
  '757': 0.5,
  '717': 0.3,
  A300: 0.3,
  A340: 0.3,
  'MD-11': 0.2,
  'Saab 340': 0.3,
  B1900: 0.3,
};

export function baseSalary(data: GameData, state: GameState, stars: number): number {
  return PILOT_SALARY[stars] * data.coef(state.company.country);
}

export function trainingCost(data: GameData, state: GameState): number {
  return Math.round((TRAINING_COST * data.coef(state.company.country)) / 1000) * 1000;
}

export function typeRatingSpec(data: GameData, state: GameState, family: string): { cost: number; days: number } {
  const spec = data.families.get(family)?.large ? TYPE_RATING.large : TYPE_RATING.small;
  return { cost: Math.round((spec.cost * data.coef(state.company.country)) / 1000) * 1000, days: spec.days };
}

function randomHours(rng: Rng): number {
  const r = rng();
  if (r < 0.4) return randInt(rng, 400, 1499);
  if (r < 0.7) return randInt(rng, 1500, 3999);
  if (r < 0.85) return randInt(rng, 4000, 7999);
  if (r < 0.95) return randInt(rng, 8000, 11999);
  return randInt(rng, 12000, 20000);
}

function randomFamily(ctx: Ctx, stars: number, exclude: string[]): string {
  const fams = [...ctx.data.families.values()].filter((f) => !exclude.includes(f.name) && (stars >= 2 || !f.large));
  return pickWeighted(
    ctx.rng,
    fams.map((f) => f.name),
    fams.map((f) => FAMILY_WEIGHT[f.name] ?? 0.5),
  );
}

/** Nouvelle liste de pilotes à recruter. */
export function generateCandidates(ctx: Ctx, t: number, count = PILOT_MARKET_SIZE): PilotCandidate[] {
  const { data, rng, state } = ctx;
  const home = state.company.country;
  const countries = data.playableCountries();
  const year = utcYear(t);
  const out: PilotCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const nationality = rng() < 0.7 ? home : pick(rng, countries).code;
    const pool = namePoolFor(nationality, data.country(nationality)?.continent);
    const hours = randomHours(rng);
    const stars = starsFromHours(hours);
    const ratings = [randomFamily(ctx, stars, [])];
    if (stars >= 3 && rng() < 0.4) ratings.push(randomFamily(ctx, stars, ratings));
    const salary = Math.round((baseSalary(data, state, stars) * (0.92 + rng() * 0.2)) / 100) * 100;
    out.push({
      id: `C${++state.counters.candidate}`,
      ...randomName(rng, pool),
      nationality,
      birthYear: year - Math.round(23 + hours / 700 + rng() * 6),
      hours,
      stars,
      ratings,
      salary,
      signingFee: Math.round(salary * PILOT_SIGNING_MONTHS),
    });
  }
  return out.sort((a, b) => b.stars - a.stars || a.salary - b.salary);
}

export function pilotName(p: Pick<Pilot, 'firstName' | 'lastName'>): string {
  return `${p.firstName} ${p.lastName}`;
}
