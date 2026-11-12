/**
 * Moteur des bruitages (Web Audio), partagé par les sons des avions et ceux de
 * l'interface. Le navigateur n'autorise le son qu'après un geste du joueur :
 * le contexte audio est créé au premier toucher, et mis en pause quand le jeu
 * passe en arrière-plan. Les fichiers (public/sons/, Opus) sont chargés par
 * fetch, une seule fois : le service worker les sert hors connexion.
 */
import { music } from './music';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const readyListeners: ((ctx: AudioContext, master: GainNode) => void)[] = [];

const masterLevel = () => (music.on ? music.fxVolume : 0);

export function setupAudioEngine(): void {
  const unlock = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = masterLevel();
      master.connect(ctx.destination);
      for (const fn of readyListeners) fn(ctx, master);
    }
    if (ctx.state === 'suspended' && !document.hidden) void ctx.resume();
  };
  for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
  music.onChange(() => {
    if (ctx && master) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.1);
  });
}

/** Le contexte audio, s'il est créé et qu'il joue. */
export function audio(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null;
}

/** Appelé dès que le son est possible (tout de suite s'il l'est déjà). */
export function onAudioReady(fn: (ctx: AudioContext, master: GainNode) => void): void {
  if (ctx && master) fn(ctx, master);
  else readyListeners.push(fn);
}

export function loadSound(name: string): Promise<AudioBuffer | null> {
  let p = buffers.get(name);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}sons/${name}.ogg`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => ctx!.decodeAudioData(data))
      .catch((err: unknown) => {
        console.warn('Bruitage indisponible :', name, err);
        buffers.delete(name); // on réessaiera plus tard
        return null;
      });
    buffers.set(name, p);
  }
  return p;
}

/** Joue un son une fois, vers `dest` (par défaut le volume général des bruitages). */
export function playSound(name: string, volume = 1, delayS = 0, dest?: AudioNode): void {
  if (!ctx || !master) return;
  const out = dest ?? master;
  void loadSound(name).then((buf) => {
    if (!buf || !ctx) return;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.value = volume;
    src.connect(gain).connect(out);
    src.start(ctx.currentTime + delayS);
  });
}

/**
 * Sons en boucle : `set` donne les sons voulus et leur volume ; ceux qui n'y
 * sont plus s'éteignent en fondu, les nouveaux démarrent en fondu.
 */
export class LoopSet {
  private readonly loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

  constructor(private readonly route: (name: string) => AudioNode) {}

  set(wanted: Record<string, number>, fadeS = 0.8): void {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [name, l] of this.loops) {
      if (wanted[name] !== undefined) continue;
      l.gain.gain.setTargetAtTime(0, now, fadeS / 3);
      try {
        l.src.stop(now + fadeS * 2);
      } catch {
        // Pas encore démarré (son en cours de chargement) : il ne démarrera pas.
      }
      this.loops.delete(name);
    }
    for (const [name, volume] of Object.entries(wanted)) {
      const cur = this.loops.get(name);
      if (cur) {
        cur.gain.gain.setTargetAtTime(volume, now, fadeS / 3);
        continue;
      }
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.route(name));
      const src = ctx.createBufferSource();
      src.loop = true;
      src.connect(gain);
      this.loops.set(name, { src, gain });
      void loadSound(name).then((buf) => {
        if (!buf || !ctx || this.loops.get(name)?.src !== src) return;
        src.buffer = buf;
        // Départ à un endroit au hasard : deux écoutes de suite ne sonnent pas pareil.
        src.start(ctx.currentTime, Math.random() * buf.duration);
        gain.gain.setTargetAtTime(volume, ctx.currentTime, fadeS / 3);
      });
    }
  }

  get size(): number {
    return this.loops.size;
  }
}

/**
 * Explosion / impact : bruit filtré grave, attaque sèche et longue traîne
 * (grondement), synthétisé pour ne pas ajouter de fichier.
 */
export function playImpact(volume = 1, delayS = 0): void {
  if (!ctx || !master) return;
  const dur = 3.5;
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = brown * 3.5 + (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.08)) * 0.6;
  }
  const t0 = ctx.currentTime + delayS;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2400, t0);
  lp.frequency.exponentialRampToValueAtTime(140, t0 + 1.2);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(lp).connect(gain).connect(master);
  src.start(t0);
}
