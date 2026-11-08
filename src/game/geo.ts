/**
 * Géométrie sur la sphère terrestre : distances, caps et arcs de grand cercle
 * (la trajectoire que suivent réellement les avions, à quelques détours près).
 */

const R_KM = 6371;
const DEG = Math.PI / 180;

export interface LonLat {
  lon: number;
  lat: number;
}

export function distanceKm(a: LonLat, b: LonLat): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point situé à la fraction `f` (0 → a, 1 → b) de l'arc de grand cercle. */
export function interpolate(a: LonLat, b: LonLat, f: number): LonLat {
  const φ1 = a.lat * DEG;
  const λ1 = a.lon * DEG;
  const φ2 = b.lat * DEG;
  const λ2 = b.lon * DEG;
  const d = distanceKm(a, b) / R_KM;
  if (d < 1e-9) return { lon: a.lon, lat: a.lat };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / DEG, lon: Math.atan2(y, x) / DEG };
}

/** Cap initial (degrés, 0 = nord, sens horaire) pour aller de a vers b. */
export function bearing(a: LonLat, b: LonLat): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const Δλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Arc de grand cercle sous forme de liste de [lon, lat] pour la carte.
 * Les longitudes sont « déroulées » (ex. 179 → 181) pour que la ligne ne
 * traverse pas tout le globe quand elle passe l'antiméridien.
 */
export function greatCircleLine(a: LonLat, b: LonLat, stepKm = 80): [number, number][] {
  const n = Math.max(2, Math.ceil(distanceKm(a, b) / stepKm));
  const pts: [number, number][] = [];
  let prevLon = a.lon;
  for (let i = 0; i <= n; i++) {
    const p = interpolate(a, b, i / n);
    let lon = p.lon;
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    pts.push([lon, p.lat]);
    prevLon = lon;
  }
  return pts;
}
