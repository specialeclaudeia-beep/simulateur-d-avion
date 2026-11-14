/**
 * Cadence des images.
 *
 * Tout ce qui s'anime dans le jeu (la carte MapLibre, les avions, l'horloge)
 * demande ses images par `requestAnimationFrame`. On remplace cette fonction par
 * une file d'attente servie par une seule boucle : on peut ainsi limiter le
 * nombre d'images par seconde (30, 60, 120 ou sans limite) pour ménager la
 * batterie, et mesurer les FPS réellement obtenus.
 *
 * À installer avant de créer la carte (voir main.ts).
 */

type Callback = FrameRequestCallback;

const nativeRaf = window.requestAnimationFrame.bind(window);

let limit = 60;
let queue = new Map<number, Callback>();
let nextId = 1;
let scheduled = false;
let lastFlush = -Infinity;

// Mesure : images servies et durée de la plus longue, par seconde.
let frames = 0;
let windowStart = 0;
let lastFrameAt = 0;
let worst = 0;
let fps = 0;
let worstMs = 0;
const listeners = new Set<(fps: number, worstMs: number) => void>();

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  nativeRaf(pump);
}

function pump(now: number): void {
  scheduled = false;
  if (limit > 0) {
    const interval = 1000 / limit;
    // Tolérance d'1 ms : un écran à 60 Hz sert bien 60 images par seconde.
    if (now - lastFlush < interval - 1) {
      schedule();
      return;
    }
    lastFlush = now - lastFlush > 2 * interval ? now : lastFlush + interval;
  } else {
    lastFlush = now;
  }

  if (lastFrameAt) worst = Math.max(worst, now - lastFrameAt);
  lastFrameAt = now;
  frames++;
  if (!windowStart) windowStart = now;
  if (now - windowStart >= 1000) {
    fps = Math.round((frames * 1000) / (now - windowStart));
    worstMs = Math.round(worst);
    frames = 0;
    worst = 0;
    windowStart = now;
    for (const fn of listeners) fn(fps, worstMs);
  }

  const run = queue;
  queue = new Map();
  for (const cb of run.values()) {
    try {
      cb(now);
    } catch (err) {
      console.error(err);
    }
  }
  if (queue.size) schedule();
}

/** Remplace requestAnimationFrame / cancelAnimationFrame par la file cadencée. */
export function installFrameGovernor(fpsLimit: number): void {
  limit = fpsLimit;
  window.requestAnimationFrame = (cb: Callback): number => {
    const id = nextId++;
    queue.set(id, cb);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    queue.delete(id);
  };
  // Au retour sur l'appli, la mesure repart de zéro (sinon une « image » de plusieurs minutes).
  document.addEventListener('visibilitychange', () => {
    lastFrameAt = 0;
    windowStart = 0;
    frames = 0;
    worst = 0;
  });
}

/** Limite d'images par seconde (0 = sans limite). */
export function setFpsLimit(fpsLimit: number): void {
  limit = fpsLimit;
  lastFlush = -Infinity;
}

/** Prévenu une fois par seconde : images par seconde et durée de la plus longue image (ms). */
export function onFps(fn: (fps: number, worstMs: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentFps(): number {
  return fps;
}
