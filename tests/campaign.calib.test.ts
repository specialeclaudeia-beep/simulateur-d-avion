/**
 * Calibrage du mode par échelons (lancé seulement avec CALIB=1).
 *
 * Un joueur automatique « qui s'y prend bien » joue chaque échelon : il essaie
 * plusieurs hubs et plusieurs façons de composer sa flotte (taille des avions,
 * nombre d'avions, lignes par avion) sur une copie de la partie, garde la
 * meilleure, puis la joue pour de bon. On regarde en combien de jours il
 * atteint chaque objectif et ce qu'il gagne par jour.
 */
import { describe, it } from 'vitest';
import * as act from '../src/game/actions';
import { CLASS_ORDER, LEVELS, domesticDests, eligibleCountries, hubsFor, levelProfit, limits, perkOffer, picksAllowed, progress } from '../src/game/campaign';
import { nextLevel, type LevelChoice } from '../src/game/campaignFlow';
import { DAY, HOUR, baseFare } from '../src/game/config';
import { makeCtx, type Ctx } from '../src/game/context';
import { orderQuote } from '../src/game/fleet';
import { money } from '../src/game/ledger';
import { advance } from '../src/game/sim';
import type { GameState, GoalId, PerkId } from '../src/game/state';
import { newTestGame, realData, T0 } from './helpers';

const run = process.env.CALIB ? describe : describe.skip;

interface Strategy {
  /** Taille d'avion visée (sièges). */
  seats: number;
  /** Lignes par avion. */
  k: number;
  /** Avions achetés au départ. */
  n: number;
  /** Peut acheter d'occasion. */
  used: boolean;
}

const share = (demand: number, airlines: number) => (demand * 1.1) / (1.1 + airlines);

