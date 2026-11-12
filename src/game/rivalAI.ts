/**
 * L'intelligence des compagnies rivales (mode « avec concurrence »).
 *
 * Les grandes compagnies présentes autour des hubs du joueur sont pilotées
 * par l'ordinateur. Chacune a sa politique (low-cost, premium, agressive,
 * prudente, en expansion), sa trésorerie, sa flotte et ses bases, et décide
 * chaque semaine : commander des avions (ou en vendre si l'argent manque),
 * ouvrir une base, venir sur une ligne du joueur, baisser ses prix pour
 * lui répondre, ou abandonner une ligne où il est trop fort. Les autres
 * compagnies du monde restent telles qu'elles sont dans les vraies données.
 */
import { DAY, FUEL_PRICE_START, PRICE_ELASTICITY_SHARE } from './config';
import { log, type Ctx } from './context';
import { GameData, type AircraftModel, type Route } from './data';
import { marketShare, type DemandContext } from './economy';
import { pick, randInt } from './rng';
import { lineFrequency } from './schedule';
import type { GameState, Line, RivalCo, RivalStrategy, Rivalry } from './state';

// ───────────────────────── Politiques ─────────────────────────

export interface StrategyInfo {
  label: string;
  /** Ce que fait la compagnie, en une phrase (écran Concurrents). */
  text: string;
  /** Prix habituel (1 = prix de référence). */
  fare: number;
  /** Attrait hors prix : service, programme de fidélité, réseau. */
  appeal: number;
  /** Envie de venir sur les lignes du joueur. */
  attack: number;
  /** Facilité à abandonner une ligne difficile. */
  retreat: number;
  /** Répond aux prix bas du joueur par une baisse des siens. */
  matchPrice: boolean;
  /** Rythme des commandes d'avions. */
  growth: number;
  /** Prix plancher en cas de guerre des prix. */
  floor: number;
  /** Avion recherché : catégorie et nombre de sièges visé. */
  want: { category: AircraftModel['category']; seats: number };
}

export const STRATEGIES: Record<RivalStrategy, StrategyInfo> = {
  lowcost: {
    label: 'Low-cost',
    text: 'Billets pas chers sur des avions monocouloirs ; vient sur les lignes bien remplies et suit toujours les baisses de prix.',
    fare: 0.78,
    appeal: 0.84,
    attack: 1.4,
    retreat: 0.7,
    matchPrice: true,
    growth: 1.3,
    floor: 0.55,
    want: { category: 'narrowbody', seats: 190 },
  },
  premium: {
    label: 'Premium',
    text: 'Billets chers mais service soigné ; ne se bat pas sur les prix et garde ses lignes longtemps.',
    fare: 1.15,
    appeal: 1.2,
    attack: 0.6,
    retreat: 0.5,
    matchPrice: false,
    growth: 0.9,
    floor: 0.95,
    want: { category: 'widebody', seats: 300 },
  },
  agressive: {
    label: 'Agressive',
    text: 'Répond coup pour coup : guerres des prix, et ouvre à son tour les lignes du joueur qui marchent.',
    fare: 1,
    appeal: 1,
    attack: 1.7,
    retreat: 0.4,
    matchPrice: true,
    growth: 1.1,
    floor: 0.6,
    want: { category: 'narrowbody', seats: 180 },
  },
  prudente: {
    label: 'Prudente',
    text: 'Évite les combats : garde ses prix, grandit lentement et ferme vite une ligne qui perd des passagers.',
    fare: 1.05,
    appeal: 1,
    attack: 0.5,
    retreat: 1.7,
    matchPrice: false,
    growth: 0.7,
    floor: 0.9,
    want: { category: 'narrowbody', seats: 170 },
  },
  expansion: {
    label: 'En expansion',
    text: 'Commande beaucoup d’avions et ouvre de nouvelles bases, jusque dans les hubs du joueur.',
    fare: 0.95,
    appeal: 1,
    attack: 1.1,
    retreat: 0.8,
    matchPrice: true,
    growth: 1.7,
    floor: 0.7,
    want: { category: 'narrowbody', seats: 190 },
  },
};

