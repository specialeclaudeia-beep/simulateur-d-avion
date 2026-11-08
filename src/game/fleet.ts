/**
 * Flotte : contrats d'achat chez les constructeurs (remise de volume et de
 * fidélité, délais de livraison) et marché de l'occasion.
 */
import {
  DAY,
  DELIVERY_DAYS_PER_MONTH,
  DELIVERY_SPACING_DAYS,
  LOYALTY_MAX,
  LOYALTY_STEP,
  USED_MARKET_SIZE,
  volumeShare,
} from './config';
import type { Ctx } from './context';
import type { AircraftModel, GameData } from './data';
import { YEAR, marketValue } from './economy';
import { pickWeighted } from './rng';
import type { GameState, UsedListing } from './state';
import { utcYear } from './time';

export interface OrderQuote {
  unitPrice: number;
  total: number;
  /** Remise totale (volume + fidélité), entre 0 et 1. */
  discount: number;
  loyalty: number;
  /** Dates de livraison prévues, une par avion. */
  deliveries: number[];
}

/** Devis pour une commande d'avions neufs. */
export function orderQuote(data: GameData, state: GameState, model: AircraftModel, qty: number, t: number): OrderQuote {
  const mfr = data.manufacturerById.get(model.mfr)!;
  const [dMin, dMax] = mfr.contractDiscount;
  const loyalty = Math.min(LOYALTY_MAX, Math.floor((state.relations[mfr.id] ?? 0) / LOYALTY_STEP) * 0.01);
  const discount = Math.min(0.7, dMin + (dMax - dMin) * volumeShare(qty) + loyalty);
  const unitPrice = Math.round((model.priceUsd * (1 - discount)) / 10_000) * 10_000;
  let first = t + mfr.deliveryMonths[0] * DELIVERY_DAYS_PER_MONTH * DAY;
  // Un avion pas encore certifié ne peut pas être livré avant son année de mise en service.
  if (model.eis > utcYear(t)) first = Math.max(first, Date.UTC(model.eis, 0, 1));
  const deliveries = Array.from({ length: qty }, (_, i) => first + i * DELIVERY_SPACING_DAYS * DAY);
  return { unitPrice, total: unitPrice * qty, discount, loyalty, deliveries };
}

/** Popularité des catégories sur le marché de l'occasion. */
const USED_WEIGHT: Record<string, number> = {
  regional_turboprop: 2,
  regional_jet: 2,
  narrowbody: 3.5,
  widebody: 1.6,
  jumbo: 0.7,
};

/** Nouvelles annonces d'avions d'occasion. */
export function generateUsedListings(ctx: Ctx, t: number, count = USED_MARKET_SIZE): UsedListing[] {
  const { data, rng, state } = ctx;
  const year = utcYear(t);
  const models = data.models.filter((m) => m.eis < year);
  const weights = models.map((m) => (USED_WEIGHT[m.category] ?? 1) * (m.kind === 'cargo' ? 0.5 : 1));
  const out: UsedListing[] = [];
  for (let i = 0; i < count && models.length; i++) {
    const m = pickWeighted(rng, models, weights);
    const maxAge = Math.min(25, year - m.eis);
    const age = 1 + (maxAge - 1) * rng() ** 0.9;
    const condition = Math.round(Math.min(95, Math.max(40, 55 + rng() * 40 - age * 0.6)));
    out.push({
      id: `O${++state.counters.listing}`,
      modelId: m.id,
      builtAt: t - age * YEAR,
      condition,
      hours: Math.round(age * 2800 * (0.7 + rng() * 0.4)),
      price: Math.round((marketValue(data, m, age, condition) * (0.92 + rng() * 0.16)) / 10_000) * 10_000,
    });
  }
  return out.sort((a, b) => a.price - b.price);
}
