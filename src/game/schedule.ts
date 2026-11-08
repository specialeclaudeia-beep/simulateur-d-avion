/**
 * Horaires estimés : combien de rotations un avion fait par jour sur chaque
 * ligne de son programme, combien de vols chaque ligne reçoit, et combien de
 * départs chaque hub doit absorber (limité par ses portes).
 */
import { DEPARTURES_PER_GATE, OPS_END_MIN, OPS_START_MIN } from './config';
import type { Ctx } from './context';
import type { AircraftModel } from './data';
import { blockMinutes, turnaroundMinutes } from './economy';
import type { Aircraft, GameState, Hub, Line } from './state';

/**
 * Rotations par jour (moyenne sur une semaine) de chaque ligne d'un programme.
 * Une rotation = aller hub → destination + retour, escales comprises. Les
 * départs du hub n'ont lieu qu'entre 5 h 30 et 23 h (heure locale).
 */
export function estimateRotations(model: AircraftModel, program: Line[]): Map<string, number> {
  const result = new Map<string, number>();
  if (!program.length) return result;
  const rotations = program.map((l) => ({
    id: l.id,
    minutes: 2 * blockMinutes(l.km, model) + 2 * turnaroundMinutes(model),
  }));
  const horizon = 7 * 1440;
  let t = OPS_START_MIN;
  let i = 0;
  for (let guard = 0; t < horizon && guard < 2000; guard++) {
    const dayMin = t % 1440;
    if (dayMin < OPS_START_MIN || dayMin >= OPS_END_MIN) {
      t += (dayMin >= OPS_END_MIN ? 1440 - dayMin : -dayMin) + OPS_START_MIN;
      continue;
    }
    const r = rotations[i % rotations.length];
    result.set(r.id, (result.get(r.id) ?? 0) + 1);
    t += r.minutes;
    i++;
  }
  for (const [k, v] of result) result.set(k, v / 7);
  return result;
}

/** Lignes (existantes) du programme d'un avion. */
export function programLines(state: GameState, ac: Aircraft): Line[] {
  const out: Line[] = [];
  for (const id of ac.program) {
    const l = state.lines.find((x) => x.id === id);
    if (l) out.push(l);
  }
  return out;
}

/** L'avion compte dans les horaires s'il a un pilote et n'est pas en cours de livraison. */
function isScheduled(ac: Aircraft): boolean {
  return ac.pilotId !== null && ac.status !== 'delivery' && ac.program.length > 0;
}

/** Vols par jour et par sens sur chaque ligne (passagers et fret séparés). */
export function lineFrequencies(ctx: Ctx): Map<string, { pax: number; cargo: number }> {
  if (ctx.freqCache) return ctx.freqCache;
  const freq = new Map<string, { pax: number; cargo: number }>();
  for (const ac of ctx.state.aircraft) {
    if (!isScheduled(ac)) continue;
    const model = ctx.data.model(ac.modelId);
    for (const [lineId, n] of estimateRotations(model, programLines(ctx.state, ac))) {
      const f = freq.get(lineId) ?? { pax: 0, cargo: 0 };
      if (model.kind === 'pax') f.pax += n;
      else f.cargo += n;
      freq.set(lineId, f);
    }
  }
  ctx.freqCache = freq;
  return freq;
}

export function lineFrequency(ctx: Ctx, lineId: string): { pax: number; cargo: number } {
  return lineFrequencies(ctx).get(lineId) ?? { pax: 0, cargo: 0 };
}

/** Départs par jour estimés d'un avion (toutes lignes confondues). */
export function aircraftDailyDepartures(ctx: Ctx, ac: Aircraft, program = programLines(ctx.state, ac)): number {
  let total = 0;
  for (const n of estimateRotations(ctx.data.model(ac.modelId), program).values()) total += n;
  return total;
}

/** Départs par jour utilisés au hub et capacité offerte par ses portes. */
export function hubDepartures(ctx: Ctx, hub: Hub, override?: { aircraftId: string; program: Line[] }): { used: number; capacity: number } {
  let used = 0;
  for (const ac of ctx.state.aircraft) {
    if (ac.base !== hub.iata) continue;
    if (override && ac.id === override.aircraftId) {
      used += aircraftDailyDepartures(ctx, ac, override.program);
    } else if (isScheduled(ac)) {
      used += aircraftDailyDepartures(ctx, ac);
    }
  }
  return { used, capacity: hub.gates * DEPARTURES_PER_GATE };
}

/** Avions rattachés à un hub (y compris ceux en cours de livraison). */
export function basedAircraft(state: GameState, iata: string): Aircraft[] {
  return state.aircraft.filter((a) => a.base === iata);
}
