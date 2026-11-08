/**
 * Contexte de simulation : la partie en cours + les données + le hasard,
 * plus quelques caches recalculés à la demande (jamais sauvegardés).
 */
import { LOG_MAX } from './config';
import type { GameData } from './data';
import { makeRng, type Rng } from './rng';
import type { GameState, LogEntry, LogKind } from './state';

export interface Ctx {
  data: GameData;
  state: GameState;
  rng: Rng;
  /** Événements apparus depuis la dernière lecture (pour les notifications). */
  fresh: LogEntry[];
  /** Fréquences des lignes (vols par jour et par sens), recalculées si besoin. */
  freqCache: Map<string, { pax: number; cargo: number }> | null;
}

export function makeCtx(data: GameData, state: GameState): Ctx {
  return { data, state, rng: makeRng(state), fresh: [], freqCache: null };
}

/** À appeler quand les avions, pilotes, programmes ou lignes changent. */
export function invalidate(ctx: Ctx): void {
  ctx.freqCache = null;
}

export function log(ctx: Ctx, kind: LogKind, text: string, ref?: LogEntry['ref'], t = ctx.state.time): void {
  const entry: LogEntry = { t, kind, text, ...(ref ? { ref } : {}) };
  ctx.state.log.unshift(entry);
  if (ctx.state.log.length > LOG_MAX) ctx.state.log.length = LOG_MAX;
  ctx.fresh.push(entry);
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export const ok = (message?: string): ActionResult => ({ ok: true, ...(message ? { message } : {}) });
export const fail = (error: string): ActionResult => ({ ok: false, error });
