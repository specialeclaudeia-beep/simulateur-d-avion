/**
 * Horloge du jeu.
 *
 * Par défaut le temps de jeu suit le temps réel (×1). On peut l'accélérer
 * (×10, ×100…) ou le mettre en pause. Tout ce qui dépend du temps (jour/nuit,
 * position des avions, économie) doit lire `clock.now()` plutôt que `Date.now()`.
 */

export const SPEEDS = [0, 1, 10, 100, 1000, 10000] as const;
export type Speed = (typeof SPEEDS)[number];

type Listener = (clock: GameClock) => void;

export class GameClock {
  /** Temps de jeu (ms epoch) au moment de l'ancrage. */
  private anchorGame: number;
  /** Temps réel (performance.now) au moment de l'ancrage. */
  private anchorReal: number;
  private _speed: Speed;
  private listeners = new Set<Listener>();

  constructor(startMs = Date.now(), speed: Speed = 1) {
    this.anchorGame = startMs;
    this.anchorReal = performance.now();
    this._speed = speed;
  }

  /** Temps de jeu courant, en millisecondes depuis 1970 (comme Date.now()). */
  now(): number {
    return this.anchorGame + (performance.now() - this.anchorReal) * this._speed;
  }

  get speed(): Speed {
    return this._speed;
  }

  get paused(): boolean {
    return this._speed === 0;
  }

  setSpeed(speed: Speed): void {
    this.reanchor();
    this._speed = speed;
    this.emit();
  }

  /** Revient à l'heure réelle, vitesse ×1. */
  resetToRealTime(): void {
    this.anchorGame = Date.now();
    this.anchorReal = performance.now();
    this._speed = 1;
    this.emit();
  }

  /** Place l'horloge à un instant donné (utile pour charger une sauvegarde). */
  setTime(ms: number): void {
    this.anchorGame = ms;
    this.anchorReal = performance.now();
    this.emit();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private reanchor(): void {
    this.anchorGame = this.now();
    this.anchorReal = performance.now();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this);
  }
}