/** Hubs les plus prometteurs d'un pays pour un échelon (recette possible sur ses meilleures lignes). */
function candidateHubs(country: string, level: number, capital: number, max = 3): string[] {
  const data = realData();
  const L = LEVELS[level - 1];
  return hubsFor(data, country, level)
    .filter((a) => a.price <= capital * 0.4)
    .map((a) => {
      const score = domesticDests(data, a.iata)
        .map((d) => data.route(a.iata, d)!)
        .map((r) => share(r.demand, r.airlines.length) * baseFare(r.km))
        .sort((x, y) => y - x)
        .slice(0, L.lines)
        .reduce((s, x) => s + x, 0);
      return { iata: a.iata, score: score / (1 + a.price / capital) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.iata);
}

function clone(ctx: Ctx): Ctx {
  return makeCtx(ctx.data, structuredClone(ctx.state) as GameState);
}

/** Lignes à ouvrir, les meilleures d'abord (celles qu'il faut pour l'objectif « aéroports » en premier). */
function wantedLines(ctx: Ctx, count: number): string[] {
  const { data, state: s } = ctx;
  const c = s.campaign!;
  const lim = limits(s);
  const hub = s.hubs[0].iata;
  const all = data
    .routesFrom(hub)
    .map((r) => ({ dest: r.a === hub ? r.b : r.a, value: share(r.demand, r.airlines.length) * baseFare(r.km) }))
    .filter((x) => !lim || lim.intl || data.airport(x.dest).country === s.company.country)
    .sort((a, b) => b.value - a.value);
  const domestic = all.filter((x) => data.airport(x.dest).country === s.company.country);
  const need = domestic.slice(0, Math.max(0, c.goals.airports - 1));
  return [...need, ...all.filter((x) => !need.includes(x))].slice(0, count).map((x) => x.dest);
}

function openLines(ctx: Ctx, t: number, count: number): void {
  const s = ctx.state;
  const hub = s.hubs[0].iata;
  for (const dest of wantedLines(ctx, count)) {
    if (s.lines.some((l) => l.dest === dest)) continue;
    let r = act.openLine(ctx, t, hub, dest);
    if (!r.ok && /licences/.test(r.error)) {
      if (!act.upgradeHub(ctx, t, hub, 'lineSlots').ok) return;
      r = act.openLine(ctx, t, hub, dest);
    }
    if (!r.ok) return;
  }
}

/** Achète un avion proche de la taille visée, neuf ou d'occasion, dans la limite du budget. */
function buyOne(ctx: Ctx, t: number, st: Strategy, budget: number): boolean {
  const { data, state: s } = ctx;
  const lim = limits(s);
  const hub = s.hubs[0];
  const airport = data.airport(hub.iata);
  if (lim && s.aircraft.length >= lim.fleet) return false;
  if (hub.parking <= s.aircraft.length && !act.upgradeHub(ctx, t, hub.iata, 'parking').ok) return false;
  const kms = s.lines.map((l) => l.km).sort((a, b) => a - b);
  const km = kms[Math.floor(kms.length * 0.7)] ?? 300;
  const fits = (id: string) => {
    const m = data.model(id);
    if (m.kind !== 'pax' || m.rangeKm < km || m.runwayM > data.runwayOf(airport)) return false;
    return !lim || CLASS_ORDER.indexOf(m.category) <= lim.classCap;
  };
  type Option = { seats: number; price: number; buy: () => boolean };
  const options: Option[] = [];
  for (const m of data.models) {
    if (!m.inProduction || m.eis > 2026 || !fits(m.id)) continue;
    const q = orderQuote(data, s, m, 1, t);
    options.push({ seats: m.seats ?? 0, price: q.total, buy: () => act.orderAircraft(ctx, t, m.id, 1, hub.iata).ok });
  }
  if (st.used) {
    for (const l of s.market.used) {
      if (!fits(l.modelId) || l.condition < 60) continue;
      options.push({ seats: data.model(l.modelId).seats ?? 0, price: l.price, buy: () => act.buyUsed(ctx, t, l.id, hub.iata).ok });
    }
  }
  const affordable = options.filter((o) => o.price <= budget);
  if (!affordable.length) return false;
  affordable.sort((a, b) => Math.abs(a.seats - st.seats) - Math.abs(b.seats - st.seats) || a.price - b.price);
  return affordable[0].buy();
}

/** Pilotes et programmes : à refaire chaque jour (livraisons, fins de formation…). */
function operate(ctx: Ctx, t: number, st: Strategy): void {
  const { data, state: s } = ctx;
  const lim = limits(s);
  const hub = s.hubs[0].iata;
  for (const ac of s.aircraft) {
    if (ac.pilotId) continue;
    const family = data.model(ac.modelId).family;
    const free = s.pilots.find((p) => !p.aircraftId && !p.training && p.ratings.includes(family));
    if (free) {
      act.assignPilot(ctx, t, ac.id, free.id);
      continue;
    }
    const coming = s.pilots.filter((p) => !p.aircraftId && p.training?.family === family).length;
    const waiting = s.aircraft.filter((a) => !a.pilotId && data.model(a.modelId).family === family).length;
    if (coming >= waiting) continue;
    const cand = !lim || lim.recruit ? s.market.pilots.find((p) => p.ratings.includes(family)) : undefined;
    if (cand) act.hirePilot(ctx, t, cand.id);
    else {
      // Un pilote libre d'une autre famille se requalifie plus vite qu'un élève ne se forme.
      const other = s.pilots.find((p) => !p.aircraftId && !p.training);
      if (!other || !act.trainTypeRating(ctx, t, other.id, family).ok) act.trainNewPilot(ctx, t, family);
    }
  }
  const ready = s.aircraft.filter((a) => a.pilotId && a.status !== 'delivery');
  if (!ready.length) return;
  // Chaque avion prêt prend `k` lignes, les meilleures d'abord ; les lignes en trop attendent d'autres avions.
  const lines = s.lines;
  ready.forEach((ac, i) => {
    const model = data.model(ac.modelId);
    const prog: string[] = [];
    for (let j = 0; j < lines.length && prog.length < st.k; j++) {
      const l = lines[(i * st.k + j) % lines.length];
      if (j >= st.k && ready.length * st.k >= lines.length) break;
      if (!prog.includes(l.id) && model.rangeKm >= l.km) prog.push(l.id);
    }
    if (prog.join() === ac.program.join()) return;
    let r = act.setProgram(ctx, t, ac.id, prog);
    for (let g = 0; !r.ok && /portes/.test(r.error) && g < 8; g++) {
      if (!act.upgradeHub(ctx, t, hub, 'gates').ok) break;
      r = act.setProgram(ctx, t, ac.id, prog);
    }
  });
}

interface Played {
  days: Partial<Record<GoalId, number>>;
  cleared: number | null;
  profit: number;
  /** Bénéfice par jour une fois la compagnie lancée (du jour 25 à la fin). */
  cruise: number;
  t: number;
}

/** Joue l'échelon en cours avec une stratégie. `stopWhenDone` : s'arrête dès les trois objectifs atteints. */
function play(ctx: Ctx, t0: number, st: Strategy, maxDays: number, stopWhenDone: boolean): Played {
  const s = ctx.state;
  const c = s.campaign!;
  const lim = limits(s);
  const hub = s.hubs[0].iata;
  const fleetCap = lim?.fleet ?? 30;
  const lineCap = lim?.lines ?? 40;
  s.settings.autoRepair = true;
  let t = t0;
  const reserve = c.capital * 0.06;
  const linesFor = (n: number) => Math.min(lineCap, Math.max(c.goals.airports - 1, n * st.k));
  openLines(ctx, t, linesFor(Math.min(st.n, fleetCap)));
  const each = (s.cash - reserve) / st.n;
  for (let i = 0; i < st.n; i++) if (!buyOne(ctx, t, st, Math.min(each, s.cash - reserve))) break;

  const days: Partial<Record<GoalId, number>> = {};
  let cleared: number | null = null;
  let profit25 = 0;
  let d = 0;
  for (; d < maxDays; d++) {
    operate(ctx, t, st);
    if (d > 0 && d % 7 === 0) {
      // Réinvestir : un avion de plus quand la caisse le permet, et des lignes pour lui.
      if (s.aircraft.length < fleetCap && buyOne(ctx, t, st, s.cash - reserve * 2)) openLines(ctx, t, linesFor(s.aircraft.length));
      // Qualité du hub tant que la satisfaction n'y est pas.
      if (!c.reached.satisfaction && s.cash > c.capital * 0.15) act.upgradeHub(ctx, t, hub, 'quality');
    }
    t += DAY;
    advance(ctx, t);
    if (d === 24) profit25 = levelProfit(s);
    for (const g of progress(ctx, t)) if (g.reached && days[g.id] === undefined) days[g.id] = d + 1;
    if (c.cleared && cleared === null) cleared = d + 1;
    if (s.bankrupt) break;
    if (stopWhenDone && Object.keys(days).length === 3) {
      d++;
      break;
    }
  }
  const profit = levelProfit(s);
  return { days, cleared, profit, cruise: d > 25 ? (profit - profit25) / (d - 25) : NaN, t };
}

/** Cherche la meilleure stratégie pour l'échelon en cours, sur des copies de la partie. */
function bestStrategy(ctx: Ctx, t: number, horizon = 50): { st: Strategy; profit: number } {
  const lim = limits(ctx.state);
  const cap = lim?.fleet ?? 20;
  const sizes = [19, 34, 50, 70, 90, 110, 140, 180, 240, 300, 400].filter((x) => {
    const top = lim ? lim.classCap : 4;
    return x <= [75, 110, 240, 400, 600][top];
  });
  const counts = [...new Set([1, 2, 3, 4, 6, 9, 13, 18].filter((n) => n <= cap).concat(cap))];
  let best: { st: Strategy; profit: number } | null = null;
  for (const seats of sizes) {
    for (const k of [1, 2, 3, 4]) {
      for (const n of counts) {
        for (const used of [true, false]) {
          const st: Strategy = { seats, k, n, used };
          const trial = clone(ctx);
          const r = play(trial, t, st, horizon, false);
          if (trial.state.bankrupt) continue;
          if (!best || r.profit > best.profit) best = { st, profit: r.profit };
        }
      }
    }
  }
  return best!;
}

function describeFleet(ctx: Ctx): string {
  const s = ctx.state;
  return [...new Set(s.aircraft.map((a) => a.modelId))].map((id) => `${s.aircraft.filter((a) => a.modelId === id).length}×${id}`).join(' ');
}

function campaign(route: string[], perkPrefs: PerkId[], maxDays: number): void {
  const data = realData();
  console.log(`\n===== Campagne ${route.join(' → ')} (améliorations préférées : ${perkPrefs.join(', ')})`);
  // Échelon 1 : on essaie les meilleurs hubs du pays.
  let ctx: Ctx | null = null;
  let plan: { st: Strategy; profit: number } | null = null;
  for (const hub of candidateHubs(route[0], 1, LEVELS[0].capital)) {
    const trial = newTestGame(hub, route[0], 'normal', 7, { mode: 'echelons' });
    const p = bestStrategy(trial, T0);
    if (!plan || p.profit > plan.profit) {
      plan = p;
      ctx = trial;
    }
  }
  if (!ctx || !plan) throw new Error('aucun hub');
  let t = T0;
  for (let level = 1; level <= LEVELS.length; level++) {
    const s = ctx.state;
    const c = s.campaign!;
    const r = play(ctx, t, plan.st, maxDays, true);
    t = r.t + HOUR;
    advance(ctx, t);
    console.log(
      `  échelon ${level} ${s.company.country}/${s.hubs[0]?.iata} capital ${money(c.capital)} | plan ${plan.st.n}+ avions ~${plan.st.seats} sièges, ${plan.st.k} ligne(s)/avion${plan.st.used ? ', occasion' : ''} | flotte ${describeFleet(ctx)} | lignes ${s.lines.length}` +
        `\n      aéroports J${r.days.airports ?? '—'}, satisfaction J${r.days.satisfaction ?? '—'}, bénéfices J${r.days.profit ?? '—'} (objectif ${money(c.goals.profit)}) | réussi J${r.cleared ?? '—'} | bénéfices ${money(r.profit)}, en croisière ${money(r.cruise)}/jour | satisfaction ${s.reputation.toFixed(0)} | caisse ${money(s.cash)}`,
    );
    if (s.bankrupt) {
      console.log('  FAILLITE');
      return;
    }
    if (c.finished || level === LEVELS.length) return;
    if (!c.cleared) {
      console.log('  échelon non réussi dans le délai');
      return;
    }
    const offer = perkOffer(s);
    const picks = perkPrefs.filter((p) => offer.includes(p)).slice(0, picksAllowed(c));
    while (picks.length < Math.min(picksAllowed(c), offer.length)) picks.push(offer.find((p) => !picks.includes(p))!);
    const done = [...c.done.map((x) => x.country), s.company.country];
    const options = eligibleCountries(data, level + 1, done);
    const country = options.some((x) => x.code === route[level]) ? route[level] : options[0].code;
    // Essayer les meilleurs hubs du pays suivant sur des copies.
    let bestNext: { hub: string; st: Strategy; profit: number } | null = null;
    for (const hub of candidateHubs(country, level + 1, LEVELS[level].capital)) {
      const trial = clone(ctx);
      const choice: LevelChoice = { country, hub, perks: picks };
      if (!nextLevel(trial, t, choice).ok) continue;
      const p = bestStrategy(trial, t);
      if (!bestNext || p.profit > bestNext.profit) bestNext = { hub, ...p };
    }
    if (!bestNext) {
      console.log('  aucun hub possible dans', country);
      return;
    }
    const res = nextLevel(ctx, t, { country, hub: bestNext.hub, perks: picks });
    console.log(`  → ${country}/${bestNext.hub} avec ${picks.join(' + ')} (proposées : ${offer.join(', ')}) : ${res.ok ? 'ok' : res.error}`);
    if (!res.ok) return;
    plan = bestNext;
  }
}

run('calibrage du mode par échelons', () => {
  const days = Number(process.env.DAYS ?? 120);
  it('échelon 1 dans plusieurs pays', { timeout: 900_000 }, () => {
    console.log('\n===== Échelon 1, pays par pays');
    for (const country of (process.env.COUNTRIES ?? 'FR,TZ,IN,US,BR,NO,MA,ID,GR,AU,CO,JP').split(',')) {
      let best: { hub: string; ctx: Ctx; st: Strategy; profit: number } | null = null;
      for (const hub of candidateHubs(country, 1, LEVELS[0].capital, 4)) {
        const trial = newTestGame(hub, country, 'normal', 7, { mode: 'echelons' });
        const p = bestStrategy(trial, T0, 45);
        if (!best || p.profit > best.profit) best = { hub, ctx: trial, ...p };
      }
      if (!best) {
        console.log(`  ${country} : aucun hub`);
        continue;
      }
      const r = play(best.ctx, T0, best.st, days, true);
      const s = best.ctx.state;
      console.log(
        `  ${country}/${best.hub} (${money(s.hubs[0].pricePaid)}) plan ${best.st.n}+ × ~${best.st.seats} sièges, ${best.st.k} l/avion${best.st.used ? ', occ.' : ''} | ${describeFleet(best.ctx)} | aéroports J${r.days.airports ?? '—'} satisf. J${r.days.satisfaction ?? '—'} bénéf. J${r.days.profit ?? '—'} | réussi J${r.cleared ?? '—'} | ${money(r.profit)}, croisière ${money(r.cruise)}/j | caisse ${money(s.cash)}`,
      );
    }
  });
  it('France → Espagne → Italie → Japon → Brésil → États-Unis', { timeout: 900_000 }, () => {
    campaign(['FR', 'ES', 'IT', 'JP', 'BR', 'US'], ['recruit', 'fleet', 'bigger', 'lines', 'quality', 'capital', 'deal'], days);
  });
  it('Tanzanie → Maroc → Norvège → Turquie → Inde → Chine', { timeout: 900_000 }, () => {
    campaign(['TZ', 'MA', 'NO', 'TR', 'IN', 'CN'], ['recruit', 'bigger', 'fleet', 'capital', 'lines', 'deal'], days);
  });
});
