/**
 * Finances : trésorerie, résultat du mois détaillé, historique des mois
 * (graphiques par mesure, camemberts des dépenses et des recettes), banque (emprunts) et impôts.
 */
import * as act from '../../../game/actions';
import { BANKRUPTCY_DAYS, DAY, DOMESTIC_VAT_MAX, DOMESTIC_VAT_SHARE, FUEL_PRICE_START, loanRate } from '../../../game/config';
import { INVEST_KEYS, LEDGER_LABEL, OPEX_KEYS, REVENUE_KEYS, dailySeries, monthLabel, summarize, type DayPoint } from '../../../game/ledger';
import type { MonthLedger } from '../../../game/state';
import type { IconName } from '../../icons';
import { btn, compact, esc, kv, money, note, num, num1, section, signedMoneyHtml, withIcon } from '../dom';
import { barChart, pieChart } from './charts';
import type { Ui, View } from '../ui';

const MONTHS_SHOWN = 12;
const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function shortMonth(key: string): string {
  return SHORT_MONTHS[Number(key.split('-')[1]) - 1];
}

/** Lignes d'un tableau recettes / dépenses (seulement les montants non nuls). */
function ledgerRows(l: MonthLedger, keys: typeof OPEX_KEYS, sign: 1 | -1): string {
  return keys
    .filter((k) => (l.entries[k] ?? 0) !== 0)
    .sort((a, b) => (l.entries[b] ?? 0) - (l.entries[a] ?? 0))
    .map((k) => `<dt>${LEDGER_LABEL[k]}</dt><dd>${sign < 0 ? '−' : ''}${money(l.entries[k] ?? 0)}</dd>`)
    .join('');
}

type Metric = 'profit' | 'revenue' | 'cash' | 'flights' | 'pax' | 'cargo';
type Period = 'months' | 'days';

const METRICS: { id: Metric; icon: IconName; chip: string; title: string; yLabel: string }[] = [
  { id: 'profit', icon: 'chart', chip: 'Résultat', title: 'Résultat net (bénéfice ou perte)', yLabel: 'dollars US ($)' },
  { id: 'revenue', icon: 'money', chip: 'Recettes', title: 'Recettes (billets + fret)', yLabel: 'dollars US ($)' },
  { id: 'cash', icon: 'bank', chip: 'Trésorerie', title: 'Trésorerie en fin de période', yLabel: 'dollars US ($)' },
  { id: 'flights', icon: 'plane', chip: 'Vols', title: 'Nombre de vols effectués', yLabel: 'vols' },
  { id: 'pax', icon: 'users', chip: 'Passagers', title: 'Passagers transportés', yLabel: 'passagers' },
  { id: 'cargo', icon: 'box', chip: 'Fret', title: 'Fret transporté', yLabel: 'tonnes (t)' },
];

function fmtFor(m: Metric): { fmt: (v: number) => string; tick: (v: number) => string } {
  if (m === 'flights') return { fmt: (v) => `${num(v)} vol${Math.abs(v) >= 2 ? 's' : ''}`, tick: compact };
  if (m === 'pax') return { fmt: (v) => `${num(v)} passager${Math.abs(v) >= 2 ? 's' : ''}`, tick: compact };
  if (m === 'cargo') return { fmt: (v) => `${num1(v)}\u202ft`, tick: (v) => `${compact(v)}\u202ft` };
  return { fmt: (v) => (m === 'cash' ? money(v) : `${v > 0 ? '+' : ''}${money(v)}`), tick: money };
}

function monthValue(m: MonthLedger, metric: Metric, cashNow: number): number {
  if (metric === 'profit') return summarize(m).profit;
  if (metric === 'revenue') return summarize(m).revenue;
  if (metric === 'cash') return m.cashEnd ?? cashNow;
  if (metric === 'flights') return m.flights;
  if (metric === 'pax') return m.pax;
  return m.cargoT;
}

function dayValue(p: DayPoint, metric: Metric): number {
  return metric === 'cargo' ? p.cargoT : p[metric];
}

/** Camembert des dépenses du mois (exploitation et impôt ; investissements en option). */
function expensesPie(l: MonthLedger, withInvest: boolean): string {
  const keys = [...OPEX_KEYS, 'tax' as const, ...(withInvest ? INVEST_KEYS : [])];
  return pieChart(
    keys.map((k) => ({ label: LEDGER_LABEL[k], value: l.entries[k] ?? 0 })),
    money,
    'Aucune dépense ce mois-ci.',
  );
}

