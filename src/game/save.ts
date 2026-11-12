/**
 * Sauvegarde locale (dans le navigateur) et export / import d'un fichier.
 *
 * Il y a un emplacement par mode de jeu : partie libre avec concurrence,
 * partie libre sans concurrence, mode par échelons. On peut donc mener les
 * trois de front.
 *
 * Chaque sauvegarde porte un numéro de version. Si le format change, on
 * ajoute une étape dans `migrate()` pour convertir les anciennes parties :
 * une partie existante ne doit jamais être perdue.
 */
import { DEFAULT_SETTINGS, SAVE_VERSION, newStats, type GameState, type GameStats, type LedgerKey, type Logo } from './state';

const FORMAT = 'simulateur-compagnie-aerienne';

/** Emplacements de sauvegarde, un par mode de jeu. */
export type SlotId = 'concurrence' | 'solo' | 'echelons';

export const SLOTS: readonly SlotId[] = ['concurrence', 'solo', 'echelons'];

export const SLOT_LABEL: Record<SlotId, string> = {
  concurrence: 'Partie libre avec concurrence',
  solo: 'Partie libre sans concurrence',
  echelons: 'Mode par échelons',
};

/**
 * Clés du navigateur. Celle de la partie libre avec concurrence est la clé
 * d'origine : les parties d'avant les modes de jeu s'y trouvent déjà.
 */
const KEYS: Record<SlotId, string> = {
  concurrence: 'simulateur-compagnie:partie',
  solo: 'simulateur-compagnie:partie-sans-concurrence',
  echelons: 'simulateur-compagnie:partie-echelons',
};
const LAST_KEY = 'simulateur-compagnie:derniere';
const brokenKey = (slot: SlotId) => `${KEYS[slot]}-illisible`;

export interface SaveFile {
  format: typeof FORMAT;
  version: number;
  /** Heure réelle de la sauvegarde (pour faire passer le temps pendant l'absence). */
  savedAtReal: number;
  state: GameState;
}

/** Emplacement où se range une partie, d'après son mode. */
export function slotOf(state: Pick<GameState, 'mode' | 'competition'>): SlotId {
  if (state.mode === 'echelons') return 'echelons';
  return state.competition === false ? 'solo' : 'concurrence';
}

export function serialize(state: GameState, now = Date.now()): string {
  const file: SaveFile = { format: FORMAT, version: SAVE_VERSION, savedAtReal: now, state };
  return JSON.stringify(file);
}

export type ParseResult = { ok: true; save: SaveFile } | { ok: false; error: string };

export function parseSave(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Ce n’est pas une sauvegarde lisible (fichier ou code incomplet ?).' };
  }
  if (!raw || typeof raw !== 'object' || (raw as SaveFile).format !== FORMAT) {
    return { ok: false, error: 'Ce n’est pas une sauvegarde du simulateur.' };
  }
  const file = raw as SaveFile;
  if (typeof file.version !== 'number' || file.version > SAVE_VERSION) {
    return { ok: false, error: 'Sauvegarde créée par une version plus récente du jeu : mets le jeu à jour.' };
  }
  try {
    const state = migrate(file.state, file.version);
    if (!state?.company?.name || !Array.isArray(state.hubs) || !state.hubs.length) throw new Error('incomplète');
    return { ok: true, save: { ...file, version: SAVE_VERSION, state } };
  } catch {
    return { ok: false, error: 'Sauvegarde abîmée ou incomplète.' };
  }
}

/** Convertit une partie d'une ancienne version vers la version actuelle. */
export function migrate(state: GameState, fromVersion: number): GameState {
  const s = state;
  if (fromVersion < 2) {
    // Version 2 : modes de jeu. Une partie d'avant est une partie libre avec concurrence.
    s.mode = 'libre';
    s.competition = true;
    s.rivalry = {};
    s.campaign = null;
  }
  // Filets de sécurité si un champ manque.
  s.settings = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
  s.log ??= [];
  s.history ??= [];
  s.relations ??= {};
  s.mode ??= 'libre';
  s.competition ??= true;
  s.rivalry ??= {};
  s.campaign ??= null;
  s.stats = backfillStats(s);
  s.crashes ??= [];
  s.version = SAVE_VERSION;
  return s;
}

/**
 * Statistiques ajoutées après coup : pour une ancienne partie, on les
 * reconstitue au mieux (comptes des mois gardés, flotte actuelle, distance).
 */
function backfillStats(s: GameState): GameStats {
  const old = (s.stats ?? {}) as Partial<GameStats>;
  const st: GameStats = { ...newStats(), ...old };
  if (old.earned === undefined || old.spent === undefined) {
    let earned = 0;
    let spent = 0;
    for (const month of [...(s.history ?? []), s.ledger].filter(Boolean)) {
      for (const [key, v] of Object.entries(month.entries ?? {})) {
        if (INCOME_KEYS.includes(key as LedgerKey)) earned += v ?? 0;
        else spent += v ?? 0;
      }
    }
    st.earned = Math.max(earned, st.revenue);
    st.spent = spent;
  }
  if (old.hours === undefined) st.hours = st.km / AVERAGE_KMH;
  if (old.bought === undefined) {
    const fromMakers = Object.values(s.relations ?? {}).reduce((a, b) => a + b, 0);
    st.bought = Math.max(fromMakers, s.aircraft?.length ?? 0);
  }
  return st;
}

