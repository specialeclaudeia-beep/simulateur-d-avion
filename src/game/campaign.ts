/**
 * Mode par échelons : les règles.
 *
 * On commence tout petit (un hub, deux avions à hélices, trois aéroports) dans
 * un pays. Chaque échelon a trois objectifs : relier des aéroports du pays,
 * satisfaire les passagers, gagner de l'argent. Dès que
 * deux objectifs sur trois sont atteints, on peut partir dans un nouveau pays,
 * à plus grande échelle, avec une amélioration à choisir (deux si les trois
 * objectifs sont atteints).
 *
 * Ce fichier ne contient que les règles (limites, objectifs, pays possibles) ;
 * le passage d'un échelon à l'autre est dans campaignFlow.ts.
 */
import { FIRST_HUB_BUDGET_SHARE, MAINTENANCE_MAX, QUALITY_MAX } from './config';
import { log, type Ctx } from './context';
import { CATEGORY_LABEL, type AircraftCategory, type AircraftModel, type Airport, type Country, type GameData } from './data';
import { money, summarize } from './ledger';
import { makeRng } from './rng';
import type { Campaign, GameState, GoalId, PerkId } from './state';

// ───────────────────────── Échelons ─────────────────────────

/** Catégories d'avions, de la plus petite à la plus grosse. */
export const CLASS_ORDER: AircraftCategory[] = ['regional_turboprop', 'regional_jet', 'narrowbody', 'widebody', 'jumbo'];

export interface LevelSpec {
  name: string;
  /** Une phrase pour présenter l'échelon. */
  pitch: string;
  /** Objectif : aéroports du pays à relier (hub compris). */
  airports: number;
  /** Objectif : satisfaction des passagers (sur 100). */
  satisfaction: number;
  /** Capital de départ. */
  capital: number;
  /** Objectif : bénéfices à réaliser pendant l'échelon (avant impôt). */
  profit: number;
  /** Limites de l'échelon (avant améliorations). */
  fleet: number;
  lines: number;
  /** Plus grosse catégorie d'avions autorisée (indice dans CLASS_ORDER). */
  classCap: number;
  quality: number;
  workshop: number;
  /** Lignes vers l'étranger autorisées d'office. */
  intl: boolean;
}

export const LEVELS: LevelSpec[] = [
  {
    name: 'Régional',
    pitch: 'Un petit hub, deux avions à hélices, trois aéroports : tout commence ici.',
    airports: 3,
    satisfaction: 60,
    capital: 40_000_000,
    profit: 1_500_000,
    fleet: 2,
    lines: 3,
    classCap: 0,
    quality: 2,
    workshop: 1,
    intl: false,
  },
  {
    name: 'Inter-régional',
    pitch: 'Les premiers jets régionaux et un réseau qui s’étoffe.',
    airports: 5,
    satisfaction: 64,
    capital: 80_000_000,
    profit: 4_000_000,
    fleet: 4,
    lines: 5,
    classCap: 1,
    quality: 2,
    workshop: 1,
    intl: false,
  },
  {
    name: 'National',
    pitch: 'Des moyen-courriers pour relier les grandes villes du pays.',
    airports: 8,
    satisfaction: 68,
    capital: 150_000_000,
    profit: 8_000_000,
    fleet: 6,
    lines: 8,
    classCap: 2,
    quality: 3,
    workshop: 2,
    intl: false,
  },
  {
    name: 'Grand national',
    pitch: 'Une vraie compagnie nationale : douze aéroports à desservir.',
    airports: 12,
    satisfaction: 72,
    capital: 300_000_000,
    profit: 20_000_000,
    fleet: 9,
    lines: 12,
    classCap: 2,
    quality: 3,
    workshop: 2,
    intl: false,
  },
  {
    name: 'International',
    pitch: 'Les gros-porteurs arrivent et les frontières s’ouvrent.',
    airports: 18,
    satisfaction: 75,
    capital: 600_000_000,
    profit: 40_000_000,
    fleet: 13,
    lines: 18,
    classCap: 3,
    quality: 4,
    workshop: 3,
    intl: true,
  },
  {
    name: 'Mondial',
    pitch: 'Le dernier échelon : une compagnie qui compte dans le monde entier.',
    airports: 25,
    satisfaction: 78,
    capital: 1_200_000_000,
    profit: 100_000_000,
    fleet: 18,
    lines: 25,
    classCap: 4,
    quality: 5,
    workshop: 3,
    intl: true,
  },
];

