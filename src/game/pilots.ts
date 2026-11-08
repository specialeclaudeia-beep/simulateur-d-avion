/**
 * Pilotes : candidats au recrutement, salaires, formations.
 */
import { MIN_STARS, PILOT_MARKET_SIZE, PILOT_SALARY, PILOT_SIGNING_MONTHS, PILOT_STAR_HOURS, TRAINING_COST, TYPE_RATING } from './config';
import type { Ctx } from './context';
import type { AircraftModel, GameData } from './data';
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

/** Étoiles qu'il faut pour piloter tous les avions d'une famille (gros-porteurs : 2 ou 3). */
export function familyMinStars(fam: { models: AircraftModel[] }): number {
  return fam.models.reduce((m, x) => Math.max(m, MIN_STARS[x.category] ?? 1), 1);
}

/** Qualification d'un candidat : jamais sur une famille qu'il n'aurait pas le droit de piloter. */
function randomFamily(ctx: Ctx, stars: number, exclude: string[]): string {
  const fams = [...ctx.data.families.values()].filter((f) => !exclude.includes(f.name) && familyMinStars(f) <= stars);
  return pickWeighted(
    ctx.rng,
    fams.map((f) => f.name),
    fams.map((f) => FAMILY_WEIGHT[f.name] ?? 0.5),
  );
}

/** Un candidat au hasard ; `family` impose sa qualification (avec les étoiles qu'il faut pour elle). */
function newCandidate(ctx: Ctx, t: number, family?: { name: string; models: AircraftModel[] }): PilotCandidate {
  const { data, rng, state } = ctx;
  const nationality = rng() < 0.7 ? state.company.country : pick(rng, data.playableCountries()).code;
  const pool = namePoolFor(nationality, data.country(nationality)?.continent);
  let hours = randomHours(rng);
  if (family) hours = Math.max(hours, PILOT_STAR_HOURS[familyMinStars(family)] + randInt(rng, 0, 1_000));
  const stars = starsFromHours(hours);
  const ratings = [family ? family.name : randomFamily(ctx, stars, [])];
  if (stars >= 3 && rng() < 0.4) ratings.push(randomFamily(ctx, stars, ratings));
  const salary = Math.round((baseSalary(data, state, stars) * (0.92 + rng() * 0.2)) / 100) * 100;
  return {
    id: `C${++state.counters.candidate}`,
    ...randomName(rng, pool),
    nationality,
    birthYear: utcYear(t) - Math.round(23 + hours / 700 + rng() * 6),
    hours,
    stars,
    ratings,
    salary,
    signingFee: Math.round(salary * PILOT_SIGNING_MONTHS),
  };
}

/** Nouvelle liste de pilotes à recruter. */
export function generateCandidates(ctx: Ctx, t: number, count = PILOT_MARKET_SIZE): PilotCandidate[] {
  const out: PilotCandidate[] = [];
  for (let i = 0; i < count; i++) out.push(newCandidate(ctx, t));
  return out.sort((a, b) => b.stars - a.stars || a.salary - b.salary);
}

/**
 * Un avion d'un type nouveau pour la compagnie vient d'être acheté : si
 * personne (pilote ou candidat) n'est qualifié dessus, un pilote qualifié
 * postule aussitôt. On n'attend jamais une semaine pour pouvoir le faire voler.
 */
export function ensureQualifiedCandidate(ctx: Ctx, t: number, familyName: string): PilotCandidate | null {
  const { data, state } = ctx;
  const family = data.families.get(familyName);
  const qualified = (ratings: string[]) => ratings.includes(familyName);
  if (!family || state.pilots.some((p) => qualified(p.ratings)) || state.market.pilots.some((c) => qualified(c.ratings))) return null;
  const c = newCandidate(ctx, t, family);
  state.market.pilots.unshift(c);
  return c;
}

export function pilotName(p: Pick<Pilot, 'firstName' | 'lastName'>): string {
  return `${p.firstName} ${p.lastName}`;
}
