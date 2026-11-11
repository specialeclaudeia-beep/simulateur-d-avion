/**
 * Valeur de la compagnie : trésorerie, dette, avions et hubs.
 * (À part des actions pour que les règles du mode par échelons puissent s'en servir.)
 */
import type { Ctx } from './context';
import { aircraftValue } from './economy';
import { hubValue } from './hubs';

export function companyAssets(ctx: Ctx, t: number): { fleet: number; hubs: number } {
  const fleet = ctx.state.aircraft.reduce((sum, ac) => sum + aircraftValue(ctx.data, ac, t), 0);
  const hubs = ctx.state.hubs.reduce((sum, h) => sum + hubValue(h), 0);
  return { fleet, hubs };
}

/** Fortune de la compagnie : ce qu'elle a en caisse et ce qu'elle possède, moins ses dettes. */
export function companyValue(ctx: Ctx, t: number): number {
  const a = companyAssets(ctx, t);
  return ctx.state.cash - ctx.state.debt + a.fleet + a.hubs;
}
