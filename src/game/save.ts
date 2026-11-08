/**
 * Sauvegarde locale (dans le navigateur) et export / import d'un fichier.
 *
 * Chaque sauvegarde porte un numéro de version. Si le format change un jour,
 * on ajoute une étape dans `migrate()` pour convertir les anciennes parties :
 * une partie existante ne doit jamais être perdue.
 */
import { DEFAULT_SETTINGS, SAVE_VERSION, type GameState } from './state';

const FORMAT = 'simulateur-compagnie-aerienne';
const KEY = 'simulateur-compagnie:partie';
const BROKEN_KEY = 'simulateur-compagnie:partie-illisible';

export interface SaveFile {
  format: typeof FORMAT;
  version: number;
  /** Heure réelle de la sauvegarde (pour faire passer le temps pendant l'absence). */
  savedAtReal: number;
  state: GameState;
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
    return { ok: false, error: 'Ce fichier n’est pas une sauvegarde lisible.' };
  }
  if (!raw || typeof raw !== 'object' || (raw as SaveFile).format !== FORMAT) {
    return { ok: false, error: 'Ce fichier n’est pas une sauvegarde du simulateur.' };
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
  // (Version 1 : format d'origine. Les prochaines versions ajouteront leurs étapes ici,
  //  par exemple : if (fromVersion < 2) { s.nouveauChamp = valeurParDéfaut; })
  void fromVersion;
  // Filets de sécurité si un champ manque.
  s.settings = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
  s.log ??= [];
  s.history ??= [];
  s.relations ??= {};
  s.version = SAVE_VERSION;
  return s;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Enregistre la partie. Renvoie false si le navigateur refuse (mode privé, espace plein…). */
export function saveToStorage(state: GameState): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

export type LoadResult = { status: 'none' } | { status: 'ok'; save: SaveFile } | { status: 'broken'; error: string };

/** Lit la partie enregistrée. Une sauvegarde illisible est mise de côté, jamais effacée. */
export function loadFromStorage(): LoadResult {
  const ls = storage();
  if (!ls) return { status: 'none' };
  let text: string | null = null;
  try {
    text = ls.getItem(KEY);
  } catch {
    return { status: 'none' };
  }
  if (!text) return { status: 'none' };
  const res = parseSave(text);
  if (res.ok) return { status: 'ok', save: res.save };
  try {
    ls.setItem(BROKEN_KEY, text);
    ls.removeItem(KEY);
  } catch {
    /* tant pis : on garde au moins l'original */
  }
  return { status: 'broken', error: res.error };
}

export function clearStorage(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* rien à faire */
  }
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
