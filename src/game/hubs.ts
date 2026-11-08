/**
 * Hubs : prix d'achat, capacités de départ et améliorations (portes, licences
 * de lignes, parking, qualité du terminal, atelier de maintenance).
 */
import {
  DEPARTURES_PER_GATE,
  FOREIGN_HUB_MULT,
  HUB_START,
  MAINTENANCE_EFFECT,
  MAINTENANCE_MAX,
  QUALITY_MAX,
} from './config';
import type { Airport, GameData } from './data';
import type { GameState, Hub } from './state';

export type HubUpgrade = 'gates' | 'lineSlots' | 'parking' | 'quality' | 'maintenance';

export const HUB_UPGRADE_LABEL: Record<HubUpgrade, { title: string; icon: string }> = {
  gates: { title: 'Portes d’embarquement', icon: '🚪' },
  lineSlots: { title: 'Licences de lignes', icon: '🗺️' },
  parking: { title: 'Parking avions', icon: '🅿️' },
  quality: { title: 'Qualité du terminal', icon: '⭐' },
  maintenance: { title: 'Atelier de maintenance', icon: '🔧' },
};

/** Prix d'achat d'un hub pour cette compagnie (plus cher hors de son pays). */
export function hubPrice(state: GameState, a: Airport): number {
  return Math.round(a.price * (a.country === state.company.country ? 1 : FOREIGN_HUB_MULT));
}

/** Capacités de départ d'un hub fraîchement acheté. */
export function newHub(data: GameData, a: Airport, price: number, t: number): Hub {
  const routes = data.routesFrom(a.iata).length;
  return {
    iata: a.iata,
    boughtAt: t,
    pricePaid: price,
    invested: 0,
    gates: Math.min(HUB_START.gates[a.tier], Math.max(1, a.gates)),
    lineSlots: Math.min(HUB_START.lineSlots[a.tier], Math.max(1, routes)),
    parking: HUB_START.parking[a.tier],
    quality: 1,
    maintenance: 0,
  };
}

export interface UpgradeInfo {
  kind: HubUpgrade;
  current: number;
  next: number;
  max: number;
  cost: number;
  effect: string;
}

const QUALITY_COST_SHARE = [0, 0.04, 0.08, 0.15, 0.25];
const MAINTENANCE_COST = [3_000_000, 12_000_000, 40_000_000];

function maxParking(a: Airport): number {
  return Math.max(12, a.gates * 3);
}

/** Coût et effet de la prochaine amélioration (null si déjà au maximum). */
export function upgradeInfo(data: GameData, hub: Hub, kind: HubUpgrade): UpgradeInfo | null {
  const a = data.airport(hub.iata);
  const P = a.price;
  const start = {
    gates: Math.min(HUB_START.gates[a.tier], Math.max(1, a.gates)),
    lineSlots: HUB_START.lineSlots[a.tier],
    parking: HUB_START.parking[a.tier],
  };
  const round = (x: number) => Math.round(x / 10_000) * 10_000;
  switch (kind) {
    case 'gates': {
      const max = Math.max(start.gates, a.gates);
      if (hub.gates >= max) return null;
      const cost = round(Math.max(400_000, 0.03 * P) * (1 + 0.1 * (hub.gates - start.gates)));
      return { kind, current: hub.gates, next: hub.gates + 1, max, cost, effect: `+${DEPARTURES_PER_GATE} départs par jour` };
    }
    case 'lineSlots': {
      const max = data.routesFrom(a.iata).length;
      if (hub.lineSlots >= max) return null;
      const cost = round(Math.max(250_000, 0.01 * P) * (1 + 0.15 * Math.max(0, hub.lineSlots - start.lineSlots)));
      return { kind, current: hub.lineSlots, next: hub.lineSlots + 1, max, cost, effect: '+1 ligne possible depuis ce hub' };
    }
    case 'parking': {
      const max = maxParking(a);
      if (hub.parking >= max) return null;
      const level = Math.max(0, (hub.parking - start.parking) / 2);
      const cost = round(Math.max(500_000, 0.015 * P) * (1 + 0.15 * level));
      return { kind, current: hub.parking, next: Math.min(max, hub.parking + 2), max, cost, effect: '+2 avions basés ici' };
    }
    case 'quality': {
      if (hub.quality >= QUALITY_MAX) return null;
      const cost = round(Math.max(500_000 * hub.quality, P * QUALITY_COST_SHARE[hub.quality]));
      return {
        kind,
        current: hub.quality,
        next: hub.quality + 1,
        max: QUALITY_MAX,
        cost,
        effect: 'Passagers plus satisfaits : plus de clients et meilleure réputation',
      };
    }
    case 'maintenance': {
      if (hub.maintenance >= MAINTENANCE_MAX) return null;
      const cost = round(MAINTENANCE_COST[hub.maintenance] * data.coef(a.country));
      const pct = Math.round(MAINTENANCE_EFFECT[hub.maintenance + 1] * 100);
      return {
        kind,
        current: hub.maintenance,
        next: hub.maintenance + 1,
        max: MAINTENANCE_MAX,
        cost,
        effect: `Révisions et réparations ${pct} % moins chères et plus rapides, moins de pannes`,
      };
    }
  }
}

/** Valeur estimée d'un hub (pour la valeur de la compagnie et les emprunts). */
export function hubValue(hub: Hub): number {
  return hub.pricePaid * 0.8 + hub.invested * 0.5;
}