/** Vraies compagnies à bas prix (codes IATA). */
const LOW_COST = new Set(
  'FR U2 W6 NK F9 G4 WN VY V7 6E SG AK D7 FD QZ JQ TR 5J HV TO VJ PC XY FZ G9 J9 DY D8 LS EW 4U W9 BJ MM GK IT Z2 DJ XQ Y4 VB OD SL VZ JT IU ID 7C LJ TW ZE BC 9C HO Y8'.split(' '),
);
/** Compagnies réputées pour leur service. */
const PREMIUM = new Set('AF BA LH LX OS EK QR EY SQ CX NH JL QF KE OZ TK AY KL VS NZ BR CI AC DL UA AA MH TG GA SV WY'.split(' '));

function hash(code: string): number {
  let h = 7;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function strategyOf(code: string): RivalStrategy {
  if (LOW_COST.has(code)) return 'lowcost';
  if (PREMIUM.has(code)) return 'premium';
  return (['agressive', 'prudente', 'expansion'] as const)[hash(code) % 3];
}

// ───────────────────────── Réglages ─────────────────────────

/** Nombre maximal de rivales pilotées. */
const ROSTER_MAX = 8;
/** Recettes d'un avion par semaine (dollars) et marge habituelle d'une compagnie. */
const WEEK_REVENUE_PER_AIRCRAFT = 750_000;
const BASE_MARGIN = 0.06;
/** La ligne du joueur doit être installée (ce nombre de vols) avant que les rivales ne réagissent. */
const SETTLED_FLIGHTS = 40;
const WAR_DAYS: readonly [number, number] = [14, 35];
const MAX_ENTRANTS = 2;
const MOVES_KEPT = 6;

// ───────────────────────── Lecture ─────────────────────────

export function rivalryOf(state: GameState, route: Route): Rivalry | undefined {
  return state.rivalry[GameData.routeKey(route.a, route.b)];
}

export function ensureRivalry(state: GameState, route: Route): Rivalry {
  return (state.rivalry[GameData.routeKey(route.a, route.b)] ??= { entrants: [], gone: [], war: null });
}

/** Prix pratiqué par une compagnie sur la ligne (1 = prix de référence). */
export function fareOf(state: GameState, route: Route, code: string): number {
  const f = rivalryOf(state, route)?.fares?.[code];
  if (f !== undefined) return f;
  const co = state.rivals[code];
  return co ? STRATEGIES[co.strategy].fare : 1;
}

/** Poids d'une compagnie face au joueur sur une ligne (1 = une compagnie moyenne au prix normal). */
export function rivalWeight(state: GameState, route: Route, code: string): number {
  const co = state.rivals[code];
  if (!co) return fareOf(state, route, code) ** -PRICE_ELASTICITY_SHARE;
  const size = Math.min(1.3, Math.max(0.8, Math.sqrt(co.fleet / Math.max(1, co.fleet0))));
  return STRATEGIES[co.strategy].appeal * size * fareOf(state, route, code) ** -PRICE_ELASTICITY_SHARE;
}

// ───────────────────────── Création des rivales ─────────────────────────

function modelFor(ctx: Ctx, strategy: RivalStrategy): AircraftModel | undefined {
  const want = STRATEGIES[strategy].want;
  const ok = ctx.data.models.filter((m) => m.kind === 'pax' && m.inProduction && m.seats);
  const same = ok.filter((m) => m.category === want.category);
  const pool = same.length ? same : ok;
  let best: AircraftModel | undefined;
  for (const m of pool) if (!best || Math.abs(m.seats! - want.seats) < Math.abs(best.seats! - want.seats)) best = m;
  return best;
}

function createRival(ctx: Ctx, code: string, t: number): RivalCo | null {
  const al = ctx.data.airlineByCode.get(code);
  if (!al) return null;
  const strategy = strategyOf(code);
  const model = modelFor(ctx, strategy);
  if (!model) return null;
  const fleet = Math.max(4, Math.round(al.routes * 0.18));
  return {
    code,
    strategy,
    cash: fleet * model.priceUsd * 0.02,
    fleet,
    fleet0: fleet,
    model: model.id,
    bases: [],
    mood: strategy === 'agressive' ? 45 : 25,
    weekProfit: 0,
    nextTurn: t + (1 + (hash(code) % 7)) * DAY,
    moves: [],
  };
}

/** Les compagnies qui comptent autour des hubs du joueur : les plus présentes sur leurs lignes, plus la compagnie nationale. */
function rosterCodes(ctx: Ctx): string[] {
  const { state: s, data } = ctx;
  const weight = new Map<string, number>();
  const add = (code: string, w: number) => {
    if (code !== s.company.code && data.airlineByCode.has(code)) weight.set(code, (weight.get(code) ?? 0) + w);
  };
  for (const h of s.hubs) {
    for (const r of data.routesFrom(h.iata)) for (const code of r.airlines) add(code, r.demand / Math.max(1, r.airlines.length));
    for (const al of data.airlines) if (al.hub === h.iata) add(al.iata, 1e6);
  }
  const national = data.airlines.filter((al) => al.country === s.company.country).sort((a, b) => b.routes - a.routes)[0];
  if (national) add(national.iata, 5e5);
  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, ROSTER_MAX)
    .map(([code]) => code);
}

