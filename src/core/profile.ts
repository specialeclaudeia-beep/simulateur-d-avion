/**
 * Le compte du joueur : un profil gardé dans ce navigateur (pseudo, couleur,
 * emblème, temps de jeu). Pas de serveur ni de mot de passe : le jeu se joue
 * seul et tout reste sur l'appareil.
 */

export interface Profile {
  name: string;
  /** Couleur de la pastille (hexadécimal). */
  color: string;
  /** Emblème : un nom d'icône, ou '' pour l'initiale du pseudo. */
  emblem: string;
  createdAt: number;
  /** Temps passé en partie, en millisecondes. */
  playMs: number;
}

export const PROFILE_COLORS = ['#ffb627', '#5cc8ff', '#3ddc97', '#ff6b6b', '#b79cff', '#ff8fc7', '#f4f6fb', '#ff8a3d'];
/** Emblèmes proposés (noms d'icônes de src/ui/icons.ts) ; '' = l'initiale. */
export const PROFILE_EMBLEMS = ['', 'plane', 'prop', 'pilot', 'globe', 'radar', 'star', 'trophy'];

const STORAGE_KEY = 'simulateur-compagnie:profil';
const NAME_MAX = 18;

function load(): Profile {
  const def: Profile = { name: 'Pilote', color: PROFILE_COLORS[0], emblem: 'plane', createdAt: Date.now(), playMs: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Profile> | null;
    if (!raw || typeof raw !== 'object') return def;
    return {
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, NAME_MAX) : def.name,
      color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : def.color,
      emblem: typeof raw.emblem === 'string' && PROFILE_EMBLEMS.includes(raw.emblem) ? raw.emblem : def.emblem,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : def.createdAt,
      playMs: typeof raw.playMs === 'number' && raw.playMs > 0 ? raw.playMs : 0,
    };
  } catch {
    return def;
  }
}

class ProfileStore {
  private value = load();
  private listeners = new Set<() => void>();

  get(): Profile {
    return this.value;
  }

  set(patch: Partial<Pick<Profile, 'name' | 'color' | 'emblem'>>): void {
    const next = { ...this.value, ...patch };
    next.name = next.name.slice(0, NAME_MAX);
    this.value = next;
    this.save();
    for (const fn of this.listeners) fn();
  }

  /** Ajoute du temps de jeu (appelé régulièrement pendant une partie). */
  addPlay(ms: number): void {
    if (!(ms > 0)) return;
    this.value = { ...this.value, playMs: this.value.playMs + ms };
    this.save();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // Navigation privée ou stockage plein : le profil vaut pour cette visite.
    }
  }
}

export const profile = new ProfileStore();

/** Grade du joueur, selon son temps de jeu. */
export function rankTitle(playMs: number): string {
  const h = playMs / 3_600_000;
  if (h < 1) return 'Élève pilote';
  if (h < 5) return 'Copilote';
  if (h < 20) return 'Commandant de bord';
  if (h < 60) return 'Chef pilote';
  return 'Légende des airs';
}

/** Texte lisible sur une couleur de fond (presque noir ou blanc). */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#141a26' : '#ffffff';
}
