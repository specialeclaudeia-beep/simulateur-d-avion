/**
 * Tests du moteur de jeu, sur les vraies données.
 */
import { describe, expect, it } from 'vitest';
import * as act from '../src/game/actions';
import { DAY, HOUR } from '../src/game/config';
import { YEAR, marketValue } from '../src/game/economy';
import { generateUsedListings, orderQuote } from '../src/game/fleet';
import { playerFlights, setFlightSource } from '../src/game/flights';
import { upgradeInfo } from '../src/game/hubs';
import { dailySeries, summarize } from '../src/game/ledger';
import { GameClock } from '../src/core/clock';
import { familyMinStars } from '../src/game/pilots';
import { parseSave, serialize } from '../src/game/save';
import { advance } from '../src/game/sim';
import { suggestCode } from '../src/game/newGame';
import { addPilot, newTestGame, realData, T0 } from './helpers';

/** Partie prête à voler : 1 A320neo livré, un pilote, une ligne Nice ⇄ Paris-Orly. */
function readyGame(seed = 42) {
  const ctx = newTestGame('NCE', 'FR', 'normal', seed);
  let t = T0;
  expect(act.openLine(ctx, t, 'NCE', 'ORY').ok).toBe(true);
  expect(act.orderAircraft(ctx, t, 'a320neo', 1, 'NCE').ok).toBe(true);
  const ac = ctx.state.aircraft[0];
  t = ac.until! + HOUR;
  advance(ctx, t);
  expect(ac.status).toBe('idle');
  const pilot = addPilot(ctx, 'A320', 2);
  expect(act.assignPilot(ctx, t, ac.id, pilot.id).ok).toBe(true);
  expect(act.setProgram(ctx, t, ac.id, [ctx.state.lines[0].id]).ok).toBe(true);
  return { ctx, ac, pilot, t };
}

describe('données', () => {
  it('estime une demande plausible sur les grandes lignes', () => {
    const data = realData();
    const cdgJfk = data.route('CDG', 'JFK')!;
    expect(cdgJfk.demand).toBeGreaterThan(1000);
    expect(cdgJfk.demand).toBeLessThan(10000);
    expect(data.routesFrom('NCE').length).toBeGreaterThan(50);
    expect(data.playableCountries().find((c) => c.code === 'FR')).toBeTruthy();
  });
});

describe('nouvelle partie', () => {
  it('achète le premier hub et prépare les marchés', () => {
    const ctx = newTestGame('NCE');
    const s = ctx.state;
    const nce = realData().airport('NCE');
    expect(s.hubs).toHaveLength(1);
    expect(s.cash).toBe(300_000_000 - nce.price);
    expect(s.market.used.length).toBeGreaterThan(0);
    expect(s.market.pilots.length).toBeGreaterThan(0);
    expect(summarize(s.ledger).invest).toBe(nce.price);
  });

  it('propose un code à partir du nom', () => {
    expect(suggestCode('Air Breizh')).toBe('AB');
    expect(suggestCode('Émeraude')).toBe('EM');
  });

  it('refuse un hub trop cher', () => {
    expect(() => newTestGame('CDG', 'FR', 'difficile')).toThrow(/Pas assez d'argent/);
  });
});

describe('vols', () => {
  it('fait voler un avion, encaisse les billets et expose le vol à la carte', () => {
    const { ctx, ac, t } = readyGame();
    setFlightSource(() => ctx.state);
    // On avance jusqu'à trouver l'avion en vol.
    let now = t;
    while (ac.status !== 'flying' && now < t + 2 * DAY) {
      now += 10 * 60_000;
      advance(ctx, now);
    }
    expect(ac.status).toBe('flying');
    const leg = ac.leg!;
    expect(leg.pax).toBeGreaterThan(0);
    expect(leg.pax).toBeLessThanOrEqual(165);
    const mid = (leg.dep + leg.arr) / 2;
    const flights = playerFlights(mid);
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ airline: 'player', airlineName: 'Air Test', player: true, aircraftId: 'a320neo', ref: ac.id, from: leg.from, to: leg.to });
    expect(playerFlights(leg.arr + 1)).toHaveLength(0);

    advance(ctx, now + 3 * DAY);
    expect(ctx.state.stats.flights).toBeGreaterThan(5);
    expect(ctx.state.ledger.entries.tickets ?? 0).toBeGreaterThan(0);
    expect(ctx.state.lines[0].stats.pax).toBeGreaterThan(0);
    expect(ac.condition).toBeLessThan(100);
    setFlightSource(() => null);
  });

  it('ne fait décoller les avions du hub qu’entre 5 h 30 et 23 h (heure locale)', () => {
    const { ctx, ac, t } = readyGame();
    const deps: number[] = [];
    let last = '';
    for (let now = t; now < t + 3 * DAY; now += 5 * 60_000) {
      advance(ctx, now);
      if (ac.status === 'flying' && ac.leg!.id !== last) {
        last = ac.leg!.id;
        if (ac.leg!.from === 'NCE') deps.push(ac.leg!.dep);
      }
    }
    expect(deps.length).toBeGreaterThan(5);
    for (const d of deps) {
      const local = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).format(d);
      const [h, m] = local.split(':').map(Number);
      const minutes = h * 60 + m;
      expect(minutes).toBeGreaterThanOrEqual(5 * 60 + 30);
      expect(minutes).toBeLessThan(23 * 60);
    }
  });

  it('est reproductible avec la même graine', () => {
    const a = readyGame(7);
    const b = readyGame(7);
    advance(a.ctx, a.t + 20 * DAY);
    advance(b.ctx, b.t + 20 * DAY);
    expect(a.ctx.state.cash).toBe(b.ctx.state.cash);
    expect(a.ctx.state.stats).toEqual(b.ctx.state.stats);
  });

  it('simule une année entière rapidement et sans valeur aberrante', () => {
    const { ctx, t } = readyGame();
    const start = performance.now();
    advance(ctx, t + 365 * DAY);
    expect(performance.now() - start).toBeLessThan(3000);
    expect(Number.isFinite(ctx.state.cash)).toBe(true);
    expect(ctx.state.history.length).toBeGreaterThanOrEqual(11);
    expect(ctx.state.history.length).toBeLessThanOrEqual(13);
  });
});

