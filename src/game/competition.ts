/**
 * La concurrence sur les lignes.
 *
 * Au départ, chaque ligne a pour concurrentes les vraies compagnies qui la
 * desservent. En partie « avec concurrence », cette situation bouge : une
 * rivale peut lancer une guerre des prix, une nouvelle venue peut arriver sur
 * une ligne où le joueur est presque seul, une autre peut jeter l'éponge face
 * à un joueur bien installé. En partie « sans concurrence », il n'y a que la
 * voiture et le train pour disputer les passagers au joueur.
 */
import { DAY } from './config';
import { log, type Ctx } from './context';
import { GameData, type Route } from './data';
import { marketShare, type DemandContext, type Rivals } from './economy';
import { pick, randInt } from './rng';
import { lineFrequency } from './schedule';
import type { GameState, Line, Rivalry } from './state';

/** Sans concurrence : ce qui reste face au joueur (autres moyens de transport). */
const SOLO: Rivals = { pax: 0.25, cargo: 0.1 };
/** Une guerre des prix pèse comme presque une compagnie de plus. */
const WAR_STRENGTH = 0.8;
const WAR_DAYS: readonly [number, number] = [14, 35];
/** Chances par ligne et par jour. */
const P_WAR = 1 / 120;
const P_ENTRY = 1 / 70;
const P_EXIT = 1 / 100;
/** La ligne doit être installée (ce nombre de vols) avant que la concurrence ne bouge. */
const SETTLED_FLIGHTS = 40;
const MAX_ENTRANTS = 2;

function rivalryOf(state: GameState, route: Route): Rivalry | undefined {
  return state.rivalry[GameData.routeKey(route.a, route.b)];
}

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
export function rivalsOn(state: GameState, route: Route, t: number): Rivals {
  if (!state.competition) return SOLO;
  const n = presentRivals(state, route).length;
  return { pax: n + (warOn(state, route, t) ? WAR_STRENGTH : 0), cargo: Math.floor(n / 3) };
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

function label(ctx: Ctx, line: Line): string {
  const city = (iata: string) => {
    const a = ctx.data.airportByIata.get(iata);
    return a ? a.city || a.name : iata;
  };
  return `${city(line.hub)} ⇄ ${city(line.dest)}`;
}

function ensure(state: GameState, route: Route): Rivalry {
  const key = GameData.routeKey(route.a, route.b);
  return (state.rivalry[key] ??= { entrants: [], gone: [], war: null });
}

/** Une compagnie qui pourrait s'installer sur la ligne : de préférence du pays d'un des deux aéroports. */
function newcomer(ctx: Ctx, route: Route, r: Rivalry | undefined): string | null {
  const { data, rng, state } = ctx;
  const taken = new Set([...route.airlines, ...(r?.entrants ?? []), ...(r?.gone ?? []), state.company.code]);
  const countries = new Set([data.airportByIata.get(route.a)?.country, data.airportByIata.get(route.b)?.country]);
  const free = data.airlines.filter((al) => !taken.has(al.iata) && al.routes >= 5);
  const local = free.filter((al) => countries.has(al.country));
  const pool = local.length ? local : free.filter((al) => al.routes >= 40);
  return pool.length ? pick(rng, pool).iata : null;
}

/** Chaque jour de jeu : la concurrence bouge sur les lignes du joueur. */
export function dailyCompetition(ctx: Ctx, t: number): void {
  const { state: s, data, rng } = ctx;
  if (!s.competition) return;
  for (const line of s.lines) {
    const route = data.route(line.hub, line.dest);
    if (!route) continue;
    const r = rivalryOf(s, route);
    if (r?.war && r.war.until <= t) {
      log(ctx, 'good', `${data.airlineName(r.war.airline)} arrête sa guerre des prix sur ${label(ctx, line)}`, { type: 'line', id: line.id }, t);
      r.war = null;
    }
    if (line.stats.flights < SETTLED_FLIGHTS) continue;
    const freq = lineFrequency(ctx, line.id);
    if (freq.pax + freq.cargo <= 0) continue; // ligne sans avion en ce moment
    const present = presentRivals(s, route);
    const x = rng();
    if (x < P_WAR) {
      if (!present.length || r?.war) continue;
      const airline = pick(rng, present);
      const days = randInt(rng, WAR_DAYS[0], WAR_DAYS[1]);
      ensure(s, route).war = { airline, until: t + days * DAY };
      log(
        ctx,
        'bad',
        `Guerre des prix : ${data.airlineName(airline)} casse ses tarifs sur ${label(ctx, line)} pendant ${days} jours. Baisse tes prix ou laisse passer l’orage.`,
        { type: 'line', id: line.id },
        t,
      );
    } else if (x < P_WAR + P_ENTRY) {
      // Une ligne presque sans concurrent et bien remplie attire du monde.
      const load = line.month.seats ? line.month.pax / line.month.seats : line.month.capT ? line.month.cargoT / line.month.capT : 0;
      if (present.length > 1 || (r?.entrants.length ?? 0) >= MAX_ENTRANTS || load < 0.7) continue;
      const airline = newcomer(ctx, route, r);
      if (!airline) continue;
      ensure(s, route).entrants.push(airline);
      log(ctx, 'bad', `${data.airlineName(airline)} ouvre à son tour la ligne ${label(ctx, line)} : il va falloir partager les passagers.`, { type: 'line', id: line.id }, t);
    } else if (x < P_WAR + P_ENTRY + P_EXIT) {
      // Face à un joueur bien installé et apprécié, une rivale finit par renoncer.
      if (present.length < 2 || s.reputation < 62) continue;
      const share = marketShare(demandContext(ctx, line, route, 90, Math.max(1, freq.pax), t));
      if (share < 0.3) continue;
      const leaving = present.filter((code) => code !== r?.war?.airline);
      if (!leaving.length) continue;
      const airline = pick(rng, leaving);
      ensure(s, route).gone.push(airline);
      log(ctx, 'good', `${data.airlineName(airline)} abandonne la ligne ${label(ctx, line)} : plus de passagers pour toi.`, { type: 'line', id: line.id }, t);
    }
  }
}