/** Nombre d'objectifs (sur trois) à atteindre pour ouvrir le pays suivant. */
export const GOALS_TO_CLEAR = 2;
/** Un aéroport est « relié » quand sa ligne a fait ce nombre de vols. */
export const LINKED_FLIGHTS = 20;
/** On emporte ses bénéfices dans l'échelon suivant, dans la limite de cette part du capital de base. */
export const CARRY_MAX = 0.5;

export const GOAL_IDS: GoalId[] = ['airports', 'satisfaction', 'profit'];

export function levelSpec(level: number): LevelSpec {
  return LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];
}

// ───────────────────────── Améliorations ─────────────────────────

export interface PerkSpec {
  id: PerkId;
  title: string;
  text: string;
  /** Nom de l'icône (voir src/ui/icons.ts). */
  icon: string;
  /** Nombre de fois qu'on peut la prendre. */
  max: number;
}

export const PERKS: Record<PerkId, PerkSpec> = {
  fleet: { id: 'fleet', title: 'Flotte élargie', text: '+2 avions dans ta flotte.', icon: 'fleet', max: 5 },
  lines: { id: 'lines', title: 'Nouvelles licences', text: '+2 lignes ouvertes en même temps.', icon: 'lines', max: 5 },
  recruit: {
    id: 'recruit',
    title: 'Bureau de recrutement',
    text: 'Tu peux embaucher des pilotes expérimentés au lieu de tous les former (il en faut pour les très gros avions).',
    icon: 'pilot',
    max: 1,
  },
  cargo: { id: 'cargo', title: 'Division fret', text: 'Tu peux acheter des avions-cargos et transporter du fret.', icon: 'cargo', max: 1 },
  quality: {
    id: 'quality',
    title: 'Terminaux premium',
    text: '+1 niveau de qualité possible dans tes hubs : des passagers plus satisfaits et plus nombreux.',
    icon: 'star',
    max: 3,
  },
  workshop: {
    id: 'workshop',
    title: 'Grand atelier',
    text: '+1 niveau d’atelier de maintenance possible : révisions moins chères, moins de pannes.',
    icon: 'wrench',
    max: 2,
  },
  bigger: {
    id: 'bigger',
    title: 'Avions plus gros',
    text: 'Une catégorie d’avions de plus, en avance sur l’échelon.',
    icon: 'plane',
    max: 4,
  },
  hub: { id: 'hub', title: 'Hub supplémentaire', text: 'Tu peux acheter un hub de plus dans le pays.', icon: 'hub', max: 3 },
  intl: { id: 'intl', title: 'Droits internationaux', text: 'Tu peux ouvrir des lignes vers l’étranger.', icon: 'globe', max: 1 },
  deal: { id: 'deal', title: 'Négociateur', text: '−5 % sur le prix de tous les avions, neufs ou d’occasion.', icon: 'deal', max: 3 },
  school: {
    id: 'school',
    title: 'École de pilotes',
    text: 'Formations et qualifications deux fois plus rapides, à moitié prix.',
    icon: 'school',
    max: 1,
  },
  capital: { id: 'capital', title: 'Investisseurs', text: '+20 % de capital de départ à chaque nouvel échelon.', icon: 'money', max: 3 },
};

export function perkCount(c: Campaign, id: PerkId): number {
  let n = 0;
  for (const p of c.perks) if (p === id) n++;
  return n;
}

// ───────────────────────── Limites ─────────────────────────

export interface Limits {
  fleet: number;
  lines: number;
  hubs: number;
  classCap: number;
  quality: number;
  workshop: number;
  cargo: boolean;
  recruit: boolean;
  intl: boolean;
  school: boolean;
  /** Remise sur les avions (0 à 0,15). */
  discount: number;
}