describe('pannes et maintenance', () => {
  it('une panne immobilise l’avion jusqu’à sa réparation', () => {
    const { ctx, ac, t } = readyGame();
    ac.condition = 0; // usé jusqu'à la corde : la panne est presque certaine
    ctx.state.settings.autoMaintenance = false;
    let now = t;
    while (ac.status !== 'broken' && now < t + 10 * DAY) {
      now += 30 * 60_000;
      advance(ctx, now);
    }
    expect(ac.status).toBe('broken');
    expect(ac.breakdown).not.toBeNull();
    advance(ctx, now + 2 * DAY);
    expect(ac.status).toBe('broken'); // rien ne bouge sans réparation
    const cash = ctx.state.cash;
    const r = act.repairAircraft(ctx, now + 2 * DAY, ac.id);
    expect(r.ok).toBe(true);
    expect(ctx.state.cash).toBeLessThan(cash);
    expect(ac.status).toBe('repair');
    advance(ctx, now + 6 * DAY);
    expect(ac.breakdown).toBeNull();
    expect(['flying', 'ground', 'idle', 'maintenance']).toContain(ac.status);
  });

  it('la révision remet l’avion à neuf', () => {
    const ctx = newTestGame('NCE');
    act.orderAircraft(ctx, T0, 'a320neo', 1, 'NCE');
    const ac = ctx.state.aircraft[0];
    const t = ac.until! + HOUR;
    advance(ctx, t);
    expect(ac.status).toBe('idle');
    ac.condition = 70;
    expect(act.maintainAircraft(ctx, t, ac.id).ok).toBe(true);
    expect(ac.status).toBe('maintenance');
    advance(ctx, t + 2 * DAY);
    expect(ac.condition).toBe(100);
  });
});