/** Recettes dans les comptes du mois (le reste est dépensé). */
const INCOME_KEYS: LedgerKey[] = ['tickets', 'cargo', 'assetSales'];
/** Vitesse moyenne de bloc à bloc, pour estimer les heures de vol d'une ancienne partie. */
const AVERAGE_KMH = 650;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Enregistre la partie dans l'emplacement de son mode. Renvoie false si le navigateur refuse (mode privé, espace plein…). */
export function saveToStorage(state: GameState): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    const slot = slotOf(state);
    ls.setItem(KEYS[slot], serialize(state));
    ls.setItem(LAST_KEY, slot);
    return true;
  } catch {
    return false;
  }
}

export type LoadResult = { status: 'none' } | { status: 'ok'; save: SaveFile } | { status: 'broken'; error: string };

/** Lit la partie d'un emplacement. Une sauvegarde illisible est mise de côté, jamais effacée. */
export function loadFromStorage(slot: SlotId = 'concurrence'): LoadResult {
  const ls = storage();
  if (!ls) return { status: 'none' };
  let text: string | null = null;
  try {
    text = ls.getItem(KEYS[slot]);
  } catch {
    return { status: 'none' };
  }
  if (!text) return { status: 'none' };
  const res = parseSave(text);
  if (res.ok) return { status: 'ok', save: res.save };
  try {
    ls.setItem(brokenKey(slot), text);
    ls.removeItem(KEYS[slot]);
  } catch {
    /* tant pis : on garde au moins l'original */
  }
  return { status: 'broken', error: res.error };
}

export function clearStorage(slot: SlotId = 'concurrence'): void {
  try {
    storage()?.removeItem(KEYS[slot]);
  } catch {
    /* rien à faire */
  }
}

/** Dernier emplacement joué (pour « Reprendre »), s'il contient toujours une partie. */
export function lastSlot(): SlotId | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const last = ls.getItem(LAST_KEY) as SlotId | null;
    if (last && SLOTS.includes(last) && ls.getItem(KEYS[last])) return last;
    return SLOTS.find((slot) => ls.getItem(KEYS[slot])) ?? null;
  } catch {
    return null;
  }
}

/** L'essentiel d'une partie enregistrée, pour la page d'accueil. */
export interface SlotSummary {
  slot: SlotId;
  name: string;
  code: string;
  color: string;
  logo: Logo;
  country: string;
  cash: number;
  /** Temps de jeu de la partie et heure réelle de l'enregistrement. */
  time: number;
  startedAt: number;
  savedAtReal: number;
  hubs: number;
  aircraft: number;
  lines: number;
  flights: number;
  pax: number;
  /** Mode par échelons : échelon en cours, pays terminés, campagne finie. */
  level: number | null;
  done: { country: string; level: number; days: number; goals: number; profit: number }[];
  finished: boolean;
  bankrupt: boolean;
}

/** Résumé d'un emplacement, ou null s'il est vide (ou illisible). */
export function slotSummary(slot: SlotId): SlotSummary | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const text = ls.getItem(KEYS[slot]);
    if (!text) return null;
    const file = JSON.parse(text) as SaveFile;
    const s = file?.state;
    if (file?.format !== FORMAT || !s?.company?.name) return null;
    return {
      slot,
      name: s.company.name,
      code: s.company.code,
      color: s.company.color,
      logo: s.company.logo,
      country: s.company.country,
      cash: s.cash,
      time: s.time,
      startedAt: s.startedAt,
      savedAtReal: file.savedAtReal,
      hubs: s.hubs?.length ?? 0,
      aircraft: s.aircraft?.length ?? 0,
      lines: s.lines?.length ?? 0,
      flights: s.stats?.flights ?? 0,
      pax: s.stats?.pax ?? 0,
      level: s.campaign?.level ?? null,
      done: s.campaign?.done ?? [],
      finished: s.campaign?.finished ?? false,
      bankrupt: !!s.bankrupt,
    };
  } catch {
    return null;
  }
}

export function slotSummaries(): SlotSummary[] {
  const out: SlotSummary[] = [];
  for (const slot of SLOTS) {
    const sum = slotSummary(slot);
    if (sum) out.push(sum);
  }
  return out;
}

/** Nom de fichier pour l'export, ex. « air-breizh-2026-11-08.json ». */
export function exportFileName(state: GameState): string {
  const slug = state.company.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const d = new Date(state.time).toISOString().slice(0, 10);
  return `${slug || 'compagnie'}-${d}.json`;
}
