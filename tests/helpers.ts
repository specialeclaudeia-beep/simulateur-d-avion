/**
 * Outils communs aux tests : lecture des vraies données depuis le disque et
 * création rapide d'une partie de test.
 */
import { readFileSync } from 'node:fs';
import { createGameData, type GameData, type Airline, type Airport, type RouteTuple } from '../src/game/data';
import { createNewGame } from '../src/game/newGame';
import type { Ctx } from '../src/game/context';
import type { Pilot } from '../src/game/state';

let cached: GameData | null = null;

export function realData(): GameData {
  if (!cached) {
    const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8')) as T;
    cached = createGameData({
      airports: read<Airport[]>('airports'),
      routes: read<RouteTuple[]>('routes'),
      airlines: read<Airline[]>('airlines'),
    });
  }
  return cached;
}

/** 8 novembre 2026, 10 h UTC. */
export const T0 = Date.UTC(2026, 10, 8, 10, 0, 0);

export function newTestGame(hub = 'NCE', country = 'FR', difficulty: 'facile' | 'normal' | 'difficile' = 'normal', seed = 42): Ctx {
  return createNewGame(
    realData(),
    {
      name: 'Air Test',
      code: 'AT',
      color: '#1e88e5',
      logo: { kind: 'symbol', symbol: 'plane', shape: 'circle', fg: '#ffffff', bg: '#1e88e5' },
      country,
      difficulty,
      hub,
    },
    T0,
    seed,
  );
}

/** Ajoute directement un pilote qualifié (pour les tests). */
export function addPilot(ctx: Ctx, family: string, stars = 3): Pilot {
  const s = ctx.state;
  const p: Pilot = {
    id: `P${++s.counters.pilot}`,
    firstName: 'Test',
    lastName: `Pilote ${s.counters.pilot}`,
    nationality: s.company.country,
    birthYear: 1985,
    hours: [0, 500, 2000, 5000, 9000, 13000][stars],
    stars,
    ratings: [family],
    salary: 9000,
    hiredAt: s.time,
    aircraftId: null,
    training: null,
  };
  s.pilots.push(p);
  return p;
}