/** Met à jour la liste des rivales pilotées (au début de la partie et quand le joueur ouvre un hub). */
export function refreshRoster(ctx: Ctx, t: number): void {
  const s = ctx.state;
  const codes = rosterCodes(ctx);
  // Une rivale déjà en jeu garde son histoire, même si elle n'est plus parmi les plus présentes.
  for (const code of codes) {
    if (Object.keys(s.rivals).length >= ROSTER_MAX + 4) break;
    if (!s.rivals[code]) {
      const co = createRival(ctx, code, t);
      if (co) s.rivals[code] = co;
    }
  }
}

// ───────────────────────── Décisions ─────────────────────────

function city(ctx: Ctx, iata: string): string {
  const a = ctx.data.airportByIata.get(iata);
  return a ? a.city || a.name : iata;
}

function lineLabel(ctx: Ctx, line: Line): string {
  return `${city(ctx, line.hub)} ⇄ ${city(ctx, line.dest)}`;
}

function remember(co: RivalCo, t: number, text: string): void {
  co.moves.unshift({ t, text });
  if (co.moves.length > MOVES_KEPT) co.moves.length = MOVES_KEPT;
}

/** Aéroports d'où la compagnie peut opérer : son hub, ses bases, et les aéroports de son pays. */
function canServe(ctx: Ctx, co: RivalCo, route: Route): boolean {
  const al = ctx.data.airlineByCode.get(co.code)!;
  const model = ctx.data.modelById.get(co.model);
  if (model && route.km > model.rangeKm) return false;
  for (const end of [route.a, route.b]) {
    if (end === al.hub || co.bases.includes(end)) return true;
    if (ctx.data.airportByIata.get(end)?.country === al.country) return true;
  }
  // Une low-cost ou une agressive vient de loin si la ligne en vaut la peine.
  return co.strategy === 'lowcost' || co.strategy === 'agressive';
}

function isHome(ctx: Ctx, co: RivalCo, route: Route): boolean {
  const hub = ctx.data.airlineByCode.get(co.code)?.hub;
  return route.a === hub || route.b === hub || co.bases.includes(route.a) || co.bases.includes(route.b);
}

function loadOf(line: Line): number {
  if (line.month.seats) return line.month.pax / line.month.seats;
  if (line.month.capT) return line.month.cargoT / line.month.capT;
  return 0;
}

export interface LineSituation {
  line: Line;
  route: Route;
  present: string[];
  share: number;
  load: number;
}

type Present = (s: GameState, r: Route) => string[];
type Context = (ctx: Ctx, line: Line, route: Route, condition: number, legsPerDay: number, t: number) => DemandContext;

