/**
 * Finances : trésorerie, résultat du mois détaillé, historique des mois
 * (graphique bénéfice / perte), banque (emprunts) et impôts.
 */
import * as act from '../../../game/actions';
import { BANKRUPTCY_DAYS, DAY, DOMESTIC_VAT_MAX, DOMESTIC_VAT_SHARE, FUEL_PRICE_START, loanRate } from '../../../game/config';
import { INVEST_KEYS, LEDGER_LABEL, OPEX_KEYS, REVENUE_KEYS, monthLabel, summarize } from '../../../game/ledger';
import type { MonthLedger } from '../../../game/state';
import { btn, esc, kv, money, note, num, section, signedMoneyHtml } from '../dom';
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

/**
 * Graphique du résultat net mois par mois : une colonne par mois, bleue au-dessus
 * de zéro (bénéfice), rouge en dessous (perte). Toucher une colonne affiche le
 * détail de ce mois.
 */
function chart(months: MonthLedger[], selected: string): string {
  const profits = months.map((m) => summarize(m).profit);
  const max = Math.max(1, ...profits.map(Math.abs));
  const hasNeg = profits.some((p) => p < 0);
  const hasPos = profits.some((p) => p > 0);
  // Ligne du zéro : en bas s'il n'y a que des bénéfices, en haut s'il n'y a que des pertes.
  const zero = hasNeg && hasPos ? 50 : hasNeg ? 0 : 100;
  const cols = months
    .map((m, i) => {
      const p = profits[i];
      const h = (Math.abs(p) / max) * (hasNeg && hasPos ? 50 : 100);
      const style = p >= 0 ? `bottom:${100 - zero}%;height:${h}%` : `top:${zero}%;height:${h}%`;
      return `<button type="button" class="g-col${m.month === selected ? ' on' : ''}" data-a="month" data-id="${m.month}" aria-label="${esc(monthLabel(m.month))} : ${p >= 0 ? 'bénéfice' : 'perte'} ${esc(money(p))}">
        <span class="g-col-plot"><span class="g-col-bar ${p >= 0 ? 'pos' : 'neg'}" style="${style}"></span></span>
        <small>${shortMonth(m.month)}</small>
      </button>`;
    })
    .join('');
  return `<div class="g-chart" style="--zero:${zero}%">${cols}</div>`;
}

export function financesView(ui: Ui): View {
  let selected: string | null = null;
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
            ['Réputation', `${Math.round(s.reputation)} / 100`],
            ['Kérosène', `${s.fuelPrice.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $/kg <small>(${fuelVsNormal >= 0 ? '+' : ''}${Math.round(fuelVsNormal * 100)} % par rapport à la normale)</small>`],
          ])}
        </div>
        ${section(
          'Résultat net par mois',
          `${chart(months, selected)}
           <p class="g-small"><span class="g-key pos"></span> bénéfice <span class="g-key neg"></span> perte · touche un mois pour son détail</p>`,
        )}
        ${section(
          `${isCurrent ? 'Ce mois-ci' : 'Mois de'} ${esc(monthLabel(shown.month))}`,
          `<p class="g-small">${num(shown.flights)} vols · ${num(shown.pax)} passagers${shown.cargoT ? ` · ${num(shown.cargoT)} t de fret` : ''}</p>
           <dl class="g-kv g-ledger">
             ${ledgerRows(shown, REVENUE_KEYS, 1)}
             <dt><b>Recettes</b></dt><dd><b>${money(sum.revenue)}</b></dd>
             ${ledgerRows(shown, OPEX_KEYS, -1)}
             <dt><b>Résultat avant impôt</b></dt><dd><b>${signedMoneyHtml(sum.profitBeforeTax)}</b></dd>
             <dt>${isCurrent ? 'Impôt estimé (fin de mois)' : 'Impôt sur les sociétés'}</dt><dd>−${money(estTax)}</dd>
             <dt><b>Résultat net</b></dt><dd><b>${signedMoneyHtml(sum.profitBeforeTax - estTax)}</b></dd>
           </dl>
           ${sum.invest > 0 ? `<p class="g-small">Investissements du mois (hors résultat) :</p><dl class="g-kv g-ledger">${ledgerRows(shown, INVEST_KEYS, -1)}</dl>` : ''}`,
        )}
        ${section(
          'Banque',
          `${kv([
            ['Taux d’intérêt', `${loanPct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % par an`],
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
            ['Impôt sur les sociétés', `${rate} % du bénéfice, payé en fin de mois`],
            ['TVA sur les vols intérieurs', `${num(vat)} % du prix des billets`],
            ['Pertes reportées', `${money(s.taxLossCarry)} <small>(déduites des prochains bénéfices)</small>`],
          ])}`,
        )}
      `;
    },
    action(a, el) {
      if (a === 'month') {
        selected = el.dataset.id!;
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
