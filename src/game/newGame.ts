/**
 * Création d'une nouvelle partie : la compagnie, son pays, son capital de
 * départ et son premier hub.
 */
import { DIFFICULTIES, FUEL_PRICE_START, type Difficulty } from './config';
import { buyHub } from './actions';
import { hubsFor, levelGoals, levelSpec, newCampaign } from './campaign';
import { log, makeCtx, type Ctx } from './context';
import type { GameData } from './data';
import { newLedger } from './ledger';
import { refreshMarkets } from './sim';
import { DEFAULT_SETTINGS, SAVE_VERSION, type GameMode, type GameState, type Logo } from './state';
import { nextUtcDay, nextUtcMonth } from './time';

export interface NewGameParams {
  name: string;
  code: string;
  color: string;
  logo: Logo;
  country: string;
  difficulty: Difficulty;
  hub: string;
  /** Partie libre (par défaut) ou mode par échelons. */
  mode?: GameMode;
  /** Partie libre : avec (par défaut) ou sans concurrence. Le mode par échelons se joue toujours avec. */
  competition?: boolean;
}

/** Code à 2 caractères proposé à partir du nom (ex. « Air Breizh » → « AB »). */
export function suggestCode(name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).slice(0, 2);
  return (clean.replace(/\s/g, '') + 'X').slice(0, 2);
}

export function createNewGame(data: GameData, p: NewGameParams, now: number, seed = Math.floor(Math.random() * 2 ** 31)): Ctx {
  const mode: GameMode = p.mode ?? 'libre';
  const campaign = mode === 'echelons' ? newCampaign(now) : null;
  if (campaign && !hubsFor(data, p.country, 1).some((a) => a.iata === p.hub)) {
    throw new Error('Ce hub n’a pas assez de lignes intérieures pour commencer le mode par échelons.');
  }
  const state: GameState = {
    version: SAVE_VERSION,
    id: `${now.toString(36)}-${seed.toString(36)}`,
    startedAt: now,
    time: now,
    seed,
    company: {
      name: p.name.trim(),
      code: p.code.toUpperCase(),
      color: p.color,
      logo: p.logo,
      country: p.country,
      difficulty: p.difficulty,
      founded: now,
    },
    cash: campaign ? campaign.capital : DIFFICULTIES[p.difficulty].capital,
    debt: 0,
    hubs: [],
    aircraft: [],
    pilots: [],
    lines: [],
    market: { used: [], pilots: [], refreshedAt: now },
    relations: {},
    ledger: newLedger(now),
    history: [],
    taxLossCarry: 0,
    fuelPrice: FUEL_PRICE_START,
    reputation: 50,
    negativeSince: null,
    bankrupt: false,
    nextDay: nextUtcDay(now),
    nextMonth: nextUtcMonth(now),
    counters: { aircraft: 0, pilot: 0, line: 0, listing: 0, candidate: 0, flight: 0, lineNumber: 0 },
    stats: { flights: 0, pax: 0, cargoT: 0, km: 0, revenue: 0 },
    log: [],
    settings: { ...DEFAULT_SETTINGS },
    mode,
    competition: campaign ? true : (p.competition ?? true),
    rivalry: {},
    campaign,
  };
  const ctx = makeCtx(data, state);
  log(ctx, 'good', `${state.company.name} est créée ! Capital de départ : ${(state.cash / 1e6).toLocaleString('fr-FR')} M$`, undefined, now);
  if (campaign) log(ctx, 'info', `Échelon 1, « ${levelSpec(1).name} » : ${levelSpec(1).pitch}`, undefined, now);
  const bought = buyHub(ctx, now, p.hub);
  if (!bought.ok) throw new Error(bought.error);
  if (campaign) campaign.goals = levelGoals(data, 1, p.hub);
  refreshMarkets(ctx, now);
  ctx.fresh = [];
  return ctx;
}
