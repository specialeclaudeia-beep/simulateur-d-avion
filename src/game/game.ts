/**
 * Chef d'orchestre du jeu : relie la partie à l'horloge, fait avancer la
 * simulation plusieurs fois par seconde, enregistre automatiquement et
 * prévient l'interface (changements, nouveaux événements).
 */
import type { GameClock, Speed } from '../core/clock';
import { DAY, OFFLINE_MAX_MS } from './config';
import { invalidate, type ActionResult, type Ctx, makeCtx } from './context';
import type { GameData } from './data';
import { setFlightSource } from './flights';
import { createNewGame, type NewGameParams } from './newGame';
import { advance } from './sim';
import { loadFromStorage, saveToStorage, type LoadResult, type SaveFile } from './save';
import type { GameState, LogEntry } from './state';

type Listener = () => void;
type LogListener = (entries: LogEntry[]) => void;

export interface AwaySummary {
  gameMs: number;
  flights: number;
  cash: number;
  breakdowns: number;
}

const TICK_MS = 250;
const AUTOSAVE_MS = 20_000;

export class Game {
  private ctx: Ctx | null = null;
  private tickListeners = new Set<Listener>();
  private changeListeners = new Set<Listener>();
  private logListeners = new Set<LogListener>();
  private timer = 0;
  private dirty = false;
  private lastSave = 0;
  private saveSoon = 0;
  private speedBeforeHidden: Speed | null = null;
  private adjustingClock = false;

  constructor(
    readonly data: GameData,
    readonly clock: GameClock,
    /** Prévenir la carte d'un saut dans le temps (jour/nuit). */
    private onTimeJump: () => void = () => {},
  ) {
    setFlightSource(() => this.ctx?.state ?? null);
    clock.onChange(() => this.guardClock());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.saveNow());
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  get state(): GameState {
    if (!this.ctx) throw new Error('Aucune partie en cours');
    return this.ctx.state;
  }

  /** Contexte de simulation (pour les calculs de l'interface). */
  get context(): Ctx {
    if (!this.ctx) throw new Error('Aucune partie en cours');
    return this.ctx;
  }

  now(): number {
    return this.clock.now();
  }

  // ── Démarrage ──

  /** Nouvelle partie, au temps actuel de l'horloge. */
  newGame(params: NewGameParams): void {
    this.ctx = createNewGame(this.data, params, Math.round(this.clock.now()));
    this.afterStart();
    this.saveNow();
  }

  /** Reprend une partie enregistrée. Renvoie le résumé de ce qui s'est passé pendant l'absence. */
  loadSave(save: SaveFile): AwaySummary | null {
    this.ctx = makeCtx(this.data, save.state);
    const s = this.ctx.state;
    const away = s.settings.offlineProgress ? Math.min(OFFLINE_MAX_MS, Math.max(0, Date.now() - save.savedAtReal)) : 0;
    this.adjustingClock = true;
    this.clock.setTime(s.time + away);
    this.adjustingClock = false;
    this.onTimeJump();
    let summary: AwaySummary | null = null;
    if (away > 60_000) {
      const before = { cash: s.cash, flights: s.stats.flights, logLen: s.log.length, first: s.log[0] };
      advance(this.ctx, this.clock.now());
      const newEntries = before.first ? s.log.slice(0, s.log.indexOf(before.first)) : s.log;
      summary = {
        gameMs: away,
        flights: s.stats.flights - before.flights,
        cash: s.cash - before.cash,
        breakdowns: newEntries.filter((e) => e.kind === 'bad' && e.text.startsWith('Panne')).length,
      };
      this.ctx.fresh = [];
    }
    this.afterStart();
    return summary;
  }

  /** Lit la sauvegarde du navigateur et la charge si elle existe. */
  resume(): { result: LoadResult; summary: AwaySummary | null } {
    const result = loadFromStorage();
    if (result.status !== 'ok') return { result, summary: null };
    return { result, summary: this.loadSave(result.save) };
  }

  /** Abandonne la partie en cours (la sauvegarde est effacée par l'appelant). */
  quit(): void {
    this.ctx = null;
    window.clearInterval(this.timer);
    this.timer = 0;
    this.emitChange();
  }

  private afterStart(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.lastSave = performance.now();
    this.emitChange();
  }

  // ── Boucle ──

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    advance(ctx, this.clock.now());
    if (ctx.fresh.length) {
      const entries = ctx.fresh;
      ctx.fresh = [];
      this.dirty = true;
      for (const fn of this.logListeners) fn(entries);
      this.emitChange();
    }
    for (const fn of this.tickListeners) fn();
    if (this.dirty && performance.now() - this.lastSave > AUTOSAVE_MS) this.saveNow();
  }

  /**
   * Exécute une action du joueur au temps actuel : la partie est d'abord
   * simulée jusqu'à maintenant, puis l'action est appliquée et enregistrée.
   */
  run<A extends unknown[]>(action: (ctx: Ctx, t: number, ...args: A) => ActionResult, ...args: A): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return { ok: false, error: 'Aucune partie en cours.' };
    if (ctx.state.bankrupt) return { ok: false, error: 'La compagnie a fait faillite.' };
    const t = Math.max(ctx.state.time, Math.round(this.clock.now()));
    advance(ctx, t);
    const res = action(ctx, t, ...args);
    if (res.ok) {
      invalidate(ctx);
      this.dirty = true;
      window.clearTimeout(this.saveSoon);
      this.saveSoon = window.setTimeout(() => this.saveNow(), 1500);
    }
    if (ctx.fresh.length) {
      const entries = ctx.fresh;
      ctx.fresh = [];
      for (const fn of this.logListeners) fn(entries);
    }
    this.emitChange();
    return res;
  }

  saveNow(): boolean {
    if (!this.ctx) return false;
    advance(this.ctx, this.clock.now());
    const okSave = saveToStorage(this.ctx.state);
    if (okSave) {
      this.dirty = false;
      this.lastSave = performance.now();
    }
    return okSave;
  }

  // ── Horloge ──

  /** Le temps d'une partie ne peut pas reculer (le bouton « Maintenant » ramène alors à ×1). */
  private guardClock(): void {
    if (!this.ctx || this.adjustingClock) return;
    const s = this.ctx.state;
    if (this.clock.now() < s.time - 1000) {
      this.adjustingClock = true;
      this.clock.setTime(s.time);
      this.adjustingClock = false;
      this.onTimeJump();
    }
  }

  /** Onglet caché : on repasse en temps réel (comme jeu fermé) et on enregistre. */
  private onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      if (this.clock.speed > 1) {
        this.speedBeforeHidden = this.clock.speed;
        this.clock.setSpeed(1);
      }
      this.saveNow();
    } else if (this.speedBeforeHidden !== null) {
      const speed = this.speedBeforeHidden;
      this.speedBeforeHidden = null;
      this.clock.setSpeed(speed);
    }
  }

  // ── Abonnements ──

  onTick(fn: Listener): () => void {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  onChange(fn: Listener): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onLog(fn: LogListener): () => void {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  }

  private emitChange(): void {
    for (const fn of this.changeListeners) fn();
  }
}

/** Durée lisible d'une absence, ex. « 8 h 12 min » ou « 3 jours ». */
export function awayLabel(ms: number): string {
  if (ms >= 2 * DAY) return `${Math.round(ms / DAY)} jours`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
