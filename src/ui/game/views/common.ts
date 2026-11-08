/**
 * Libellés partagés par les écrans : noms des aéroports, état d'un avion,
 * fiche courte d'un pilote.
 */
import type { GameData } from '../../../game/data';
import { pilotProblem } from '../../../game/economy';
import { flightProblem } from '../../../game/sim';
import type { Aircraft, Pilot } from '../../../game/state';
import type { Ctx } from '../../../game/context';
import { esc, money, when } from '../dom';
import { repairQuote } from '../../../game/sim';

export function cityOf(data: GameData, iata: string): string {
  const a = data.airportByIata.get(iata);
  return a ? a.city || a.name : iata;
}

/** « Nice (NCE) ». */
export function place(data: GameData, iata: string): string {
  return `${esc(cityOf(data, iata))} <small>${esc(iata)}</small>`;
}

/** Nom affiché d'un avion : son nom de baptême, sinon son immatriculation. */
export function aircraftName(ac: Aircraft): string {
  return ac.name ? `${ac.name} (${ac.registration})` : ac.registration;
}

export function pilotFullName(p: Pick<Pilot, 'firstName' | 'lastName'>): string {
  return `${p.firstName} ${p.lastName}`;
}

export interface StatusInfo {
  label: string;
  tone: 'fly' | 'ok' | 'warn' | 'bad' | 'work' | 'mute';
  detail: string;
}

/** Pourquoi un avion reste au sol sans rien faire. */
export function idleReason(ctx: Ctx, ac: Aircraft): string {
  const pilot = ac.pilotId ? ctx.state.pilots.find((p) => p.id === ac.pilotId) : undefined;
  if (!pilot) return 'Il lui faut un pilote';
  if (pilot.training) return `${pilotFullName(pilot)} est en formation`;
  const pb = pilotProblem(pilot, ctx.data.model(ac.modelId));
  if (pb) return pb;
  if (ac.location !== ac.base) return `Bloqué à ${cityOf(ctx.data, ac.location)}`;
  if (!ac.program.length) return 'Il lui faut une ligne';
  for (const id of ac.program) {
    const line = ctx.state.lines.find((l) => l.id === id);
    if (line) {
      const p = flightProblem(ctx, ac, line, pilot);
      if (p) return p;
    }
  }
  return 'En attente';
}

/** État d'un avion en quelques mots, avec une couleur. */
export function statusOf(ctx: Ctx, ac: Aircraft, now: number): StatusInfo {
  const d = ctx.data;
  switch (ac.status) {
    case 'delivery':
      return { label: 'Livraison', tone: 'mute', detail: `Livré à ${esc(cityOf(d, ac.base))} ${esc(when(ac.until ?? now, now))}` };
    case 'flying': {
      const leg = ac.leg!;
      return {
        label: 'En vol',
        tone: 'fly',
        detail: `${esc(leg.callsign)} · ${esc(leg.from)} → ${esc(leg.to)} · arrivée ${esc(when(leg.arr, now))}`,
      };
    }
    case 'ground':
      return {
        label: 'Au sol',
        tone: 'ok',
        detail: `À ${esc(cityOf(d, ac.location))}${ac.until ? ` · prochain départ ${esc(when(ac.until, now))}` : ''}`,
      };
    case 'maintenance':
      return { label: 'Révision', tone: 'work', detail: `À ${esc(cityOf(d, ac.location))} jusqu’à ${esc(when(ac.until ?? now, now))}` };
    case 'repair':
      return { label: 'Réparation', tone: 'work', detail: `À ${esc(cityOf(d, ac.location))} jusqu’à ${esc(when(ac.until ?? now, now))}` };
    case 'broken': {
      const q = repairQuote(ctx, ac);
      return {
        label: 'En panne',
        tone: 'bad',
        detail: `À ${esc(cityOf(d, ac.location))} · réparation ${money(q.cost)}, ${q.hours} h`,
      };
    }
    case 'idle':
      return { label: 'Inactif', tone: 'warn', detail: esc(idleReason(ctx, ac)) };
  }
}