function limitsFor(level: number, c: Campaign): Limits {
  const L = levelSpec(level);
  return {
    fleet: L.fleet + 2 * perkCount(c, 'fleet'),
    lines: L.lines + 2 * perkCount(c, 'lines'),
    hubs: 1 + perkCount(c, 'hub'),
    classCap: Math.min(CLASS_ORDER.length - 1, L.classCap + perkCount(c, 'bigger')),
    quality: Math.min(QUALITY_MAX, L.quality + perkCount(c, 'quality')),
    workshop: Math.min(MAINTENANCE_MAX, L.workshop + perkCount(c, 'workshop')),
    cargo: perkCount(c, 'cargo') > 0,
    recruit: perkCount(c, 'recruit') > 0,
    intl: L.intl || perkCount(c, 'intl') > 0,
    school: perkCount(c, 'school') > 0,
    discount: 0.05 * perkCount(c, 'deal'),
  };
}

/**
 * Limites en vigueur dans la partie, ou null s'il n'y en a pas (partie libre,
 * ou mode par échelons terminé).
 */
export function limits(state: GameState): Limits | null {
  const c = state.campaign;
  if (!c || c.finished) return null;
  return limitsFor(c.level, c);
}

/** Pourquoi ce modèle d'avion n'est pas (encore) autorisé, ou null s'il l'est. */
export function modelProblem(state: GameState, m: AircraftModel): string | null {
  const lim = limits(state);
  if (!lim) return null;
  if (CLASS_ORDER.indexOf(m.category) > lim.classCap) {
    return `Catégorie « ${CATEGORY_LABEL[m.category]} » pas encore autorisée : elle arrive avec un échelon plus élevé ou l’amélioration « ${PERKS.bigger.title} ».`;
  }
  if (m.kind === 'cargo' && !lim.cargo) return `Les avions-cargos se débloquent avec l’amélioration « ${PERKS.cargo.title} ».`;
  return null;
}

// ───────────────────────── Pays et hubs possibles ─────────────────────────

const domesticCache = new WeakMap<GameData, Map<string, string[]>>();

function domesticMap(data: GameData): Map<string, string[]> {
  let map = domesticCache.get(data);
  if (!map) {
    map = new Map();
    for (const [iata, routes] of data.routesByAirport) {
      const a = data.airportByIata.get(iata);
      if (!a) continue;
      const list: string[] = [];
      for (const r of routes) {
        const other = r.a === iata ? r.b : r.a;
        if (data.airportByIata.get(other)?.country === a.country) list.push(other);
      }
      if (list.length) map.set(iata, list);
    }
    domesticCache.set(data, map);
  }
  return map;
}

/** Aéroports du même pays reliés à cet aéroport par une vraie ligne. */
export function domesticDests(data: GameData, iata: string): string[] {
  return domesticMap(data).get(iata) ?? [];
}

/** Nombre d'aéroports du pays qui ont au moins une ligne intérieure. */
export function networkSize(data: GameData, country: string): number {
  let n = 0;
  for (const iata of domesticMap(data).keys()) if (data.airportByIata.get(iata)?.country === country) n++;
  return n;
}

/** Hubs où l'on peut commencer cet échelon : assez de destinations intérieures pour l'objectif. */
export function hubsFor(data: GameData, country: string, level: number): Airport[] {
  const need = levelSpec(level).airports - 1;
  return data.airportsOfCountry(country).filter((a) => domesticDests(data, a.iata).length >= need);
}

/**
 * Pays où l'on peut jouer cet échelon : un hub assez bien relié au reste du
 * pays, à un prix qui laisse de quoi acheter des avions.
 */
export function eligibleCountries(data: GameData, level: number, exclude: readonly string[] = []): Country[] {
  const L = levelSpec(level);
  const need = L.airports - 1;
  const budget = L.capital * FIRST_HUB_BUDGET_SHARE;
  const okCountries = new Set<string>();
  for (const [iata, dests] of domesticMap(data)) {
    if (dests.length < need) continue;
    const a = data.airportByIata.get(iata)!;
    if (a.price <= budget) okCountries.add(a.country);
  }
  return data.playableCountries().filter((c) => okCountries.has(c.code) && !exclude.includes(c.code));
}

// ───────────────────────── Objectifs ─────────────────────────

