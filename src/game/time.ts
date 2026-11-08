/**
 * Outils de calendrier : jours et mois du jeu (en temps universel UTC) et
 * heure locale des aéroports (fuseaux horaires IANA, ex. « Europe/Paris »).
 */
import { DAY } from './config';

export function startOfUtcDay(t: number): number {
  return Math.floor(t / DAY) * DAY;
}

export function nextUtcDay(t: number): number {
  return startOfUtcDay(t) + DAY;
}

export function nextUtcMonth(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Clé du mois, ex. « 2026-11 ». */
export function monthKey(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function utcYear(t: number): number {
  return new Date(t).getUTCFullYear();
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }));
    } catch {
      formatters.set(tz, null); // fuseau inconnu du navigateur
    }
  }
  return formatters.get(tz)!;
}

/**
 * Minutes écoulées depuis minuit, heure locale de l'aéroport.
 * Sans fuseau connu, on prend l'heure solaire (longitude / 15).
 */
export function localMinutes(t: number, tz: string | null, lon: number): number {
  const f = tz ? formatterFor(tz) : null;
  if (f) {
    let h = 0;
    let m = 0;
    for (const p of f.formatToParts(t)) {
      if (p.type === 'hour') h = Number(p.value);
      else if (p.type === 'minute') m = Number(p.value);
    }
    return h * 60 + m;
  }
  const solar = (t / 60_000 + (lon / 15) * 60) % 1440;
  return (solar + 1440) % 1440;
}

/** Prochain instant (≥ t) où l'heure locale vaut `targetMin` minutes après minuit. */
export function nextLocalTime(t: number, tz: string | null, lon: number, targetMin: number): number {
  const now = localMinutes(t, tz, lon);
  const delta = (targetMin - now + 1440) % 1440;
  // Arrondi à la minute : on vise le début de la minute cible.
  return Math.floor(t / 60_000) * 60_000 + delta * 60_000;
}