/** Les lignes du joueur où la concurrence peut bouger, avec ce qu'il y pèse. */
function situations(ctx: Ctx, t: number, present: Present, demand: Context): LineSituation[] {
  const out: LineSituation[] = [];
  for (const line of ctx.state.lines) {
    if (line.stats.flights < SETTLED_FLIGHTS) continue;
    const route = ctx.data.route(line.hub, line.dest);
    if (!route) continue;
    const freq = lineFrequency(ctx, line.id);
    if (freq.pax + freq.cargo <= 0) continue; // ligne sans avion en ce moment
    const share = marketShare(demand(ctx, line, route, 90, Math.max(1, freq.pax), t));
    out.push({ line, route, present: present(ctx.state, route), share, load: loadOf(line) });
  }
  return out;
}

/** La semaine d'une rivale : argent, flotte, bases, puis une décision sur les lignes du joueur. */
function turn(ctx: Ctx, co: RivalCo, t: number, lines: LineSituation[]): void {
  const { state: s, data, rng } = ctx;
  const st = STRATEGIES[co.strategy];
  const al = data.airlineByCode.get(co.code)!;
  const name = data.airlineName(co.code);
  const model = data.modelById.get(co.model)!;

  // Ce que le joueur lui prend : ses lignes où il fait plus de 35 % des passagers.
  const mine = lines.filter((x) => x.present.includes(co.code));
  const pressure = mine.reduce((sum, x) => sum + Math.max(0, x.share - 0.35), 0);
  const onHome = lines.filter((x) => isHome(ctx, co, x.route)).length;

  // Hostilité : elle monte quand le joueur s'installe chez elle, retombe sinon.
  co.mood = Math.max(0, Math.min(100, co.mood * 0.9 + mine.length + onHome + 15 * pressure));

  // Argent de la semaine.
  const fuel = (s.fuelPrice - FUEL_PRICE_START) * 0.25;
  const margin = BASE_MARGIN * (co.strategy === 'premium' ? 1.2 : 1) - fuel - 0.02 * pressure + (rng() - 0.5) * 0.04;
  co.weekProfit = co.fleet * WEEK_REVENUE_PER_AIRCRAFT * margin;
  co.cash += co.weekProfit;

  // Flotte : commandes quand l'argent est là, ventes quand il manque.
  if (co.cash < -co.fleet * model.priceUsd * 0.05 && co.fleet > 4) {
    const n = Math.max(1, Math.round(co.fleet * 0.05));
    co.fleet -= n;
    co.cash += n * model.priceUsd * 0.5;
    remember(co, t, `vend ${n} avion${n > 1 ? 's' : ''} pour renflouer ses caisses`);
  } else if (co.cash > model.priceUsd * 3 && margin > 0 && rng() < 0.25 * st.growth) {
    const n = Math.max(1, Math.min(Math.floor((co.cash * 0.3) / model.priceUsd), Math.ceil(co.fleet * 0.04 * st.growth)));
    co.fleet += n;
    co.cash -= n * model.priceUsd;
    remember(co, t, `commande ${n} ${model.name}`);
    if (mine.length && n >= 3) log(ctx, 'info', `${name} commande ${n} ${model.name} : sa flotte passe à ${co.fleet} avions.`, undefined, t);
  }

  // Bases : une compagnie riche et conquérante vient s'installer dans un hub du joueur.
  const wantsBase = co.strategy === 'expansion' || (co.strategy === 'agressive' && co.mood > 60) || (co.strategy === 'lowcost' && co.mood > 50);
  if (wantsBase && co.fleet >= 15 && co.cash > model.priceUsd * 6 && co.bases.length < 3 && rng() < 0.06) {
    const free = s.hubs.map((h) => h.iata).filter((h) => h !== al.hub && !co.bases.includes(h));
    if (free.length) {
      const base = pick(rng, free);
      co.bases.push(base);
      co.cash -= model.priceUsd * 2;
      remember(co, t, `ouvre une base à ${city(ctx, base)}`);
      log(ctx, 'bad', `${name} ouvre une base à ${city(ctx, base)}, dans ton hub : attends-toi à la voir sur tes lignes.`, { type: 'hub', id: base }, t);
    }
  }

  // Une seule décision de ligne par semaine : la plus urgente d'abord.
  if (warEnds(ctx, co, t)) return;
  if (respondToPrices(ctx, co, t, mine)) return;
  if (retreat(ctx, co, t, mine)) return;
  attack(ctx, co, t, lines);
}