export function newCampaign(t: number): Campaign {
  return {
    level: 1,
    perks: [],
    done: [],
    goals: { airports: 0, satisfaction: 0, profit: 0 },
    reached: { airports: false, satisfaction: false, profit: false },
    cleared: false,
    finished: false,
    levelStartedAt: t,
    capital: LEVELS[0].capital,
  };
}

/** Objectifs d'un échelon, pour ce hub de départ. */
export function levelGoals(data: GameData, level: number, hub: string): Record<GoalId, number> {
  const L = levelSpec(level);
  return {
    airports: Math.max(2, Math.min(L.airports, 1 + domesticDests(data, hub).length)),
    satisfaction: L.satisfaction,
    profit: L.profit,
  };
}

/**
 * Bénéfices réalisés depuis le début de l'échelon : recettes des vols moins
 * les frais de fonctionnement, avant impôt. Les achats (avions, hubs,
 * améliorations) n'y comptent pas : ce sont des investissements.
 */
export function levelProfit(state: GameState): number {
  let total = 0;
  for (const m of state.history) total += summarize(m).profitBeforeTax;
  return total + summarize(state.ledger).profitBeforeTax;
}

/** Aéroports du pays déjà reliés : les hubs, et les destinations dont la ligne tourne vraiment. */
export function linkedAirports(ctx: Ctx): Set<string> {
  const { state: s, data } = ctx;
  const country = s.company.country;
  const out = new Set<string>();
  for (const h of s.hubs) if (data.airportByIata.get(h.iata)?.country === country) out.add(h.iata);
  for (const l of s.lines) {
    if (l.stats.flights < LINKED_FLIGHTS) continue;
    if (data.airportByIata.get(l.dest)?.country === country) out.add(l.dest);
  }
  return out;
}

export interface GoalProgress {
  id: GoalId;
  title: string;
  /** Valeur actuelle et objectif, en clair. */
  now: string;
  target: string;
  /** Avancement de 0 à 1. */
  ratio: number;
  reached: boolean;
  hint: string;
}

/** Où en sont les trois objectifs de l'échelon en cours. */
export function progress(ctx: Ctx, t: number): GoalProgress[] {
  const { state: s, data } = ctx;
  const c = s.campaign;
  if (!c) return [];
  void t;
  const linked = linkedAirports(ctx).size;
  const profit = levelProfit(s);
  const all = c.goals.airports >= networkSize(data, s.company.country);
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    {
      id: 'airports',
      title: all ? 'Relier tout le pays' : `Relier ${c.goals.airports} aéroports du pays`,
      now: String(Math.min(linked, c.goals.airports)),
      target: String(c.goals.airports),
      ratio: clamp(linked / c.goals.airports),
      reached: c.reached.airports || linked >= c.goals.airports,
      hint: `Un aéroport compte quand sa ligne a fait ${LINKED_FLIGHTS} vols. Ton hub compte aussi.`,
    },
    {
      id: 'satisfaction',
      title: 'Satisfaire les passagers',
      now: `${Math.floor(s.reputation)} %`,
      target: `${c.goals.satisfaction} %`,
      ratio: clamp((s.reputation - 40) / (c.goals.satisfaction - 40)),
      reached: c.reached.satisfaction || s.reputation >= c.goals.satisfaction,
      hint: 'Avions en bon état, hub de qualité, bons pilotes et prix raisonnables font monter la satisfaction.',
    },
    {
      id: 'profit',
      title: 'Gagner de l’argent',
      now: money(profit),
      target: money(c.goals.profit),
      ratio: clamp(profit / c.goals.profit),
      reached: c.reached.profit || profit >= c.goals.profit,
      hint: 'Les bénéfices de l’échelon : recettes des vols moins les frais de fonctionnement. Les achats d’avions et de hubs n’y comptent pas.',
    },
  ];
}

export function goalsReached(c: Campaign): number {
  return GOAL_IDS.reduce((n, id) => n + (c.reached[id] ? 1 : 0), 0);
}

/** Nombre d'améliorations à choisir en quittant l'échelon : deux si les trois objectifs sont atteints. */
export function picksAllowed(c: Campaign): number {
  return goalsReached(c) >= GOAL_IDS.length ? 2 : 1;
}

