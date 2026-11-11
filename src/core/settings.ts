/**
 * Paramètres de l'appli (hors sauvegarde) : qualité des graphismes, niveau de
 * détail, limite d'images par seconde, compteur de FPS et touches du clavier.
 *
 * Ils sont gardés dans ce navigateur (une partie importée sur un autre appareil
 * ne les emporte pas : un téléphone et un ordinateur n'ont pas les mêmes besoins).
 * Le son a ses propres réglages (voir audio/music.ts).
 */

export type Quality = 'low' | 'medium' | 'high';
/** Images par seconde au maximum ; 0 = sans limite (celle de l'écran). */
export type FpsLimit = 30 | 60 | 120 | 0;

export const QUALITY_LABEL: Record<Quality, string> = { low: 'Économie', medium: 'Équilibré', high: 'Élevé' };
export const DETAIL_LABEL: Record<Quality, string> = { low: 'Faible', medium: 'Moyen', high: 'Élevé' };
export const FPS_LIMITS: FpsLimit[] = [30, 60, 120, 0];

/** Actions pilotables au clavier (ordinateur). */
export const KEY_ACTIONS = [
  { id: 'pause', label: 'Pause / reprendre', group: 'Temps', def: ' ' },
  { id: 'faster', label: 'Accélérer le temps', group: 'Temps', def: '+' },
  { id: 'slower', label: 'Ralentir le temps', group: 'Temps', def: '-' },
  { id: 'panUp', label: 'Déplacer la carte vers le haut', group: 'Carte', def: 'ArrowUp' },
  { id: 'panDown', label: 'Déplacer la carte vers le bas', group: 'Carte', def: 'ArrowDown' },
  { id: 'panLeft', label: 'Déplacer la carte vers la gauche', group: 'Carte', def: 'ArrowLeft' },
  { id: 'panRight', label: 'Déplacer la carte vers la droite', group: 'Carte', def: 'ArrowRight' },
  { id: 'zoomIn', label: 'Zoomer', group: 'Carte', def: 'PageUp' },
  { id: 'zoomOut', label: 'Dézoomer', group: 'Carte', def: 'PageDown' },
  { id: 'globe', label: 'Voir le globe entier', group: 'Carte', def: 'g' },
  { id: 'north', label: 'Remettre le nord en haut', group: 'Carte', def: 'n' },
  { id: 'traffic', label: 'Afficher / masquer le trafic', group: 'Carte', def: 't' },
  { id: 'follow', label: 'Suivre l’avion sélectionné', group: 'Carte', def: 's' },
  { id: 'company', label: 'Ma compagnie', group: 'Onglets', def: 'c' },
  { id: 'hubs', label: 'Hubs', group: 'Onglets', def: 'h' },
  { id: 'fleet', label: 'Flotte', group: 'Onglets', def: 'f' },
  { id: 'pilots', label: 'Pilotes', group: 'Onglets', def: 'p' },
  { id: 'lines', label: 'Lignes', group: 'Onglets', def: 'l' },
  { id: 'finances', label: 'Finances', group: 'Onglets', def: 'b' },
  { id: 'back', label: 'Fermer / retour / menu', group: 'Jeu', def: 'Escape' },
  { id: 'mute', label: 'Couper / remettre le son', group: 'Jeu', def: 'm' },
  { id: 'fullscreen', label: 'Plein écran', group: 'Jeu', def: 'v' },
] as const;

export type KeyAction = (typeof KEY_ACTIONS)[number]['id'];
export type KeyMap = Record<KeyAction, string>;

export interface AppSettings {
  /** Qualité du rendu : netteté de la carte, flous, ombres, animations. */
  graphics: Quality;
  /** Détail du jeu : nombre d'avions affichés, lumières des villes, étiquettes, traînées. */
  detail: Quality;
  fps: FpsLimit;
  showFps: boolean;
  /** Touche de chaque action (valeur de KeyboardEvent.key, lettres en minuscules ; '' = aucune). */
  keys: KeyMap;
}

const STORAGE_KEY = 'simulateur-compagnie:reglages';

export function defaultKeys(): KeyMap {
  return Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.def])) as KeyMap;
}

/** Réglages de départ selon l'appareil : un téléphone ménage sa batterie. */
export function defaultSettings(): AppSettings {
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return { graphics: phone ? 'medium' : 'high', detail: phone ? 'medium' : 'high', fps: 60, showFps: false, keys: defaultKeys() };
}

const isQuality = (v: unknown): v is Quality => v === 'low' || v === 'medium' || v === 'high';

function load(): AppSettings {
  const def = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<AppSettings> | null;
    if (!raw || typeof raw !== 'object') return def;
    const keys = defaultKeys();
    if (raw.keys && typeof raw.keys === 'object') {
      for (const a of KEY_ACTIONS) {
        const k = (raw.keys as Partial<KeyMap>)[a.id];
        if (typeof k === 'string') keys[a.id] = k;
      }
    }
    return {
      graphics: isQuality(raw.graphics) ? raw.graphics : def.graphics,
      detail: isQuality(raw.detail) ? raw.detail : def.detail,
      fps: FPS_LIMITS.includes(raw.fps as FpsLimit) ? (raw.fps as FpsLimit) : def.fps,
      showFps: typeof raw.showFps === 'boolean' ? raw.showFps : def.showFps,
      keys,
    };
  } catch {
    return def;
  }
}

type Listener = (s: AppSettings, changed: Partial<AppSettings>) => void;

class Settings {
  private value = load();
  private listeners = new Set<Listener>();

  get(): AppSettings {
    return this.value;
  }

  set(patch: Partial<AppSettings>): void {
    this.value = { ...this.value, ...patch };
    this.save();
    for (const fn of this.listeners) fn(this.value, patch);
  }

  /** Change la touche d'une action ; l'action qui l'utilisait déjà la perd. */
  bindKey(action: KeyAction, key: string): void {
    const keys = { ...this.value.keys };
    if (key) for (const a of KEY_ACTIONS) if (a.id !== action && keys[a.id] === key) keys[a.id] = '';
    keys[action] = key;
    this.set({ keys });
  }

  resetKeys(): void {
    this.set({ keys: defaultKeys() });
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // Navigation privée ou stockage plein : les réglages valent pour cette visite.
    }
  }
}

export const settings = new Settings();

/** Touche telle que le jeu la retient : lettres en minuscules, le reste tel quel. */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Espace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Échap',
  Enter: 'Entrée',
  Backspace: 'Retour arr.',
  Delete: 'Suppr',
  PageUp: 'Page ↑',
  PageDown: 'Page ↓',
  Home: 'Début',
  End: 'Fin',
  Tab: 'Tab',
  Insert: 'Inser',
};

/** Nom lisible d'une touche (pour les paramètres). */
export function keyName(key: string): string {
  if (!key) return '—';
  return KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** Plafond de netteté (pixels réels par pixel d'écran) selon la qualité choisie. */
export function pixelRatioFor(q: Quality): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, q === 'low' ? 1 : q === 'medium' ? 1.5 : 2);
}
