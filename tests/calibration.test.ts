/**
 * Calibrage de l'économie (lancé seulement avec CALIB=1) : affiche les
 * résultats de quelques compagnies types sur 3 mois.
 */
import { describe, it } from 'vitest';
import { DAY } from '../src/game/config';
import * as act from '../src/game/actions';
import { advance } from '../src/game/sim';
import { summarize, LEDGER_LABEL, money } from '../src/game/ledger';
import { addPilot, newTestGame, T0 } from './helpers';
import type { Ctx } from '../src/game/context';

const run = process.env.CALIB ? describe : describe.skip;

function report(ctx: Ctx, label: string) {
  const s = ctx.state;
  console.log(`\n===== ${label} — trésorerie ${money(s.cash)}, réputation ${s.reputation.toFixed(1)}`);
  for (const m of [...s.history, s.ledger]) {
    const sum = summarize(m);
    const parts = Object.entries(m.entries)
      .map(([k, v]) => `${LEDGER_LABEL[k as keyof typeof LEDGER_LABEL]}=${money(v!)}`)
      .join(' | ');
    console.log(`${m.month}: vols ${m.flights}, pax ${m.pax}, CA ${money(sum.revenue)}, charges ${money(sum.opex)}, résultat ${money(sum.profit)}\n   ${parts}`);
  }
  for (const l of s.lines) {
    const st = l.stats;
    const lf = st.seats ? st.pax / st.seats : st.capT ? st.cargoT / st.capT : 0;
    console.log(`  ligne ${l.hub}-${l.dest} ${l.km} km: vols ${st.flights}, remplissage ${(lf * 100).toFixed(0)} %, recettes ${money(st.revenue)}, coûts ${money(st.costs)}, marge ${(((st.revenue - st.costs) / Math.max(1, st.revenue)) * 100).toFixed(0)} %`);
  }
  for (const ac of s.aircraft) {
    console.log(`  avion ${ac.registration} ${ac.modelId} état ${ac.condition.toFixed(0)} vols ${ac.stats.flights} recettes ${money(ac.stats.revenue)} coûts ${money(ac.stats.costs)} statut ${ac.status}`);
  }
  console.log('  journal :', s.log.slice(0, 8).map((e) => e.text).join(' / '));
}

function scenario(hub: string, country: string, model: string, family: string, dests: string[], perAircraft: number, nAircraft: number, days = 92) {
  const ctx = newTestGame(hub, country, 'facile');
  ctx.state.settings.autoRepair = true;
  let t = T0;
  for (const d of dests) {
    const r = act.openLine(ctx, t, hub, d);
    if (!r.ok) {
      act.upgradeHub(ctx, t, hub, 'lineSlots');
      const r2 = act.openLine(ctx, t, hub, d);
      if (!r2.ok) console.log('ligne refusée', d, r2.error);
    }
  }
  for (let i = 0; i < 4; i++) act.upgradeHub(ctx, t, hub, 'gates');
  for (let i = 0; i < 3; i++) act.upgradeHub(ctx, t, hub, 'parking');
  const o = act.orderAircraft(ctx, t, model, nAircraft, hub);
  if (!o.ok) console.log('commande refusée', o.error);
  t += 20 * DAY;
  advance(ctx, t);
  const lines = ctx.state.lines;
  ctx.state.aircraft.forEach((ac, i) => {
    const p = addPilot(ctx, family, 3);
    const a = act.assignPilot(ctx, t, ac.id, p.id);
    if (!a.ok) console.log('pilote refusé', a.error);
    const prog = [] as string[];
    for (let k = 0; k < perAircraft; k++) prog.push(lines[(i * perAircraft + k) % lines.length].id);
    const r = act.setProgram(ctx, t, ac.id, [...new Set(prog)]);
    if (!r.ok) console.log('programme refusé', r.error);
  });
  advance(ctx, t + days * DAY);
  return ctx;
}

run('calibrage', () => {
  it('Nice, A320neo, lignes européennes', () => {
    report(scenario('NCE', 'FR', 'a320neo', 'A320', ['CDG', 'ORY', 'LHR', 'AMS', 'FCO', 'BCN', 'GVA', 'BRU'], 2, 4), 'NCE A320');
  });
  it('Nantes, ATR 72, lignes régionales', () => {
    report(scenario('NTE', 'FR', 'atr72-600', 'ATR', ['LYS', 'MRS', 'TLS', 'NCE', 'BOD', 'MPL'], 2, 3), 'NTE ATR');
  });
  it('Nantes, ATR 72 sur 3 lignes chacun', () => {
    report(scenario('NTE', 'FR', 'atr72-600', 'ATR', ['LYS', 'MRS', 'TLS', 'NCE', 'MPL', 'BIQ'], 3, 2), 'NTE ATR 3 lignes');
  });
  it('Nantes, A220-300 sur les plus grosses lignes', () => {
    report(scenario('NTE', 'FR', 'a220-300', 'A220', ['AMS', 'NCE', 'MRS', 'LYS', 'BCN', 'FCO'], 3, 2), 'NTE A220');
  });
  it('Paris CDG, 787-9, long-courrier', () => {
    report(scenario('CDG', 'FR', 'b787-9', '787', ['JFK', 'YUL', 'DXB', 'NRT', 'LAX', 'GRU'], 1, 4), 'CDG 787');
  });
  it('Delhi, A320neo, Inde (pays moins riche)', () => {
    report(scenario('DEL', 'IN', 'a320neo', 'A320', ['BOM', 'BLR', 'CCU', 'HYD', 'MAA', 'GOI'], 2, 3), 'DEL A320');
  });
  it('Francfort, 777F, fret', () => {
    report(scenario('FRA', 'DE', 'b777f', '777', ['JFK', 'ORD', 'HKG', 'PVG'], 1, 2), 'FRA 777F');
  });
});
