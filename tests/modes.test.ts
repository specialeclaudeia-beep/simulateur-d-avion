/**
 * Tests des modes de jeu : partie libre avec ou sans concurrence, mode par
 * échelons, emplacements de sauvegarde et reprise des anciennes parties.
 */
import { describe, expect, it } from 'vitest';
import * as act from '../src/game/actions';
import {
  LEVELS,
  LINKED_FLIGHTS,
  PERKS,
  eligibleCountries,
  evaluate,
  goalsReached,
  hubsFor,
  levelProfit,
  limits,
  linkedAirports,
  modelProblem,
  nextCapital,
  perkOffer,
  picksAllowed,
  progress,
} from '../src/game/campaign';
import { nextLevel, restartLevel } from '../src/game/campaignFlow';
import { dailyCompetition, demandContext, presentRivals, rivalList, rivalsOn, warOn } from '../src/game/competition';
import { DAY, HOUR, TRAINING_DAYS } from '../src/game/config';
import type { Ctx } from '../src/game/context';
import { marketShare, playerPaxPerDay } from '../src/game/economy';
import { upgradeInfo } from '../src/game/hubs';
import { initialTraining } from '../src/game/pilots';
import { parseSave, serialize, slotOf } from '../src/game/save';
import { advance } from '../src/game/sim';
import { SAVE_VERSION, type GameState } from '../src/game/state';
import { addPilot, newCampaignGame, newTestGame, realData, T0 } from './helpers';

/** Une ligne Nice ⇄ Orly avec un A320neo et son pilote, prête à voler. */
function flying(competition: boolean, seed = 42) {
  const ctx = newTestGame('NCE', 'FR', 'normal', seed, { competition });
  let t = T0;
  expect(act.openLine(ctx, t, 'NCE', 'ORY').ok).toBe(true);
  expect(act.orderAircraft(ctx, t, 'a320neo', 1, 'NCE').ok).toBe(true);
  const ac = ctx.state.aircraft[0];
  t = ac.until! + HOUR;
  advance(ctx, t);
  const pilot = addPilot(ctx, 'A320', 2);
  expect(act.assignPilot(ctx, t, ac.id, pilot.id).ok).toBe(true);
  expect(act.setProgram(ctx, t, ac.id, [ctx.state.lines[0].id]).ok).toBe(true);
  return { ctx, t };
}

describe('sauvegardes et modes', () => {
  it('une partie d’avant les modes de jeu devient une partie libre avec concurrence', () => {
    const ctx = newTestGame();
    const old = JSON.parse(serialize(ctx.state, 1000)) as { version: number; state: Partial<GameState> };
    old.version = 1;
    old.state.version = 1;
    delete old.state.mode;
    delete old.state.competition;
    delete old.state.rivalry;
    delete old.state.campaign;
    const res = parseSave(JSON.stringify(old));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.save.state;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.mode).toBe('libre');
    expect(s.competition).toBe(true);
    expect(s.rivalry).toEqual({});
    expect(s.campaign).toBeNull();
    expect(slotOf(s)).toBe('concurrence');
    // Et elle se joue comme avant.
    expect(s.hubs[0].iata).toBe('NCE');
    expect(s.cash).toBe(ctx.state.cash);
  });

  it('range chaque partie dans l’emplacement de son mode', () => {
    expect(slotOf(newTestGame().state)).toBe('concurrence');
    expect(slotOf(newTestGame('NCE', 'FR', 'normal', 42, { competition: false }).state)).toBe('solo');
    expect(slotOf(newCampaignGame().state)).toBe('echelons');
  });

  it('une partie par échelons se relit à l’identique', () => {
    const ctx = newCampaignGame();
    const res = parseSave(serialize(ctx.state));
    expect(res.ok && res.save.state).toEqual(ctx.state);
  });
});

