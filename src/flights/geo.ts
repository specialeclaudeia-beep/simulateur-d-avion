/**
 * Calculs sur la sphère : les avions suivent l'arc de grand cercle entre les deux
 * aéroports, la route la plus courte, celle que suivent les long-courriers à
 * quelques détours près (vents, couloirs aériens).
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
export const EARTH_KM = 6371;

/** Vecteur unitaire 3D d'un point (lon, lat en degrés). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function toVec(lon: number, lat: number): Vec3 {
  const la = lat * RAD;
  const lo = lon * RAD;
  const c = Math.cos(la);
  return { x: c * Math.cos(lo), y: c * Math.sin(lo), z: Math.sin(la) };
}

/** Angle (radians) entre deux vecteurs unitaires. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(dot);
}

export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  return angleBetween(toVec(lon1, lat1), toVec(lon2, lat2)) * EARTH_KM;
}

/**
 * Point à la fraction `f` (0 → départ, 1 → arrivée) du grand cercle.
 * Écrit lon/lat dans `out` (évite de créer des objets à chaque image).
 */
export function interpolate(a: Vec3, b: Vec3, omega: number, f: number, out: [number, number], lateral = 0): [number, number] {
  let x: number, y: number, z: number;
  if (omega < 1e-9) {
    x = a.x;
    y = a.y;
    z = a.z;
  } else {
    const s = Math.sin(omega);
    const ka = Math.sin((1 - f) * omega) / s;
    const kb = Math.sin(f * omega) / s;
    x = ka * a.x + kb * b.x;
    y = ka * a.y + kb * b.y;
    z = ka * a.z + kb * b.z;
    if (lateral !== 0) {
      // Décalage sur le côté (perpendiculaire à la route), nul au départ et à l'arrivée.
      const d = (lateral * Math.sin(Math.PI * f)) / s;
      x += (a.y * b.z - a.z * b.y) * d;
      y += (a.z * b.x - a.x * b.z) * d;
      z += (a.x * b.y - a.y * b.x) * d;
    }
  }
  out[0] = Math.atan2(y, x) * DEG;
  out[1] = Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG;
  return out;
}

/**
 * Écart latéral d'un vol (radians, signé) à partir d'un nombre au hasard
 * `u` dans [0, 1) : les avions d'une même ligne ne se suivent plus à la file
 * sur un trait parfait, ils s'étalent dans un couloir (jusqu'à ±40 km sur les
 * longues routes, moins sur les courtes). Les vols aller et retour passent
 * naturellement de part et d'autre.
 */
export function lateralOffset(u: number, omega: number): number {
  const maxKm = Math.min(40, omega * EARTH_KM * 0.035);
  return ((u * 2 - 1) * maxKm) / EARTH_KM;
}

/** Nombre stable dans [0, 1) à partir d'un texte (ex. l'identifiant d'un vol). */
export function hashUnit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Cap (degrés, 0 = nord, sens horaire) pour aller de p1 vers p2. */
export function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/**
 * Tracé du grand cercle en points (pour dessiner la trajectoire). Les longitudes
 * sont « déroulées » (elles peuvent dépasser ±180) pour que la ligne ne fasse pas
 * le tour du monde à l'envers en traversant l'antiméridien.
 */
export function greatCirclePath(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  from = 0,
  to = 1,
  lateral = 0,
): [number, number][] {
  const a = toVec(lon1, lat1);
  const b = toVec(lon2, lat2);
  const omega = angleBetween(a, b);
  const n = Math.max(2, Math.ceil(((to - from) * omega * EARTH_KM) / 50));
  const pts: [number, number][] = [];
  const p: [number, number] = [0, 0];
  let prevLon = NaN;
  for (let i = 0; i <= n; i++) {
    interpolate(a, b, omega, from + ((to - from) * i) / n, p, lateral);
    let lon = p[0];
    if (!Number.isNaN(prevLon)) {
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;
    pts.push([lon, p[1]]);
  }
  return pts;
}
