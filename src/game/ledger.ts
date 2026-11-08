/**
 * Comptabilité : chaque recette ou dépense est rangée dans une catégorie du
 * mois en cours. À la fin du mois, on calcule l'impôt sur les sociétés et on
 * archive le mois.
 */
import { FUEL_PRICE_MAX, FUEL_PRICE_MIN, FUEL_PRICE_START, HISTORY_MONTHS } from './config';
import { log, type Ctx } from './context';
import { emptyStats, type GameState, type LedgerKey, type MonthLedger } from './state';
import { monthKey } from './time';

export const LEDGER_LABEL: Record<LedgerKey, string> = {
  tickets: 'Billets',
  cargo: 'Fret',
  fuel: 'Carburant',
  airport: 'Redevances aéroportuaires',
  maintenance: 'Maintenance en vol',
  checks: 'Révisions',
  repairs: 'Réparations',
  service: 'Équipages de cabine et escale',
  salaries: 'Salaires des pilotes',
  hubs: 'Entretien des hubs',
  insurance: 'Assurances',
  compensation: 'Indemnisations',
  vat: 'TVA sur les vols intérieurs',
  interest: 'Intérêts',
  tax: 'Impôt sur les sociétés',
  aircraftPurchase: 'Achats d’avions',
  hubPurchase: 'Achats de hubs',
  upgrades: 'Améliorations des hubs',
  training: 'Formations',
  recruitment: 'Recrutements',
  lineOpening: 'Ouvertures de lignes',
  assetSales: 'Ventes (avions, hubs)',
};

export const REVENUE_KEYS: LedgerKey[] = ['tickets', 'cargo'];
export const OPEX_KEYS: LedgerKey[] = [
  'vat',
  'fuel',
  'airport',
  'maintenance',
  'checks',
  'repairs',
  'service',
  'salaries',
  'hubs',
  'insurance',
  'compensation',
  'interest',
];
export const INVEST_KEYS: LedgerKey[] = ['aircraftPurchase', 'hubPurchase', 'upgrades', 'training', 'recruitment', 'lineOpening'];

export function book(state: GameState, key: LedgerKey, amount: number): void {
  if (!Number.isFinite(amount) || amount === 0) return;
  state.ledger.entries[key] = (state.ledger.entries[key] ?? 0) + amount;
}

export function spend(state: GameState, key: LedgerKey, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.cash -= amount;
  book(state, key, amount);
}

export function earn(state: GameState, key: LedgerKey, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.cash += amount;
  book(state, key, amount);
}

export function newLedger(t: number): MonthLedger {
  return { month: monthKey(t), entries: {}, flights: 0, pax: 0, cargoT: 0 };
}

export interface MonthSummary {
  revenue: number;
  opex: number;
  tax: number;
  /** Résultat avant impôt. */
  profitBeforeTax: number;
  /** Résultat net (après impôt). */
  profit: number;
  invest: number;
}

export function summarize(l: MonthLedger): MonthSummary {
  const sum = (keys: LedgerKey[]) => keys.reduce((s, k) => s + (l.entries[k] ?? 0), 0);
  const revenue = sum(REVENUE_KEYS);
  const opex = sum(OPEX_KEYS);
  const tax = l.entries.tax ?? 0;
  const profitBeforeTax = revenue - opex;
  return { revenue, opex, tax, profitBeforeTax, profit: profitBeforeTax - tax, invest: sum(INVEST_KEYS) };
}

/** Clôture du mois : impôt (avec report des pertes), archivage, prix du kérosène du mois suivant. */
export function closeMonth(ctx: Ctx, t: number): void {
  const s = ctx.state;
  const { profitBeforeTax } = summarize(s.ledger);
  let taxable = 0;
  if (profitBeforeTax < 0) {
    s.taxLossCarry += -profitBeforeTax;
  } else {
    const used = Math.min(s.taxLossCarry, profitBeforeTax);
    s.taxLossCarry -= used;
    taxable = profitBeforeTax - used;
  }
  const rate = ctx.data.corporateTax(s.company.country) / 100;
  const tax = taxable * rate;
  if (tax > 0) {
    s.cash -= tax;
    book(s, 'tax', tax);
  }
  s.ledger.cashEnd = s.cash;
  const closed = s.ledger;
  s.history.push(closed);
  if (s.history.length > HISTORY_MONTHS) s.history.splice(0, s.history.length - HISTORY_MONTHS);
  s.ledger = newLedger(t);
  for (const line of s.lines) line.month = emptyStats();

  // Le kérosène varie chaque mois (marche au hasard qui revient vers son prix moyen).
  const drift = (FUEL_PRICE_START - s.fuelPrice) * 0.2;
  const shock = (ctx.rng() - 0.5) * 0.12;
  s.fuelPrice = Math.min(FUEL_PRICE_MAX, Math.max(FUEL_PRICE_MIN, s.fuelPrice + drift + shock));

  const sum = summarize(closed);
  log(
    ctx,
    sum.profit >= 0 ? 'good' : 'bad',
    `Bilan de ${monthLabel(closed.month)} : ${closed.flights} vols, résultat net ${signedMoney(sum.profit)}${tax > 0 ? ` (dont impôt ${money(tax)})` : ''}`,
    undefined,
    t,
  );
}

// Petits formats utilisés dans le journal (l'interface a les siens, plus complets).
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function money(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const fmt = (x: number, d: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  if (a >= 1e9) return `${sign}${fmt(a / 1e9, 2)} Md$`;
  if (a >= 1e6) return `${sign}${fmt(a / 1e6, a >= 1e8 ? 0 : 1)} M$`;
  if (a >= 1e4) return `${sign}${fmt(a / 1e3, 0)} k$`;
  return `${sign}${fmt(a, 0)} $`;
}

export function signedMoney(v: number): string {
  return v > 0 ? `+${money(v)}` : money(v);
}