describe('concurrence', () => {
  it('sans concurrence, le joueur prend presque tous les passagers de la ligne', () => {
    const data = realData();
    const route = data.route('NCE', 'ORY')!;
    const withRivals = flying(true);
    const alone = flying(false);
    const share = (g: ReturnType<typeof flying>) => marketShare(demandContext(g.ctx, g.ctx.state.lines[0], route, 90, 4, g.t));
    expect(rivalsOn(withRivals.ctx.state, route, T0).pax).toBe(route.airlines.length);
    expect(rivalsOn(alone.ctx.state, route, T0).pax).toBeLessThan(0.5);
    expect(share(alone)).toBeGreaterThan(0.75);
    expect(share(alone)).toBeGreaterThan(share(withRivals) * 1.5);
    const pax = (g: ReturnType<typeof flying>) => playerPaxPerDay(demandContext(g.ctx, g.ctx.state.lines[0], route, 90, 4, g.t));
    expect(pax(alone)).toBeGreaterThan(pax(withRivals));
  });

  it('avec concurrence, les rivales bougent au fil des mois sans rien casser', () => {
    const { ctx, t } = flying(true, 5);
    const s = ctx.state;
    for (const dest of ['CDG', 'LYS']) expect(act.openLine(ctx, t, 'NCE', dest).ok).toBe(true);
    expect(act.setProgram(ctx, t, s.aircraft[0].id, s.lines.map((l) => l.id)).ok).toBe(true);
    advance(ctx, t + 500 * DAY);
    // Chaque ligne touchée par un événement garde une trace dans la partie.
    expect(Object.keys(s.rivalry).length).toBeGreaterThan(0);
    const data = realData();
    for (const line of s.lines) {
      const route = data.route(line.hub, line.dest)!;
      const n = presentRivals(s, route).length;
      const w = rivalsOn(s, route, s.time).pax;
      expect(w).toBeGreaterThanOrEqual(n);
      expect(w).toBeLessThan(n + 1);
      for (const r of rivalList(ctx, route, s.time)) expect(r.name.length).toBeGreaterThan(0);
    }
    expect(Number.isFinite(s.cash)).toBe(true);
  });

  /** Force les prochains tirages au hasard (le dernier se répète). */
  function rolls(ctx: Ctx, ...values: number[]): void {
    let i = 0;
    ctx.rng = () => values[Math.min(i++, values.length - 1)];
  }

  it('une guerre des prix prend des passagers au joueur, puis s’arrête', () => {
    const { ctx, t } = flying(true);
    const s = ctx.state;
    const data = realData();
    const line = s.lines[0];
    const route = data.route(line.hub, line.dest)!;
    advance(ctx, t + 12 * DAY); // la ligne s'installe
    expect(line.stats.flights).toBeGreaterThan(40);
    s.rivalry = {}; // on repart d'une ligne où rien n'a encore bougé
    const now = s.time;
    const before = playerPaxPerDay(demandContext(ctx, line, route, 90, 4, now));
    rolls(ctx, 0.001, 0, 0.5);
    dailyCompetition(ctx, now);
    const war = warOn(s, route, now)!;
    expect(war).not.toBeNull();
    expect(route.airlines).toContain(war.airline);
    expect(war.until - now).toBeGreaterThanOrEqual(14 * DAY);
    expect(war.until - now).toBeLessThanOrEqual(35 * DAY);
    expect(s.log[0].text).toMatch(/Guerre des prix/);
    expect(playerPaxPerDay(demandContext(ctx, line, route, 90, 4, now))).toBeLessThan(before);
    expect(rivalList(ctx, route, now).filter((r) => r.status === 'war')).toHaveLength(1);
    // La guerre finie, tout redevient comme avant.
    rolls(ctx, 0.9);
    dailyCompetition(ctx, war.until + DAY);
    expect(warOn(s, route, war.until + DAY)).toBeNull();
    expect(s.log[0].text).toMatch(/arrête sa guerre des prix/);
    expect(playerPaxPerDay(demandContext(ctx, line, route, 90, 4, war.until + DAY))).toBeCloseTo(before, 6);
  });

  it('une rivale arrive sur une ligne presque sans concurrent, une autre renonce face à un joueur apprécié', () => {
    const { ctx, t } = flying(true);
    const s = ctx.state;
    const data = realData();
    const line = s.lines[0];
    const route = data.route(line.hub, line.dest)!;
    const key = `${[line.hub, line.dest].sort().join('-')}`;
    advance(ctx, t + 12 * DAY);
    const now = s.time;
    expect(route.airlines.length).toBeGreaterThanOrEqual(2);

    // Départ : deux rivales au moins, joueur apprécié et bien installé.
    s.rivalry[key] = { entrants: [], gone: route.airlines.slice(2), war: null };
    s.reputation = 85;
    expect(presentRivals(s, route)).toHaveLength(2);
    rolls(ctx, 0.03, 0);
    dailyCompetition(ctx, now);
    expect(presentRivals(s, route)).toHaveLength(1);
    expect(s.log[0].text).toMatch(/abandonne la ligne/);
    expect(rivalList(ctx, route, now).some((r) => r.status === 'gone')).toBe(true);

    // Arrivée : le joueur est presque seul et ses avions sont pleins.
    line.month = { ...line.month, seats: 1000, pax: 900 };
    rolls(ctx, 0.012, 0.3);
    dailyCompetition(ctx, now + DAY);
    expect(s.rivalry[key].entrants).toHaveLength(1);
    expect(presentRivals(s, route)).toHaveLength(2);
    expect(s.log[0].text).toMatch(/ouvre à son tour/);
    expect(route.airlines).not.toContain(s.rivalry[key].entrants[0]);
    expect(rivalList(ctx, route, now + DAY).filter((r) => r.status === 'new')).toHaveLength(1);
  });

  it('sans concurrence, rien ne bouge sur les lignes', () => {
    const { ctx, t } = flying(false, 5);
    advance(ctx, t + 300 * DAY);
    expect(ctx.state.rivalry).toEqual({});
    expect(ctx.state.log.some((e) => /Guerre des prix/.test(e.text))).toBe(false);
  });
});

