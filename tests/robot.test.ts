/** Joueur robot : joue longtemps avec des actions au hasard et vérifie que l'état reste sain. */
import { describe, expect, it } from 'vitest';
import * as act from '../src/game/actions';
import { advance } from '../src/game/sim';
import { DAY, HOUR } from '../src/game/config';
import { parseSave, serialize } from '../src/game/save';
import { makeCtx } from '../src/game/context';
import { nextLevel } from '../src/game/campaignFlow';
import { eligibleCountries, hubsFor } from '../src/game/campaign';
import { newTestGame, T0, realData } from './helpers';

function badNumbers(o: unknown, path = 's', out: string[] = []): string[] {
  if (typeof o === 'number' && !Number.isFinite(o)) out.push(path + '=' + o);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) badNumbers(v, path + '.' + k, out);
  return out;
}

function rnd(seed: number) { let x = seed; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); }

for (const [label, extra] of [
  ['concurrence', { competition: true }],
  ['solo', { competition: false }],
  ['echelons', { mode: 'echelons' as const }],
] as const) {
  describe('robot ' + label, () => {
    for (const seed of [3, 29]) it('joue 3 ans sans état absurde, graine ' + seed, () => {
      const hub = label === 'echelons' ? 'SXB' : 'NCE';
      const ctx = newTestGame(hub, 'FR', 'normal', 7, extra as never);
      ctx.state.settings.crashFrequency = 'frequent';
      const r = rnd(seed);
      let t = T0;
      const msgs: Record<string, number> = {};
      const note = (res: { ok: boolean }, k: string) => { msgs[k + ':' + res.ok] = (msgs[k + ':' + res.ok] ?? 0) + 1; };
      for (let day = 0; day < 1095; day++) {
        const s = ctx.state;
        const hubs = s.hubs.map((h) => h.iata);
        const a = r();
        try {
          if (a < 0.08) {
            const hh = hubs[Math.floor(r() * hubs.length)]; const dests = realData().routesFrom(hh);
            const d = (dests as any[])[Math.floor(r() * (dests as any[]).length)];
            const dest = d ? (d.a === hh ? d.b : d.a) : null;
            if (dest) note(act.openLine(ctx, t, hh, dest), 'openLine');
          } else if (a < 0.14) note(act.orderAircraft(ctx, t, ['a320neo', 'atr72-600', 'e190-e2', 'a220-300'][Math.floor(r() * 4)], 1, hubs[0]), 'order');
          else if (a < 0.2 && s.market.pilots.length) note(act.hirePilot(ctx, t, s.market.pilots[0].id), 'hire');
          else if (a < 0.24 && s.market.used.length) note(act.buyUsed(ctx, t, s.market.used[0].id, hubs[0]), 'used');
          else if (a < 0.4) {
            for (const ac of s.aircraft) {
              if (!ac.pilotId) { const p = s.pilots.find((p) => !p.aircraftId && !p.training); if (p) note(act.assignPilot(ctx, t, ac.id, p.id), 'assign'); }
              if (!ac.program.length && s.lines.length) note(act.setProgram(ctx, t, ac.id, [s.lines[Math.floor(r() * s.lines.length)].id]), 'program');
            }
          } else if (a < 0.42 && s.lines.length) note(act.setLinePrice(ctx, t, s.lines[0].id, 0.7 + r() * 0.8), 'price');
          else if (a < 0.44 && s.aircraft.length > 3) note(act.sellAircraft(ctx, t, s.aircraft[0].id), 'sell');
          else if (a < 0.46) note(act.borrow(ctx, t, 1_000_000), 'borrow');
          else if (a < 0.48) note(act.repay(ctx, t, 500_000), 'repay');
          else if (a < 0.5 && s.lines.length > 4) note(act.closeLine(ctx, t, s.lines[0].id), 'close');
          else if (a < 0.52) note(act.upgradeHub(ctx, t, hubs[0], (['gates', 'lineSlots', 'parking', 'quality', 'maintenance'] as any)[Math.floor(r() * 5)]), 'upgrade');
          else if (a < 0.53 && s.pilots.length > 3) note(act.firePilot(ctx, t, s.pilots[s.pilots.length - 1].id), 'fire');
          else if (a < 0.56 && s.hubs.length < 3) { const c = realData().airportsOfCountry('FR').filter((x) => !hubs.includes(x.iata)); const h = c[Math.floor(r() * Math.min(10, c.length))]; if (h) note(act.buyHub(ctx, t, h.iata), 'buyHub'); }
          else if (a < 0.57 && s.hubs.length > 1) note(act.sellHub(ctx, t, hubs[hubs.length - 1]), 'sellHub');
          else if (a < 0.59 && s.aircraft.length && s.hubs.length > 1) note(act.transferAircraft(ctx, t, s.aircraft[Math.floor(r() * s.aircraft.length)].id, hubs[Math.floor(r() * hubs.length)]), 'transfer');
          else if (a < 0.61 && s.aircraft.length) { const ac = s.aircraft[Math.floor(r() * s.aircraft.length)]; note(ac.status === 'broken' ? act.repairAircraft(ctx, t, ac.id) : act.maintainAircraft(ctx, t, ac.id), 'maint'); }
          else if (a < 0.63 && s.aircraft.length && s.lines.length) note(act.addLineToAircraft(ctx, t, s.aircraft[Math.floor(r() * s.aircraft.length)].id, s.lines[Math.floor(r() * s.lines.length)].id), 'addLine');
          else if (a < 0.64 && s.pilots.length) note(act.assignPilot(ctx, t, s.aircraft[0]?.id ?? 'x', s.pilots[Math.floor(r() * s.pilots.length)].id), 'reassign');
          else if (a < 0.65) note(act.trainNewPilot(ctx, t, realData().model('a320neo').family), 'school');
          else if (a < 0.55 && s.pilots.length) note(act.trainTypeRating(ctx, t, s.pilots[0].id, realData().model('atr72-600').family), 'rating');
          if (s.campaign?.cleared && !s.campaign.finished && r() < 0.3) {
            const c = eligibleCountries(realData(), s.campaign.level + 1, s.campaign.done.map((d) => d.country))[0];
            const h = c && hubsFor(realData(), c.code, s.campaign.level + 1)[0];
            if (h) note(nextLevel(ctx, t, { country: c.code, hub: h.iata, perks: [] } as any), 'nextLevel');
          }
        } catch (e) {
          throw new Error(`jour ${day} action ${a.toFixed(2)} : ${(e as Error).stack}`);
        }
        if (s.bankrupt) break;
        t += DAY;
        for (let h = 0; h < 24; h += 6) advance(ctx, t - DAY + (h + 6) * HOUR);
        const bad = badNumbers(ctx.state);
        if (bad.length) throw new Error(`jour ${day} : ${bad.slice(0, 5).join(', ')}`);
        for (const ac of ctx.state.aircraft) {
          if (ac.condition < 0 || ac.condition > 100.0001) throw new Error(`jour ${day} état avion ${ac.condition}`);
          if (ac.pilotId && !ctx.state.pilots.some((p) => p.id === ac.pilotId)) throw new Error(`jour ${day} pilote fantôme sur ${ac.id}`);
          for (const l of ac.program) if (!ctx.state.lines.some((x) => x.id === l)) throw new Error(`jour ${day} ligne fantôme ${l} sur ${ac.id}`);
        }
        for (const p of ctx.state.pilots) if (p.aircraftId && !ctx.state.aircraft.some((a) => a.id === p.aircraftId && a.pilotId === p.id)) throw new Error(`jour ${day} pilote ${p.id} lié à ${p.aircraftId} incohérent`);
        if (day % 90 === 0) {
          const res = parseSave(serialize(ctx.state));
          expect(res.ok).toBe(true);
          if (res.ok) expect(JSON.stringify(res.save.state)).toBe(JSON.stringify(ctx.state));
        }
      }
    }, 120_000);
  });
}
