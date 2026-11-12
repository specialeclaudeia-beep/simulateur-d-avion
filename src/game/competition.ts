/**
 * La concurrence sur les lignes.
 *
 * Au départ, chaque ligne a pour concurrentes les vraies compagnies qui la
 * desservent. En partie « avec concurrence », les grandes compagnies autour
 * des hubs du joueur sont pilotées par l'ordinateur (voir rivalAI.ts) : elles
 * viennent sur ses lignes, se lancent dans des guerres des prix ou
 * abandonnent la partie, chacune selon sa politique. En partie « sans
 * concurrence », il n'y a que la voiture et le train pour disputer les
 * passagers au joueur.
 */
import type { Ctx } from './context';
import type { Route } from './data';
import { marketShare, type DemandContext, type Rivals } from './economy';
import { rivalWeight, rivalryOf, rivalsByThreat, rivalsDay, STRATEGIES } from './rivalAI';
import { lineFrequency } from './schedule';
import type { GameState, Line, RivalCo } from './state';

export { STRATEGIES };

/** Sans concurrence : ce qui reste face au joueur (autres moyens de transport). */
const SOLO: Rivals = { pax: 0.25, cargo: 0.1 };

/** Compagnies qui desservent la ligne en ce moment (codes IATA). */
export function presentRivals(state: GameState, route: Route): string[] {
  const r = rivalryOf(state, route);
  if (!r) return route.airlines;
  return [...route.airlines, ...r.entrants].filter((code) => !r.gone.includes(code));
}

/** Guerre des prix en cours sur la ligne à l'instant `t`, s'il y en a une. */
export function warOn(state: GameState, route: Route, t: number): { airline: string; until: number } | null {
  const war = rivalryOf(state, route)?.war;
  return war && war.until > t ? war : null;
}

/** Poids des concurrents face au joueur sur une ligne (passagers et fret). */
export function rivalsOn(state: GameState, route: Route, _t?: number): Rivals {
  if (!state.competition) return SOLO;
  const present = presentRivals(state, route);
  let pax = 0;
  for (const code of present) pax += rivalWeight(state, route, code);
  return { pax, cargo: Math.floor(present.length / 3) };
}

/** Tout ce qu'il faut pour estimer la demande du joueur sur une ligne. */
export function demandContext(ctx: Ctx, line: Line, route: Route, condition: number, legsPerDay: number, t: number): DemandContext {
  const s = ctx.state;
  return {
    route,
    line,
    hub: s.hubs.find((h) => h.iata === line.hub),
    reputation: s.reputation,
    condition,
    legsPerDay,
    rivals: rivalsOn(s, route, t),
  };
}

export type RivalStatus = 'present' | 'new' | 'war' | 'gone';

export interface RivalInfo {
  code: string;
  name: string;
  status: RivalStatus;
}

/** Les concurrents d'une ligne, avec ce qui a changé depuis le début de la partie. */
export function rivalList(ctx: Ctx, route: Route, t: number): RivalInfo[] {
  const { state: s, data } = ctx;
  if (!s.competition) return [];
  const r = rivalryOf(s, route);
  const war = warOn(s, route, t);
  const out: RivalInfo[] = [];
  for (const code of presentRivals(s, route)) {
    const status: RivalStatus = war?.airline === code ? 'war' : r?.entrants.includes(code) ? 'new' : 'present';
    out.push({ code, name: data.airlineName(code), status });
  }
  for (const code of r?.gone ?? []) out.push({ code, name: data.airlineName(code), status: 'gone' });
  return out;
}

/** Part des passagers de la ligne que le joueur peut espérer (0 à 1), avec des avions en bon état. */
export function playerShare(ctx: Ctx, line: Line, route: Route, t: number): number {
  const freq = lineFrequency(ctx, line.id);
  return marketShare(demandContext(ctx, line, route, 90, Math.max(1, freq.pax), t));
}

/** Chaque jour de jeu : les rivales pilotées prennent leurs décisions. */
export function dailyCompetition(ctx: Ctx, t: number): void {
  if (!ctx.state.competition) return;
  rivalsDay(ctx, t, presentRivals, demandContext);
}

/** Les rivales pilotées par l'ordinateur, de la plus présente sur les lignes du joueur à la moins présente. */
export function rivalCompanies(ctx: Ctx): { co: RivalCo; lines: number }[] {
  if (!ctx.state.competition) return [];
  return rivalsByThreat(ctx, presentRivals);
}