/**
 * À appeler régulièrement (chaque jour de jeu, et après une action) : retient
 * les objectifs atteints et ouvre l'échelon suivant quand il y en a assez.
 */
export function evaluate(ctx: Ctx, t: number): void {
  const s = ctx.state;
  const c = s.campaign;
  if (!c || c.finished || s.bankrupt) return;
  for (const g of progress(ctx, t)) {
    if (!g.reached || c.reached[g.id]) continue;
    c.reached[g.id] = true;
    log(ctx, 'good', `Objectif atteint : ${g.title.toLowerCase()} (${g.target})`, undefined, t);
  }
  if (c.cleared || goalsReached(c) < GOALS_TO_CLEAR) return;
  c.cleared = true;
  if (c.level >= LEVELS.length) {
    finish(ctx, t);
    return;
  }
  log(
    ctx,
    'good',
    `Échelon ${c.level} réussi ! Un nouveau pays t’attend, avec une amélioration à choisir. Tu peux aussi rester pour atteindre le troisième objectif (deux améliorations au lieu d’une).`,
    undefined,
    t,
  );
}

/** Dernier échelon réussi : la campagne est terminée, toutes les limites tombent. */
function finish(ctx: Ctx, t: number): void {
  const s = ctx.state;
  const c = s.campaign!;
  c.finished = true;
  c.done.push({
    country: s.company.country,
    level: c.level,
    days: Math.max(1, Math.round((t - c.levelStartedAt) / 86_400_000)),
    goals: goalsReached(c),
    profit: Math.round(levelProfit(s)),
  });
  log(ctx, 'good', 'Tu as gravi tous les échelons ! Ta compagnie n’a plus aucune limite : le monde est à toi.', undefined, t);
}

// ───────────────────────── Choix entre deux échelons ─────────────────────────

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Améliorations encore utiles pour l'échelon suivant. */
function availablePerks(c: Campaign): PerkId[] {
  const next = levelSpec(c.level + 1);
  const out: PerkId[] = [];
  for (const p of Object.values(PERKS)) {
    const n = perkCount(c, p.id);
    if (n >= p.max) continue;
    if (p.id === 'intl' && next.intl) continue;
    if (p.id === 'bigger' && next.classCap + n >= CLASS_ORDER.length - 1) continue;
    if (p.id === 'quality' && next.quality + n >= QUALITY_MAX) continue;
    if (p.id === 'workshop' && next.workshop + n >= MAINTENANCE_MAX) continue;
    out.push(p.id);
  }
  return out;
}

/**
 * Les trois améliorations proposées à la fin de l'échelon en cours. Le tirage
 * dépend de la partie et de l'échelon : il ne change pas si on recharge le jeu.
 * Le bureau de recrutement est toujours proposé tant qu'on ne l'a pas.
 */
export function perkOffer(state: GameState): PerkId[] {
  const c = state.campaign;
  if (!c) return [];
  const pool = availablePerks(c);
  const rng = makeRng({ seed: hashSeed(`${state.id}:${c.level}`) });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const offer = pool.slice(0, 3);
  if (pool.includes('recruit') && !offer.includes('recruit')) offer[0] = 'recruit';
  return offer;
}

/** Capital de départ du prochain échelon : base, investisseurs, et les bénéfices réalisés ici. */
export function nextCapital(state: GameState, extraPerks: readonly PerkId[] = []): number {
  const c = state.campaign;
  if (!c) return 0;
  const next = levelSpec(c.level + 1);
  const investors = perkCount(c, 'capital') + extraPerks.filter((p) => p === 'capital').length;
  const base = next.capital * (1 + 0.2 * investors);
  const carry = Math.min(next.capital * CARRY_MAX, Math.max(0, levelProfit(state)));
  return Math.round((base + carry) / 100_000) * 100_000;
}

/** Ce que les limites autoriseront à l'échelon suivant (pour présenter les choix). */
export function nextLimits(state: GameState, extraPerks: readonly PerkId[] = []): Limits | null {
  const c = state.campaign;
  if (!c) return null;
  return limitsFor(c.level + 1, { ...c, perks: [...c.perks, ...extraPerks] });
}
