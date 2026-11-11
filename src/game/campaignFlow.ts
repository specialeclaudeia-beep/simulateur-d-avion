/**
 * Mode par échelons : passer à l'échelon suivant, ou recommencer celui en cours.
 *
 * Changer de pays, c'est repartir de zéro ailleurs, en plus grand : on revend
 * tout (avions, hubs), la compagnie garde son nom, ses améliorations, son
 * meilleur pilote et une partie de ce qu'elle a gagné.
 */
import { buyHub } from './actions';
import {
  GOAL_IDS,
  LEVELS,
  PERKS,
  eligibleCountries,
  goalsReached,
  hubsFor,
  levelGoals,
  levelProfit,
  levelSpec,
  nextCapital,
  perkCount,
  perkOffer,
  picksAllowed,
} from './campaign';
import { DAY } from './config';
import { fail, invalidate, log, ok, type ActionResult, type Ctx } from './context';
import { hubPrice } from './hubs';
import { newLedger } from './ledger';
import { pilotName } from './pilots';
import { refreshMarkets } from './sim';
import type { PerkId, Pilot } from './state';

export interface LevelChoice {
  country: string;
  hub: string;
  perks: PerkId[];
}

/** Le pilote qui suit la compagnie dans le pays suivant : le plus expérimenté. */
export function followingPilot(pilots: readonly Pilot[]): Pilot | null {
  let best: Pilot | null = null;
  for (const p of pilots) if (!best || p.hours > best.hours) best = p;
  return best;
}

/** Remet la compagnie à zéro dans un pays, avec ce capital, et achète son hub de départ. */
function settle(ctx: Ctx, t: number, level: number, country: string, hub: string, capital: number): void {
  const { state: s, data } = ctx;
  const c = s.campaign!;
  const oldCoef = data.coef(s.company.country);
  const pilot = followingPilot(s.pilots);

  s.company.country = country;
  s.cash = capital;
  s.debt = 0;
  s.hubs = [];
  s.aircraft = [];
  s.lines = [];
  s.pilots = pilot
    ? [{ ...pilot, aircraftId: null, training: null, salary: Math.round((pilot.salary * data.coef(country)) / oldCoef / 100) * 100 }]
    : [];
  s.ledger = newLedger(t);
  s.history = [];
  s.taxLossCarry = 0;
  s.negativeSince = null;
  s.bankrupt = false;
  // La réputation ne voyage qu'à moitié : dans un nouveau pays, tout est à refaire.
  s.reputation = 50 + (s.reputation - 50) / 2;
  s.rivalry = {};

  c.level = level;
  c.reached = { airports: false, satisfaction: false, profit: false };
  c.cleared = false;
  c.levelStartedAt = t;
  c.capital = capital;
  invalidate(ctx);

  const L = levelSpec(level);
  log(ctx, 'good', `Échelon ${level}, « ${L.name} » : ${L.pitch}`, undefined, t);
  const bought = buyHub(ctx, t, hub);
  if (!bought.ok) throw new Error(bought.error);
  c.goals = levelGoals(data, level, hub);
  if (pilot) log(ctx, 'info', `${pilotName(pilot)} te suit dans cette nouvelle aventure.`, { type: 'pilot', id: pilot.id }, t);
  refreshMarkets(ctx, t);
}

/** Vérifie un choix de pays et de hub pour un échelon ; renvoie un message d'erreur ou null. */
function placeProblem(ctx: Ctx, level: number, country: string, hub: string, capital: number, exclude: readonly string[]): string | null {
  const { data, state: s } = ctx;
  if (!eligibleCountries(data, level, exclude).some((c) => c.code === country)) return 'Ce pays n’est pas disponible pour cet échelon.';
  const a = hubsFor(data, country, level).find((x) => x.iata === hub);
  if (!a) return 'Ce hub n’a pas assez de lignes intérieures pour cet échelon.';
  // Dans son nouveau pays, la compagnie paie le prix normal (pas le supplément « étranger »).
  const price = hubPrice({ ...s, company: { ...s.company, country } }, a);
  if (price > capital) return 'Ce hub coûte plus que ton capital de départ.';
  return null;
}

/** Pays déjà joués dans cette campagne (on n'y retourne pas). */
export function playedCountries(ctx: Ctx): string[] {
  const s = ctx.state;
  return [...(s.campaign?.done.map((d) => d.country) ?? []), s.company.country];
}

/** Passe à l'échelon suivant : nouveau pays, nouveau hub, amélioration(s) choisie(s). */
export function nextLevel(ctx: Ctx, t: number, choice: LevelChoice): ActionResult {
  const s = ctx.state;
  const c = s.campaign;
  if (!c) return fail('Cette partie n’est pas en mode par échelons.');
  if (c.finished || c.level >= LEVELS.length) return fail('Tu as déjà gravi tous les échelons.');
  if (!c.cleared) return fail('Atteins d’abord deux des trois objectifs de l’échelon.');

  const allowed = picksAllowed(c);
  const offer = perkOffer(s);
  const wanted = Math.min(allowed, offer.length);
  if (choice.perks.length !== wanted) return fail(wanted > 1 ? `Choisis ${wanted} améliorations.` : 'Choisis une amélioration.');
  const counts = new Map<PerkId, number>();
  for (const p of choice.perks) {
    if (!offer.includes(p)) return fail('Cette amélioration n’est pas proposée.');
    counts.set(p, (counts.get(p) ?? 0) + 1);
    if (counts.get(p)! > 1 || perkCount(c, p) >= PERKS[p].max) return fail(`« ${PERKS[p].title} » ne peut pas être prise une fois de plus.`);
  }

  const level = c.level + 1;
  const capital = nextCapital(s, choice.perks);
  const problem = placeProblem(ctx, level, choice.country, choice.hub, capital, playedCountries(ctx));
  if (problem) return fail(problem);

  c.done.push({
    country: s.company.country,
    level: c.level,
    days: Math.max(1, Math.round((t - c.levelStartedAt) / DAY)),
    goals: goalsReached(c),
    profit: Math.round(levelProfit(s)),
  });
  c.perks.push(...choice.perks);
  for (const p of choice.perks) log(ctx, 'good', `Amélioration obtenue : ${PERKS[p].title}`, undefined, t);
  settle(ctx, t, level, choice.country, choice.hub, capital);
  ctx.fresh = [];
  return ok(`Bienvenue à l’échelon ${level} !`);
}

/**
 * Recommence l'échelon en cours (après une faillite, ou parce qu'on s'y est
 * mal pris) : même pays, même capital, hub au choix.
 */
export function restartLevel(ctx: Ctx, t: number, hub?: string): ActionResult {
  const s = ctx.state;
  const c = s.campaign;
  if (!c) return fail('Cette partie n’est pas en mode par échelons.');
  if (c.finished) return fail('La campagne est terminée.');
  const country = s.company.country;
  const iata = hub ?? s.hubs[0]?.iata;
  const a = iata ? hubsFor(ctx.data, country, c.level).find((x) => x.iata === iata) : undefined;
  if (!a) return fail('Choisis un hub pour recommencer.');
  if (hubPrice(s, a) > c.capital) return fail('Ce hub coûte plus que ton capital de départ.');
  settle(ctx, t, c.level, country, a.iata, c.capital);
  ctx.fresh = [];
  return ok('C’est reparti : même pays, même capital.');
}

/** Tous les objectifs de l'échelon sont-ils atteints ? */
export function allGoalsReached(ctx: Ctx): boolean {
  const c = ctx.state.campaign;
  return !!c && goalsReached(c) >= GOAL_IDS.length;
}