export function financesView(ui: Ui): View {
  let selected: string | null = null;
  let metric: Metric = 'profit';
  let period: Period = 'days';
  let selectedDay: string | null = null;
  let withInvest = false;
  let revenueBy: 'source' | 'line' = 'line';
  const charts = (months: MonthLedger[], shown: MonthLedger, isCurrent: boolean, now: number): string => {
    const s = ui.game.state;
    const m = METRICS.find((x) => x.id === metric)!;
    const f = fmtFor(metric);
    const chips = (items: [string, string, boolean][], action: string) =>
      `<div class="g-chips g-chips-sm">${items.map(([id, label, on]) => `<button type="button" class="g-chip${on ? ' on' : ''}" data-a="${action}" data-id="${id}">${label}</button>`).join('')}</div>`;
    let bars: string;
    if (period === 'months') {
      bars = barChart(
        months.map((l) => ({ id: l.month, label: shortMonth(l.month), name: monthLabel(l.month), value: monthValue(l, metric, s.cash) })),
        { action: 'month', selected, ...f, yLabel: m.yLabel, xLabel: 'mois (touche un mois pour son détail)', tone: metric === 'profit' || metric === 'cash' ? undefined : 'pos' },
      );
    } else {
      const live = isCurrent ? { d: new Date(now).getUTCDate(), cash: s.cash } : undefined;
      const series = dailySeries(shown, live);
      const many = series.length > 10;
      bars = series.length
        ? barChart(
            series.map((p) => ({
              id: String(p.d),
              label: !many || p.d === 1 || p.d % 5 === 0 ? String(p.d) : '',
              name: `${p.d} ${monthLabel(shown.month)}${isCurrent && live && p.d === live.d ? ' (en cours)' : ''}`,
              value: dayValue(p, metric),
            })),
            { action: 'day', selected: selectedDay, ...f, yLabel: m.yLabel, xLabel: `jours de ${monthLabel(shown.month)}`, tone: metric === 'profit' || metric === 'cash' ? undefined : 'pos' },
          )
        : `<p class="g-small">Pas de détail jour par jour pour ce mois (il date d’avant les relevés quotidiens).</p>`;
    }
    const lineRevenue = s.lines.map((l) => ({ label: `${l.hub} → ${l.dest}`, value: l.month.revenue }));
    const byLine = isCurrent && revenueBy === 'line';
    const revenuePie = byLine
      ? pieChart(lineRevenue, money, 'Aucune recette ce mois-ci.')
      : pieChart(REVENUE_KEYS.map((k) => ({ label: LEDGER_LABEL[k], value: shown.entries[k] ?? 0 })), money, 'Aucune recette ce mois-ci.');
    return `
      ${chips(METRICS.map((x) => [x.id, withIcon(x.icon, x.chip, 15), x.id === metric]), 'metric')}
      ${chips([['days', 'Jour par jour', period === 'days'], ['months', 'Mois par mois', period === 'months']], 'period')}
      <h4 class="g-chart-title">${esc(m.title)}${period === 'days' ? ` · ${esc(monthLabel(shown.month))}` : ' · 12 derniers mois'}</h4>
      ${bars}
      ${metric === 'profit' || metric === 'cash' ? '<p class="g-small"><span class="g-key pos"></span> positif <span class="g-key neg"></span> négatif</p>' : ''}
      <h4 class="g-chart-title">Où part l’argent · ${esc(monthLabel(shown.month))}</h4>
      ${chips([['0', 'Dépenses courantes', !withInvest], ['1', '＋ investissements', withInvest]], 'invest')}
      ${expensesPie(shown, withInvest)}
      <h4 class="g-chart-title">D’où vient l’argent · ${esc(monthLabel(shown.month))}</h4>
      ${isCurrent ? chips([['line', 'Par ligne', revenueBy === 'line'], ['source', 'Billets / fret', revenueBy === 'source']], 'revenueBy') : ''}
      ${revenuePie}
      <p class="g-small">Touche un mois dans « Mois par mois » pour voir ses graphiques et son détail.</p>`;
  };
  return {
    tab: 'finances',
    live: true,
    title: () => 'Finances',
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const now = ui.now;
      const months = [...s.history.slice(-(MONTHS_SHOWN - 1)), s.ledger];
      const current = s.ledger.month;
      if (!selected || !months.some((m) => m.month === selected)) selected = current;
      const shown = months.find((m) => m.month === selected)!;
      const sum = summarize(shown);
      const isCurrent = shown.month === current;
      const rate = d.corporateTax(s.company.country);
      const estTax = isCurrent ? Math.max(0, sum.profitBeforeTax - s.taxLossCarry) * (rate / 100) : sum.tax;
      const capacity = act.loanCapacity(ui.ctx, now);
      const loanPct = loanRate(d.country(s.company.country)?.gdpPerCapita) * 100;
      const value = act.companyValue(ui.ctx, now);
      const vat = Math.min(DOMESTIC_VAT_MAX * 100, d.vat(s.company.country) * DOMESTIC_VAT_SHARE);

      let alert = '';
      if (s.cash < 0 && s.negativeSince !== null) {
        const left = Math.max(0, BANKRUPTCY_DAYS - Math.floor((now - s.negativeSince) / DAY));
        alert = note(`Trésorerie négative : faillite dans ${left} jour(s) si elle ne redevient pas positive. Emprunte ou vends un avion.`, 'bad');
      }

      const fuelVsNormal = s.fuelPrice / FUEL_PRICE_START - 1;
      return `
        ${alert}
        <div class="g-card">
          ${kv([
            ['Trésorerie', `<b class="${s.cash < 0 ? 'neg' : ''}">${money(s.cash)}</b>`],
            ['Dette', money(s.debt)],
            ['Valeur de la compagnie', money(value)],
            ['Satisfaction des passagers', `${Math.floor(s.reputation)}\u202f%`],
            ['Kérosène', `${s.fuelPrice.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $/kg <small>(${fuelVsNormal >= 0 ? '+' : ''}${Math.round(fuelVsNormal * 100)}\u202f% par rapport à la normale)</small>`],
          ])}
        </div>
        ${section('Graphiques', charts(months, shown, isCurrent, now))}
        ${section(
          `${isCurrent ? 'Ce mois-ci' : 'Mois de'} ${esc(monthLabel(shown.month))}`,
          `<p class="g-small">${num(shown.flights)} vols · ${num(shown.pax)} passagers${shown.cargoT ? ` · ${num(shown.cargoT)} t de fret` : ''}</p>
           <dl class="g-kv g-ledger">
             ${ledgerRows(shown, REVENUE_KEYS, 1)}
             <dt><b>Recettes</b></dt><dd><b>${money(sum.revenue)}</b></dd>
             ${ledgerRows(shown, OPEX_KEYS, -1)}
             <dt><b>Résultat avant impôt</b></dt><dd><b>${signedMoneyHtml(sum.profitBeforeTax)}</b></dd>
             <dt>${isCurrent ? 'Impôt estimé (fin de mois)' : 'Impôt sur les sociétés'}</dt><dd>${estTax > 0 ? '−' : ''}${money(estTax)}</dd>
             <dt><b>Résultat net</b></dt><dd><b>${signedMoneyHtml(sum.profitBeforeTax - estTax)}</b></dd>
           </dl>
           ${sum.invest > 0 ? `<p class="g-small">Investissements du mois (hors résultat) :</p><dl class="g-kv g-ledger">${ledgerRows(shown, INVEST_KEYS, -1)}</dl>` : ''}`,
        )}
        ${section(
          'Banque',
          `${kv([
            ['Taux d’intérêt', `${loanPct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}\u202f% par an`],
            ['Tu peux encore emprunter', money(capacity)],
          ])}
          <div class="g-actions">
            ${btn('＋ 10 M$', 'borrow', { id: '10000000', cls: 'ghost small', disabled: capacity < 10_000_000 })}
            ${btn('＋ 50 M$', 'borrow', { id: '50000000', cls: 'ghost small', disabled: capacity < 50_000_000 })}
            ${btn(`＋ ${money(capacity)}`, 'borrow', { id: String(capacity), cls: 'ghost small', disabled: capacity <= 0 })}
          </div>
          <div class="g-actions">
            ${btn('Rembourser 10 M$', 'repay', { id: '10000000', cls: 'ghost small', disabled: s.debt <= 0 || s.cash <= 0 })}
            ${btn('Tout rembourser', 'repay', { id: String(s.debt), cls: 'ghost small', disabled: s.debt <= 0 || s.cash <= 0 })}
          </div>
          <p class="g-small">Les intérêts se paient chaque jour. Un découvert (trésorerie négative) coûte 10 points de plus.</p>`,
        )}
        ${section(
          'Impôts',
          `${kv([
            ['Impôt sur les sociétés', `${num1(rate)}\u202f% du bénéfice, payé en fin de mois`],
            ['TVA sur les vols intérieurs', `${num(vat)}\u202f% du prix des billets`],
            ['Pertes reportées', `${money(s.taxLossCarry)} <small>(déduites des prochains bénéfices)</small>`],
          ])}`,
        )}
      `;
    },
    action(a, el) {
      const id = el.dataset.id!;
      if (a === 'metric' || a === 'period' || a === 'day' || a === 'invest' || a === 'revenueBy') {
        if (a === 'metric') metric = id as Metric;
        else if (a === 'period') period = id as Period;
        else if (a === 'day') selectedDay = id;
        else if (a === 'invest') withInvest = id === '1';
        else revenueBy = id as 'source' | 'line';
        ui.refresh(true);
      } else if (a === 'month') {
        selected = id;
        selectedDay = null;
        ui.refresh(true);
      } else if (a === 'borrow') {
        ui.act(act.borrow, Number(el.dataset.id));
      } else if (a === 'repay') {
        ui.act(act.repay, Number(el.dataset.id));
      }
    },
  };
}

/** Pastille de l'onglet : trésorerie négative. */
export function financesBadge(ui: Ui): 'bad' | null {
  return ui.game.state.cash < 0 ? 'bad' : null;
}
