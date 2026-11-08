/**
 * Hasard reproductible : la graine est rangée dans la partie, donc une même
 * sauvegarde rejoue exactement les mêmes événements (utile pour les tests).
 * Algorithme mulberry32.
 */

export type Rng = () => number;

export function makeRng(holder: { seed: number }): Rng {
  return () => {
    let t = (holder.seed = (holder.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function randRange(rng: Rng, [min, max]: readonly [number, number]): number {
  return min + rng() * (max - min);
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

/** Tirage pondéré : `weights[i]` est le poids de `list[i]`. */
export function pickWeighted<T>(rng: Rng, list: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let x = rng() * total;
  for (let i = 0; i < list.length; i++) {
    x -= weights[i];
    if (x < 0) return list[i];
  }
  return list[list.length - 1];
}