describe('mode par échelons', () => {
  it('commence petit : capital réduit, objectifs et limites de l’échelon 1', () => {
    const ctx = newCampaignGame();
    const s = ctx.state;
    const c = s.campaign!;
    expect(s.mode).toBe('echelons');
    expect(s.competition).toBe(true);
    expect(c.level).toBe(1);
    expect(s.cash).toBeLessThan(LEVELS[0].capital);
    expect(s.cash + s.hubs[0].pricePaid).toBe(LEVELS[0].capital);
    expect(c.goals).toEqual({ airports: 3, satisfaction: LEVELS[0].satisfaction, profit: LEVELS[0].profit });
    const lim = limits(s)!;
    expect(lim).toMatchObject({ fleet: 2, lines: 3, hubs: 1, cargo: false, recruit: false, intl: false });
    expect(progress(ctx, T0).map((g) => g.id)).toEqual(['airports', 'satisfaction', 'profit']);
    // La partie libre, elle, n'a aucune limite.
    expect(limits(newTestGame().state)).toBeNull();
  });

  it('refuse ce que l’échelon n’autorise pas encore', () => {
    const ctx = newCampaignGame();
    const s = ctx.state;
    const data = realData();
    const t = T0;
    // Avions : hélices seulement, pas de cargo, deux avions au plus.
    expect(act.orderAircraft(ctx, t, 'a320neo', 1, 'SXB')).toMatchObject({ ok: false });
    expect(modelProblem(s, data.model('a320neo'))).toMatch(/pas encore autorisée/);
    expect(modelProblem(s, data.model('atr72-600f'))).toMatch(/fret/i);
    expect(modelProblem(s, data.model('atr72-600'))).toBeNull();
    s.cash = 500e6; // de quoi payer : seules les règles de l'échelon doivent bloquer
    expect(act.orderAircraft(ctx, t, 'atr72-600', 3, 'SXB')).toMatchObject({ ok: false });
    expect(act.orderAircraft(ctx, t, 'atr72-600', 2, 'SXB').ok).toBe(true);
    expect(act.orderAircraft(ctx, t, 'atr42-600', 1, 'SXB')).toMatchObject({ ok: false });
    // Le marché de l'occasion ne propose que des avions autorisés.
    expect(s.market.used.length).toBeGreaterThan(0);
    for (const l of s.market.used) expect(modelProblem(s, data.model(l.modelId))).toBeNull();
    // Lignes : dans le pays seulement, trois au plus.
    const abroad = data.routesFrom('SXB').map((r) => (r.a === 'SXB' ? r.b : r.a)).find((d) => data.airport(d).country !== 'FR')!;
    expect(act.openLine(ctx, t, 'SXB', abroad)).toMatchObject({ ok: false });
    const home = data.routesFrom('SXB').map((r) => (r.a === 'SXB' ? r.b : r.a)).filter((d) => data.airport(d).country === 'FR');
    while (s.hubs[0].lineSlots < 4) expect(act.upgradeHub(ctx, t, 'SXB', 'lineSlots').ok).toBe(true);
    for (const d of home.slice(0, 3)) expect(act.openLine(ctx, t, 'SXB', d).ok).toBe(true);
    const fourth = act.openLine(ctx, t, 'SXB', home[3]);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.error).toMatch(/limité à 3/);
    // Hubs : un seul, et dans le pays.
    expect(act.buyHub(ctx, t, 'LIL')).toMatchObject({ ok: false });
    expect(act.buyHub(ctx, t, 'GVA')).toMatchObject({ ok: false });
    // Qualité du hub et atelier plafonnés.
    expect(act.upgradeHub(ctx, t, 'SXB', 'quality').ok).toBe(true);
    const capped = act.upgradeHub(ctx, t, 'SXB', 'quality');
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.error).toMatch(/échelon/);
    expect(upgradeInfo(data, s.hubs[0], 'quality', limits(s))).toBeNull();
    expect(upgradeInfo(data, s.hubs[0], 'quality')).not.toBeNull();
  });

  it('donne un pilote fondateur, et forme les suivants plus vite faute de pouvoir recruter', () => {
    const ctx = newCampaignGame();
    const s = ctx.state;
    expect(s.pilots).toHaveLength(0);
    s.cash = 100e6;
    expect(act.orderAircraft(ctx, T0, 'atr72-600', 1, 'SXB').ok).toBe(true);
    expect(s.pilots).toHaveLength(1);
    expect(s.pilots[0].ratings).toEqual(['ATR']);
    expect(s.pilots[0].stars).toBe(2);
    // Pas de second pilote offert, pas de recrutement.
    expect(act.orderAircraft(ctx, T0, 'atr72-600', 1, 'SXB').ok).toBe(true);
    expect(s.pilots).toHaveLength(1);
    const cand = s.market.pilots[0];
    const hire = act.hirePilot(ctx, T0, cand.id);
    expect(hire.ok).toBe(false);
    if (!hire.ok) expect(hire.error).toContain(PERKS.recruit.title);
    // Formation deux fois plus rapide qu'en partie libre.
    expect(initialTraining(realData(), s).days).toBe(TRAINING_DAYS / 2);
    expect(initialTraining(realData(), newTestGame().state).days).toBe(TRAINING_DAYS);
    expect(act.trainNewPilot(ctx, T0, 'ATR').ok).toBe(true);
    advance(ctx, T0 + (TRAINING_DAYS / 2) * DAY + HOUR);
    expect(s.pilots[1].training).toBeNull();
    expect(s.pilots[1].ratings).toEqual(['ATR']);
  });

  /** Joue l'échelon 1 jusqu'à ce qu'il soit réussi (deux avions d'occasion, trois lignes). */
  function clearedLevel1(seed = 42) {
    const ctx = newCampaignGame('SXB', 'FR', seed);
    const s = ctx.state;
    const data = realData();
    let t = T0;
    const dests = data
      .routesFrom('SXB')
      .filter((r) => data.airport(r.a === 'SXB' ? r.b : r.a).country === 'FR')
      .sort((a, b) => b.demand - a.demand)
      .slice(0, 3)
      .map((r) => (r.a === 'SXB' ? r.b : r.a));
    for (const d of dests) expect(act.openLine(ctx, t, 'SXB', d).ok).toBe(true);
    expect(act.orderAircraft(ctx, t, 'atr72-600', 1, 'SXB').ok).toBe(true);
    const ac = s.aircraft[0];
    t = ac.until! + HOUR;
    advance(ctx, t);
    expect(act.assignPilot(ctx, t, ac.id, s.pilots[0].id).ok).toBe(true);
    expect(act.setProgram(ctx, t, ac.id, s.lines.map((l) => l.id)).ok).toBe(true);
    expect(act.upgradeHub(ctx, t, 'SXB', 'quality').ok).toBe(true);
    for (let d = 0; d < 200 && !s.campaign!.cleared; d++) {
      t += DAY;
      advance(ctx, t);
    }
    return { ctx, t };
  }

  it('compte les aéroports reliés et ouvre le pays suivant à deux objectifs sur trois', () => {
    const { ctx, t } = clearedLevel1();
    const s = ctx.state;
    const c = s.campaign!;
    expect(c.cleared).toBe(true);
    expect(goalsReached(c)).toBeGreaterThanOrEqual(2);
    expect(c.reached.airports).toBe(true);
    expect(linkedAirports(ctx).size).toBe(4); // le hub et trois destinations
    for (const l of s.lines) expect(l.stats.flights).toBeGreaterThanOrEqual(LINKED_FLIGHTS);
    expect(s.log.some((e) => /Échelon 1 réussi/.test(e.text))).toBe(true);
    // Un objectif atteint reste acquis, même si la situation se dégrade ensuite.
    s.reputation = 10;
    evaluate(ctx, t);
    expect(c.reached.satisfaction || c.reached.profit).toBe(true);
    expect(c.cleared).toBe(true);
  });

  it('change de pays avec une amélioration, en plus grand', () => {
    const { ctx, t } = clearedLevel1();
    const s = ctx.state;
    const c = s.campaign!;
    const data = realData();
    const offer = perkOffer(s);
    expect(offer).toHaveLength(3);
    expect(offer).toContain('recruit');
    expect(perkOffer(s)).toEqual(offer); // le tirage ne change pas d'un appel à l'autre
    const picks = offer.slice(0, picksAllowed(c));
    const countries = eligibleCountries(data, 2, ['FR']);
    expect(countries.some((x) => x.code === 'ES')).toBe(true);
    expect(countries.some((x) => x.code === 'FR')).toBe(false);
    const hub = hubsFor(data, 'ES', 2).filter((a) => a.price < 20e6)[0].iata;
    const capital = nextCapital(s, picks);
    const profit = levelProfit(s);
    const best = [...s.pilots].sort((a, b) => b.hours - a.hours)[0];

    // Refus : pays déjà joué, mauvaise amélioration, hub trop mal relié.
    expect(nextLevel(ctx, t, { country: 'FR', hub: 'LIL', perks: picks })).toMatchObject({ ok: false });
    expect(nextLevel(ctx, t, { country: 'ES', hub, perks: [] })).toMatchObject({ ok: false });
    expect(c.level).toBe(1);

    const res = nextLevel(ctx, t, { country: 'ES', hub, perks: picks });
    expect(res).toMatchObject({ ok: true });
    expect(c.level).toBe(2);
    expect(c.perks).toEqual(picks);
    expect(c.done).toHaveLength(1);
    expect(c.done[0]).toMatchObject({ country: 'FR', level: 1 });
    expect(c.done[0].profit).toBe(Math.round(profit));
    expect(c.cleared).toBe(false);
    expect(c.reached).toEqual({ airports: false, satisfaction: false, profit: false });
    expect(s.company.country).toBe('ES');
    expect(s.hubs.map((h) => h.iata)).toEqual([hub]);
    expect(s.aircraft).toHaveLength(0);
    expect(s.lines).toHaveLength(0);
    expect(s.debt).toBe(0);
    expect(s.cash + s.hubs[0].pricePaid).toBe(capital);
    expect(capital).toBeGreaterThanOrEqual(LEVELS[1].capital);
    expect(c.goals.airports).toBe(5);
    // Le meilleur pilote suit la compagnie.
    expect(s.pilots.map((p) => p.id)).toEqual([best.id]);
    expect(s.pilots[0].aircraftId).toBeNull();
    // Les limites ont grandi, et l'amélioration choisie s'applique.
    const lim = limits(s)!;
    expect(lim.fleet).toBeGreaterThanOrEqual(4);
    expect(lim.recruit).toBe(picks.includes('recruit'));
    expect(act.orderAircraft(ctx, t, 'e175', 1, hub).ok || modelProblem(s, data.model('e175')) === null).toBe(true);
  });

  it('recommence l’échelon après une faillite, avec le même capital', () => {
    const ctx = newCampaignGame();
    const s = ctx.state;
    const c = s.campaign!;
    expect(act.orderAircraft(ctx, T0, 'atr72-600', 1, 'SXB').ok).toBe(true);
    s.cash = -5e6;
    advance(ctx, T0 + 70 * DAY);
    expect(s.bankrupt).toBe(true);
    const res = restartLevel(ctx, s.time);
    expect(res).toMatchObject({ ok: true });
    expect(s.bankrupt).toBe(false);
    expect(c.level).toBe(1);
    expect(s.aircraft).toHaveLength(0);
    expect(s.cash + s.hubs[0].pricePaid).toBe(c.capital);
    expect(s.hubs[0].iata).toBe('SXB');
    // La partie repart vraiment.
    advance(ctx, s.time + 3 * DAY);
    expect(s.bankrupt).toBe(false);
  });

  it('propose des pays pour chaque échelon, de plus en plus grands', () => {
    const data = realData();
    let previous = Infinity;
    for (let level = 1; level <= LEVELS.length; level++) {
      const list = eligibleCountries(data, level);
      expect(list.length).toBeGreaterThan(8);
      expect(list.length).toBeLessThanOrEqual(previous);
      previous = list.length;
      for (const c of list.slice(0, 5)) expect(hubsFor(data, c.code, level).length).toBeGreaterThan(0);
    }
    expect(eligibleCountries(data, 1).some((c) => c.code === 'FR')).toBe(true);
  });

  it('le dernier échelon réussi termine la campagne et lève toutes les limites', () => {
    const ctx = newCampaignGame();
    const s = ctx.state;
    const c = s.campaign!;
    c.level = LEVELS.length;
    c.goals = { airports: 1, satisfaction: 10, profit: 1e12 };
    evaluate(ctx, T0 + DAY);
    expect(c.cleared).toBe(true);
    expect(c.finished).toBe(true);
    expect(limits(s)).toBeNull();
    expect(c.done[c.done.length - 1]).toMatchObject({ country: 'FR', level: LEVELS.length });
    expect(nextLevel(ctx, T0 + DAY, { country: 'ES', hub: 'MAD', perks: [] })).toMatchObject({ ok: false });
  });
});