/** Fin des guerres des prix menées par la compagnie : elle revient à ses prix habituels. */
function warEnds(ctx: Ctx, co: RivalCo, t: number): boolean {
  let any = false;
  for (const line of ctx.state.lines) {
    const route = ctx.data.route(line.hub, line.dest);
    const r = route && rivalryOf(ctx.state, route);
    if (!r?.war || r.war.airline !== co.code || r.war.until > t) continue;
    r.war = null;
    r.truce = t + randInt(ctx.rng, 60, 150) * DAY;
    if (r.fares) delete r.fares[co.code];
    remember(co, t, `remonte ses prix sur ${lineLabel(ctx, line)}`);
    log(ctx, 'good', `${ctx.data.airlineName(co.code)} arrête sa guerre des prix sur ${lineLabel(ctx, line)}`, { type: 'line', id: line.id }, t);
    any = true;
  }
  return any;
}

/** Le joueur casse les prix, ou lui prend trop de passagers : guerre des prix. */
function respondToPrices(ctx: Ctx, co: RivalCo, t: number, mine: LineSituation[]): boolean {
  const { state: s, rng, data } = ctx;
  const st = STRATEGIES[co.strategy];
  for (const x of mine) {
    const r = ensureRivalry(s, x.route);
    if (r.war || (r.truce ?? 0) > t) continue;
    const fare = fareOf(s, x.route, co.code);
    const undercut = x.line.priceFactor < fare * 0.9;
    const threatened = x.share > 0.4 && co.mood > 25;
    if (!undercut && !threatened) continue;
    // Une compagnie qui ne suit pas les prix ne part en guerre que très en colère, et jamais sans argent.
    const p = (st.matchPrice ? 0.5 : 0.08) * (undercut ? 1 : 0.4) * (0.5 + co.mood / 100);
    if (co.cash < 0 || rng() >= p) continue;
    const newFare = Math.max(st.floor, Math.min(fare * 0.85, x.line.priceFactor * 0.95));
    const days = randInt(rng, WAR_DAYS[0], WAR_DAYS[1]);
    r.war = { airline: co.code, until: t + days * DAY };
    (r.fares ??= {})[co.code] = newFare;
    const why = undercut ? 'répond à tes prix bas' : 'refuse de te laisser ses passagers';
    remember(co, t, `guerre des prix sur ${lineLabel(ctx, x.line)}`);
    log(
      ctx,
      'bad',
      `Guerre des prix : ${data.airlineName(co.code)} ${why} et baisse ses tarifs de ${Math.round((1 - newFare / fare) * 100)} % sur ${lineLabel(ctx, x.line)} pendant ${days} jours.`,
      { type: 'line', id: x.line.id },
      t,
    );
    return true;
  }
  return false;
}

/** Face à un joueur fort et apprécié, la compagnie abandonne une ligne qui n'est pas chez elle. */
function retreat(ctx: Ctx, co: RivalCo, t: number, mine: LineSituation[]): boolean {
  const { state: s, rng, data } = ctx;
  const st = STRATEGIES[co.strategy];
  const broke = co.cash < 0;
  for (const x of mine) {
    if (x.present.length < 2 && !broke) continue; // elle ne laisse pas le joueur seul sans raison
    if (t - x.line.openedAt < 90 * DAY && !broke) continue; // elle laisse d'abord sa chance à la ligne
    if (isHome(ctx, co, x.route) && !broke) continue;
    if (rivalryOf(s, x.route)?.war?.airline === co.code) continue;
    const strong = x.share > 0.3 && s.reputation >= 60;
    if (!strong && !broke) continue;
    const p = 0.12 * st.retreat * (broke ? 3 : 1) * (0.5 + x.share);
    if (rng() >= p) continue;
    const r = ensureRivalry(s, x.route);
    r.entrants = r.entrants.filter((c) => c !== co.code);
    if (x.route.airlines.includes(co.code) && !r.gone.includes(co.code)) r.gone.push(co.code);
    if (r.fares) delete r.fares[co.code];
    remember(co, t, `quitte la ligne ${lineLabel(ctx, x.line)}`);
    log(
      ctx,
      'good',
      `${data.airlineName(co.code)} abandonne la ligne ${lineLabel(ctx, x.line)}${broke ? ' faute d’argent' : ''} : plus de passagers pour toi.`,
      { type: 'line', id: x.line.id },
      t,
    );
    return true;
  }
  return false;
}

