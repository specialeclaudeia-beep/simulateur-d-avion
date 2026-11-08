/**
 * Musique de fond : les morceaux de public/musique/ joués à la suite, en boucle.
 *
 * - Le navigateur interdit le son avant que le joueur ait touché l'écran : la
 *   musique démarre donc au premier toucher (ou clic, ou touche du clavier).
 * - Elle se met en pause quand le jeu passe en arrière-plan (autre appli,
 *   écran éteint) et reprend au retour.
 * - Chaque morceau est d'abord chargé en entier (fetch) puis joué depuis la
 *   mémoire : le service worker le sert ainsi depuis sa copie, hors connexion
 *   (un lecteur audio qui demande des « morceaux de fichier » ne serait pas
 *   servi correctement par la copie gardée).
 * - Réglages (son coupé, volumes de la musique et des bruitages) gardés dans ce navigateur, hors sauvegarde.
 */

export interface Track {
  file: string;
  title: string;
}

export const TRACKS: Track[] = [
  { file: 'clairiere-mecanique.mp3', title: 'Clairière mécanique' },
  { file: 'horizon-usine.mp3', title: 'Horizon usine' },
  { file: 'trajectoire-du-noyau.mp3', title: 'Trajectoire du noyau' },
];

const STORAGE_KEY = 'simulateur-compagnie:son';
/** Volumes au premier lancement (0 à 1). */
const DEFAULT_VOLUME = 0.5;
const DEFAULT_FX = 0.7;
/** Fondu à la reprise et à la coupure (ms). */
const FADE_MS = 600;

interface SoundSettings {
  /** Tout le son (musique et bruitages). */
  on: boolean;
  /** Volume de la musique. */
  volume: number;
  /** Volume des bruitages (avions, interface). */
  fx: number;
  /** Sons de l'interface (touches, messages…). */
  ui: boolean;
}

function loadSettings(): SoundSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SoundSettings> | null;
    return {
      on: raw?.on ?? true,
      volume: typeof raw?.volume === 'number' ? clamp01(raw.volume) : DEFAULT_VOLUME,
      fx: typeof raw?.fx === 'number' ? clamp01(raw.fx) : DEFAULT_FX,
      ui: raw?.ui ?? true,
    };
  } catch {
    return { on: true, volume: DEFAULT_VOLUME, fx: DEFAULT_FX, ui: true };
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

class Music {
  private readonly audio = new Audio();
  private settings = loadSettings();
  private index = 0;
  private loadedIndex = -1;
  private objectUrl: string | null = null;
  private unlocked = false;
  private fadeTimer = 0;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.audio.preload = 'auto';
    this.audio.volume = 0;
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('play', () => this.emit());
    this.audio.addEventListener('pause', () => this.emit());
  }

  /** À appeler au démarrage : attend le premier geste du joueur pour lancer la musique. */
  setup(): void {
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      for (const t of ['pointerdown', 'keydown']) window.removeEventListener(t, unlock, true);
      void this.resume();
    };
    for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.pause();
      else void this.resume();
    });
  }

  get on(): boolean {
    return this.settings.on;
  }

  get volume(): number {
    return this.settings.volume;
  }

  get fxVolume(): number {
    return this.settings.fx;
  }

  get playing(): boolean {
    return !this.audio.paused;
  }

  get track(): Track {
    return TRACKS[this.index];
  }

  setOn(on: boolean): void {
    this.settings.on = on;
    this.save();
    if (on) void this.resume();
    else this.fadeTo(0, () => this.audio.pause());
    this.emit();
  }

  setVolume(volume: number): void {
    this.settings.volume = clamp01(volume);
    this.save();
    if (this.playing) {
      window.clearInterval(this.fadeTimer);
      this.audio.volume = this.settings.volume;
    }
  }

  get uiOn(): boolean {
    return this.settings.ui;
  }

  setUiOn(on: boolean): void {
    this.settings.ui = on;
    this.save();
    this.emit();
  }

  setFxVolume(volume: number): void {
    this.settings.fx = clamp01(volume);
    this.save();
    this.emit();
  }

  /** Passe au morceau suivant (et le joue si la musique est allumée). */
  next(): void {
    this.index = (this.index + 1) % TRACKS.length;
    void this.resume();
    this.emit();
  }

  /** Prévenu quand la musique démarre, s'arrête ou change de morceau. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async resume(): Promise<void> {
    if (!this.unlocked || !this.settings.on || document.hidden) return;
    try {
      if (this.loadedIndex !== this.index) {
        const wanted = this.index;
        const url = `${import.meta.env.BASE_URL}musique/${TRACKS[wanted].file}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const blob = await res.blob();
        if (wanted !== this.index) return; // un autre morceau a été demandé entre-temps
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = URL.createObjectURL(blob);
        this.audio.src = this.objectUrl;
        this.loadedIndex = wanted;
      }
      if (!this.settings.on || document.hidden) return;
      this.audio.volume = 0;
      await this.audio.play();
      this.fadeTo(this.settings.volume);
    } catch (err) {
      console.warn('Musique indisponible :', err);
    }
  }

  private fadeTo(target: number, done?: () => void): void {
    window.clearInterval(this.fadeTimer);
    const start = this.audio.volume;
    const t0 = performance.now();
    this.fadeTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / FADE_MS);
      this.audio.volume = start + (target - start) * k;
      if (k >= 1) {
        window.clearInterval(this.fadeTimer);
        done?.();
      }
    }, 30);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Navigation privée ou stockage plein : le réglage vaut pour cette visite.
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export const music = new Music();