describe('règles', () => {
  it('vérifie la qualification du pilote', () => {
    const { ctx, ac } = readyGame();
    const p = addPilot(ctx, '737', 3);
    const r = act.assignPilot(ctx, T0, ac.id, p.id);
    expect(r.ok).toBe(false);
  });

  it('exige un pilote expérimenté pour un gros-porteur', () => {
    const ctx = newTestGame('NCE', 'FR', 'facile');
    act.orderAircraft(ctx, T0, 'a350-900', 1, 'NCE');
    const ac = ctx.state.aircraft[0];
    advance(ctx, ac.until! + 1);
    const junior = addPilot(ctx, 'A350', 1);
    expect(act.assignPilot(ctx, ac.until! + 1, ac.id, junior.id).ok).toBe(false);
    const senior = addPilot(ctx, 'A350', 3);
    expect(act.assignPilot(ctx, ac.until! + 1, ac.id, senior.id).ok).toBe(true);
  });

  it('limite les départs par le nombre de portes du hub', () => {
    const ctx = newTestGame('NCE', 'FR', 'facile');
    const t = T0;
    for (const d of ['ORY', 'CDG', 'LYS']) act.openLine(ctx, t, 'NCE', d);
    act.orderAircraft(ctx, t, 'atr72-600', 4, 'NCE');
    advance(ctx, t + 10 * DAY);
    const hub = ctx.state.hubs[0];
    hub.gates = 1; // 8 départs par jour seulement
    const results = ctx.state.aircraft.map((ac) => {
      const p = addPilot(ctx, 'ATR', 2);
      act.assignPilot(ctx, t + 10 * DAY, ac.id, p.id);
      return act.setProgram(ctx, t + 10 * DAY, ac.id, [ctx.state.lines[0].id]);
    });
    expect(results.some((r) => !r.ok && /portes/.test(r.error))).toBe(true);
  });

  it('les licences de lignes limitent les ouvertures', () => {
    const ctx = newTestGame('NCE');
    const hub = ctx.state.hubs[0];
    const dests = realData()
      .routesFrom('NCE')
      .map((r) => (r.a === 'NCE' ? r.b : r.a));
    let opened = 0;
    for (const d of dests.slice(0, hub.lineSlots + 1)) if (act.openLine(ctx, T0, 'NCE', d).ok) opened++;
    expect(opened).toBe(hub.lineSlots);
    const info = upgradeInfo(realData(), hub, 'lineSlots')!;
    expect(act.upgradeHub(ctx, T0, 'NCE', 'lineSlots').ok).toBe(true);
    expect(hub.lineSlots).toBe(info.next);
  });

  it('applique les remises de volume et respecte la date de mise en service', () => {
    const ctx = newTestGame('NCE', 'FR', 'facile');
    const data = realData();
    const one = orderQuote(data, ctx.state, data.model('a320neo'), 1, T0);
    const ten = orderQuote(data, ctx.state, data.model('a320neo'), 10, T0);
    expect(ten.unitPrice).toBeLessThan(one.unitPrice);
    const b7779 = orderQuote(data, ctx.state, data.model('b777-9'), 1, T0);
    expect(b7779.deliveries[0]).toBeGreaterThanOrEqual(Date.UTC(2027, 0, 1));
    expect(act.orderAircraft(ctx, T0, 'a380', 1, 'NCE').ok).toBe(false); // plus fabriqué
  });

  it('les modèles plus fabriqués se trouvent seulement d’occasion, à un prix cohérent', () => {
    const ctx = newTestGame();
    const ceo = ctx.data.model('a320ceo');
    expect(ceo.inProduction).toBe(false);
    expect(act.orderAircraft(ctx, T0, 'a320ceo', 1, 'NCE').ok).toBe(false);
    // Le prix des données est celui d'un exemplaire de 12 ans à 75 %.
    expect(Math.abs(marketValue(ctx.data, ceo, 12, 75) - ceo.priceUsd)).toBeLessThan(1);
    const listings = generateUsedListings(ctx, T0, 300);
    const old = listings.filter((l) => !ctx.data.model(l.modelId).inProduction);
    expect(old.length).toBeGreaterThan(0);
    for (const l of old) expect(T0 - l.builtAt).toBeGreaterThanOrEqual(4 * YEAR - 1);
    for (const l of listings) expect(l.price).toBeGreaterThan(0);
  });

  it('un pilote qualifié se présente dès le premier avion d’un nouveau type', () => {
    const ctx = newTestGame('NCE', 'FR', 'facile');
    const s = ctx.state;
    // Aucun candidat qualifié A350 (gros-porteur : 2 étoiles minimum) sur le marché.
    s.market.pilots = s.market.pilots.filter((c) => !c.ratings.includes('A350'));
    expect(act.orderAircraft(ctx, T0, 'a350-900', 1, 'NCE').ok).toBe(true);
    const fit = s.market.pilots.filter((c) => c.ratings.includes('A350'));
    expect(fit).toHaveLength(1);
    expect(fit[0].stars).toBeGreaterThanOrEqual(familyMinStars(ctx.data.families.get('A350')!));
    expect(familyMinStars(ctx.data.families.get('A350')!)).toBe(2);
    // Un deuxième avion du même type n'en ajoute pas d'autre.
    expect(act.orderAircraft(ctx, T0, 'a350-900', 1, 'NCE').ok).toBe(true);
    expect(s.market.pilots.filter((c) => c.ratings.includes('A350'))).toHaveLength(1);
    // Les candidats tirés au hasard ne sont jamais qualifiés sur un avion qu'ils n'auraient pas le droit de piloter.
    for (const c of s.market.pilots) for (const r of c.ratings) expect(c.stars).toBeGreaterThanOrEqual(familyMinStars(ctx.data.families.get(r)!));
  });

  it('forme un pilote et le qualifie', () => {
    const ctx = newTestGame('NCE');
    expect(act.trainNewPilot(ctx, T0, 'A320').ok).toBe(true);
    const p = ctx.state.pilots[0];
    expect(p.training).not.toBeNull();
    advance(ctx, T0 + 25 * DAY);
    expect(p.training).toBeNull();
    expect(p.ratings).toContain('A320');
    expect(act.trainNewPilot(ctx, T0 + 25 * DAY, 'A350').ok).toBe(false); // un débutant ne commence pas sur gros-porteur
  });

  it('emprunte dans la limite autorisée et rembourse', () => {
    const ctx = newTestGame('NCE');
    const max = act.loanCapacity(ctx, T0);
    expect(max).toBeGreaterThan(0);
    expect(act.borrow(ctx, T0, max + 1_000_000).ok).toBe(false);
    expect(act.borrow(ctx, T0, 10_000_000).ok).toBe(true);
    expect(ctx.state.debt).toBe(10_000_000);
    expect(act.repay(ctx, T0, 4_000_000).ok).toBe(true);
    expect(ctx.state.debt).toBe(6_000_000);
  });

  it('calcule l’impôt du mois sur le bénéfice, après report des pertes', () => {
    const ctx = newTestGame('NCE');
    const s = ctx.state;
    s.ledger.entries = { tickets: 10_000_000, fuel: 4_000_000 };
    s.taxLossCarry = 1_000_000;
    advance(ctx, s.nextMonth + 1);
    const closed = s.history[s.history.length - 1];
    const profit = summarize(closed).profitBeforeTax;
    expect(closed.entries.tax).toBeCloseTo((profit - 1_000_000) * 0.25, 0);
    expect(s.taxLossCarry).toBe(0);
  });

  it('le temps de jeu continue à faire tourner l’économie (salaires quotidiens)', () => {
    const ctx = newTestGame('NCE');
    addPilot(ctx, 'A320', 2);
    const cash = ctx.state.cash;
    advance(ctx, T0 + 10 * DAY);
    expect(ctx.state.cash).toBeLessThan(cash);
    expect(ctx.state.ledger.entries.salaries ?? 0).toBeGreaterThan(0);
  });
});