/** La compagnie vient sur une ligne du joueur qui marche bien. */
function attack(ctx: Ctx, co: RivalCo, t: number, lines: LineSituation[]): boolean {
  const { state: s, rng, data } = ctx;
  const st = STRATEGIES[co.strategy];
  if (co.cash < 0) return false;
  let best: LineSituation | null = null;
  let bestScore = 0;
  for (const x of lines) {
    if (x.present.includes(co.code) || !canServe(ctx, co, x.route)) continue;
    const r = rivalryOf(s, x.route);
    if ((r?.entrants.length ?? 0) >= MAX_ENTRANTS) continue;
    if (r?.gone.includes(co.code) && co.mood < 70) continue; // elle ne revient pas tout de suite
    // Une ligne pleine, avec peu de concurrents, et où le joueur gagne beaucoup de passagers.
    const score = Math.max(0, x.load - 0.55) * x.share * (x.present.length <= 1 ? 2 : 0.6) * (isHome(ctx, co, x.route) ? 1.5 : 1);
    if (score > bestScore) {
      best = x;
      bestScore = score;
    }
  }
  if (!best) return false;
  const p = Math.min(0.5, bestScore * st.attack * (0.5 + co.mood / 100));
  if (rng() >= p) return false;
  const r = ensureRivalry(s, best.route);
  if (r.gone.includes(co.code)) r.gone = r.gone.filter((c) => c !== co.code);
  else r.entrants.push(co.code);
  remember(co, t, `ouvre la ligne ${lineLabel(ctx, best.line)}`);
  const how = co.strategy === 'lowcost' ? ' avec des billets à petit prix' : co.strategy === 'premium' ? ' avec un service haut de gamme' : '';
  log(
    ctx,
    'bad',
    `${data.airlineName(co.code)} ouvre à son tour la ligne ${lineLabel(ctx, best.line)}${how} : il va falloir partager les passagers.`,
    { type: 'line', id: best.line.id },
    t,
  );
  return true;
}

/** Chaque jour de jeu : les rivales dont c'est le tour prennent leurs décisions. */
export function rivalsDay(ctx: Ctx, t: number, present: Present, demand: Context): void {
  const s = ctx.state;
  const hubsKey = s.hubs.map((h) => h.iata).join(',');
  if (rosterKey.get(s) !== hubsKey) {
    refreshRoster(ctx, t);
    rosterKey.set(s, hubsKey);
  }
  let lines: LineSituation[] | null = null;
  for (const co of Object.values(s.rivals)) {
    if (co.nextTurn > t) continue;
    co.nextTurn = t + 7 * DAY;
    lines ??= situations(ctx, t, present, demand);
    turn(ctx, co, t, lines);
    lines = null; // la décision a pu changer la situation des lignes
  }
}

/** Hubs pour lesquels la liste des rivales a été faite (pas sauvegardé : refait au chargement). */
const rosterKey = new WeakMap<GameState, string>();

/** Les rivales pilotées, de la plus menaçante à la moins menaçante (écran Concurrents). */
export function rivalsByThreat(ctx: Ctx, present: Present): { co: RivalCo; lines: number }[] {
  const s = ctx.state;
  const count = new Map<string, number>();
  for (const line of s.lines) {
    const route = ctx.data.route(line.hub, line.dest);
    if (route) for (const code of present(s, route)) count.set(code, (count.get(code) ?? 0) + 1);
  }
  return Object.values(s.rivals)
    .map((co) => ({ co, lines: count.get(co.code) ?? 0 }))
    .sort((a, b) => b.lines - a.lines || b.co.mood - a.co.mood || b.co.fleet - a.co.fleet);
}
