/**
 * Position du soleil (précision ~0,1°, largement suffisante pour un jeu).
 * Formules simplifiées de l'Astronomical Almanac / NOAA.
 */

const DEG = Math.PI / 180;

export interface SubsolarPoint {
  /** Latitude du point subsolaire = déclinaison du soleil (degrés). */
  lat: number;
  /** Longitude du point subsolaire (degrés, -180..180). */
  lon: number;
}

export function subsolarPoint(ms: number): SubsolarPoint {
  const d = ms / 86400000 + 2440587.5 - 2451545.0; // jours depuis J2000
  const g = (357.529 + 0.98560028 * d) * DEG; // anomalie moyenne
  const q = 280.459 + 0.98564736 * d; // longitude moyenne
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG; // longitude écliptique
  const e = (23.439 - 0.00000036 * d) * DEG; // obliquité
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / DEG; // ascension droite (°)
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / DEG;
  const gmst = 18.697374558 + 24.06570982441908 * d; // heures
  let lon = ra - gmst * 15;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: dec, lon };
}

/** Sinus de la hauteur du soleil au-dessus de l'horizon en (lat, lon). */
export function sunAltitudeSin(lat: number, lon: number, sun: SubsolarPoint): number {
  const p = lat * DEG;
  const d = sun.lat * DEG;
  return Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos((lon - sun.lon) * DEG);
}
