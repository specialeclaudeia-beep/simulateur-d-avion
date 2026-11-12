/**
 * Classement en ligne (Supabase, gratuit). Chaque joueur garde sa partie sur
 * son appareil ; s'il rejoint le classement, le jeu envoie de temps en temps
 * un résumé de sa compagnie (valeur, passagers, échelon…). Sans réseau, rien
 * ne bloque : l'envoi est simplement retenté plus tard.
 *
 * L'appareil tire au sort un identifiant et un secret (gardés ici) : seul lui
 * peut modifier ou retirer ses lignes. Base et règles : supabase/classement.sql.
 */

const URL_BASE = 'https://oycixuoowqhgkemxzqpm.supabase.co/rest/v1';
/** Clé publique (lecture du classement et appel des deux fonctions d'envoi seulement). */
const KEY = 'sb_publishable_vqvUn0vypj3GCxjm6miOtA_QomW5glz';
const STORAGE_KEY = 'simulateur-compagnie:classement';
/** Un envoi au plus toutes les 5 minutes réelles (le forfait gratuit suffit largement). */
const SEND_EVERY_MS = 5 * 60_000;
const TIMEOUT_MS = 8000;

export interface ScoreEntry {
  player_id: string;
  game_id: string;
  pseudo: string;
  pseudo_color: string;
  airline: string;
  airline_code: string;
  airline_color: string;
  country: string;
  mode: 'libre' | 'echelons';
  competition: boolean;
  company_value: number;
  pax: number;
  flights: number;
  aircraft: number;
  lines: number;
  level: number;
  game_days: number;
  play_minutes: number;
  updated_at: string;
}

export type ScoreSnapshot = Omit<ScoreEntry, 'player_id' | 'updated_at'>;

export type SortKey = 'company_value' | 'pax' | 'level';

interface Membership {
  id: string;
  secret: string;
  joined: boolean;
  /** Dernier envoi réussi (heure réelle). */
  lastSent: number;
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const h = randomHex(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function load(): Membership {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Membership> | null;
    if (raw && typeof raw.id === 'string' && typeof raw.secret === 'string') {
      return { id: raw.id, secret: raw.secret, joined: !!raw.joined, lastSent: Number(raw.lastSent) || 0 };
    }
  } catch {
    // Stockage illisible : nouvelle identité.
  }
  return { id: newId(), secret: randomHex(24), joined: false, lastSent: 0 };
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${URL_BASE}/${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { apikey: KEY, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`serveur ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

class Leaderboard {
  private m = load();
  private pending: ScoreSnapshot | null = null;
  private sending = false;

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.flush());
  }

  get joined(): boolean {
    return this.m.joined;
  }

  get playerId(): string {
    return this.m.id;
  }

  get lastSent(): number {
    return this.m.lastSent;
  }

  /** Rejoint le classement et envoie tout de suite la compagnie en cours. */
  async join(snap: ScoreSnapshot | null): Promise<boolean> {
    this.m.joined = true;
    this.save();
    if (!snap) return true;
    this.pending = snap;
    return this.flush(true);
  }

  /** Quitte le classement : efface toutes les lignes de ce joueur sur le serveur. */
  async leave(): Promise<boolean> {
    this.m.joined = false;
    this.pending = null;
    this.save();
    try {
      await call('rpc/retirer_score', { method: 'POST', body: JSON.stringify({ p_player: this.m.id, p_secret: this.m.secret }) });
      return true;
    } catch {
      return false;
    }
  }

  /** Propose un nouveau score ; il part si le dernier envoi date de plus de 5 minutes (ou tout de suite si `now`). */
  offer(snap: ScoreSnapshot, now = false): void {
    if (!this.m.joined) return;
    this.pending = snap;
    if (now || Date.now() - this.m.lastSent >= SEND_EVERY_MS) void this.flush(now);
  }

  private async flush(force = false): Promise<boolean> {
    if (!this.m.joined || !this.pending || this.sending) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (!force && Date.now() - this.m.lastSent < SEND_EVERY_MS) return false;
    const s = this.pending;
    this.sending = true;
    try {
      const res = await call('rpc/envoyer_score', {
        method: 'POST',
        body: JSON.stringify({
          p_player: this.m.id,
          p_secret: this.m.secret,
          p_game: s.game_id,
          p_pseudo: s.pseudo,
          p_pseudo_color: s.pseudo_color,
          p_airline: s.airline,
          p_airline_code: s.airline_code,
          p_airline_color: s.airline_color,
          p_country: s.country,
          p_mode: s.mode,
          p_competition: s.competition,
          p_value: Math.round(s.company_value),
          p_pax: Math.round(s.pax),
          p_flights: Math.round(s.flights),
          p_aircraft: s.aircraft,
          p_lines: s.lines,
          p_level: s.level,
          p_game_days: s.game_days,
          p_play_minutes: s.play_minutes,
        }),
      });
      const answer = (await res.json()) as string;
      if (answer === 'ok') {
        if (this.pending === s) this.pending = null;
        this.m.lastSent = Date.now();
        this.save();
      }
      return answer === 'ok' || answer === 'trop tôt';
    } catch {
      return false; // Pas de réseau ou serveur en pause : on retentera au prochain envoi.
    } finally {
      this.sending = false;
    }
  }

  /** Les meilleurs joueurs (meilleure compagnie de chacun). Lève une erreur sans réseau. */
  async top(sort: SortKey, limit = 50): Promise<ScoreEntry[]> {
    const order = sort === 'level' ? 'level.desc,company_value.desc' : `${sort}.desc`;
    const res = await call(`classement?select=*&order=${order}&limit=${limit}`);
    return (await res.json()) as ScoreEntry[];
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.m));
    } catch {
      // Navigation privée : l'identité vaut pour cette visite.
    }
  }
}

export const leaderboard = new Leaderboard();