describe('sauvegarde', () => {
  it('relit exactement la partie enregistrée', () => {
    const { ctx, t } = readyGame();
    advance(ctx, t + 5 * DAY);
    const res = parseSave(serialize(ctx.state));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.save.state).toEqual(JSON.parse(JSON.stringify(ctx.state)));
  });

  it('refuse un fichier qui n’est pas une sauvegarde', () => {
    expect(parseSave('pas du json').ok).toBe(false);
    expect(parseSave('{"format":"autre"}').ok).toBe(false);
    expect(parseSave(JSON.stringify({ format: 'simulateur-compagnie-aerienne', version: 99, state: {} })).ok).toBe(false);
  });

  it('complète les réglages manquants d’une ancienne sauvegarde', () => {
    const ctx = newTestGame('NCE');
    const raw = JSON.parse(serialize(ctx.state));
    delete raw.state.settings;
    const res = parseSave(JSON.stringify(raw));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.save.state.settings.autoMaintenance).toBe(true);
  });
});

describe('graphiques jour par jour', () => {
  it('relève chaque jour du mois et retombe sur le total du mois', () => {
    const { ctx, t } = readyGame();
    advance(ctx, t + 40 * DAY);
    const nov = ctx.state.history.find((m) => m.month === '2026-11')!;
    const days = dailySeries(nov);
    expect(days.map((d) => d.d)).toEqual(Array.from({ length: 30 - 8 + 1 }, (_, i) => 8 + i));
    const sum = (k: 'flights' | 'pax' | 'profit') => days.reduce((a, d) => a + d[k], 0);
    expect(sum('flights')).toBe(nov.flights);
    expect(sum('pax')).toBe(nov.pax);
    expect(sum('profit')).toBeCloseTo(summarize(nov).profit, 2);
    expect(days[days.length - 1].cash).toBeCloseTo(nov.cashEnd!, 2);
    // Mois en cours : les jours finis + la journée en cours.
    const today = new Date(ctx.state.time).getUTCDate();
    const dec = dailySeries(ctx.state.ledger, { d: today, cash: ctx.state.cash });
    expect(dec[dec.length - 1].d).toBe(today);
    expect(dec.reduce((a, d) => a + d.flights, 0)).toBe(ctx.state.ledger.flights);
  });
});

describe('horloge', () => {
  it('« Maintenant » ne fait jamais reculer le temps du jeu', () => {
    const ahead = Date.now() + 30 * DAY;
    const clock = new GameClock(ahead, 10000);
    clock.resetToRealTime();
    expect(clock.now()).toBeGreaterThanOrEqual(ahead);
    expect(clock.speed).toBe(1);
    const behind = new GameClock(Date.now() - DAY, 0);
    expect(behind.behindRealTime).toBe(true);
    behind.resetToRealTime();
    expect(Math.abs(behind.now() - Date.now())).toBeLessThan(5000);
  });
});
