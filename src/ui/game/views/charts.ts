/**
 * Petits graphiques en HTML/CSS pour l'onglet Finances : histogramme avec axes
 * légendés, et camembert (anneau) avec légende chiffrée.
 */
import { esc } from '../dom';

export interface BarPoint {
  /** Identifiant renvoyé au toucher (data-id). */
  id: string;
  /** Étiquette sous la colonne (vide = pas d'étiquette). */
  label: string;
  /** Nom complet pour l'accessibilité et la ligne de lecture. */
  name: string;
  value: number;
}

export interface BarChartOpts {
  /** Action envoyée au toucher d'une colonne. */
  action: string;
  selected: string | null;
  /** Format d'une valeur (ex. « 1,2 M$ », « 320 vols »). */
  fmt: (v: number) => string;
  /** Format court pour les graduations. */
  tick: (v: number) => string;
  /** Unité de l'axe vertical, ex. « dollars US ». */
  yLabel: string;
  /** Légende de l'axe horizontal, ex. « mois ». */
  xLabel: string;
  /** Couleur unique (sinon bleu au-dessus de zéro, rouge en dessous). */
  tone?: 'pos';
}

/**
 * Histogramme : une colonne par point, graduations à gauche (maximum, zéro,
 * minimum), unité au-dessus, légende de l'axe horizontal en dessous.
 */
export function barChart(points: BarPoint[], o: BarChartOpts): string {
  const values = points.map((p) => p.value);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const zero = (max / span) * 100; // position de la ligne du zéro depuis le haut, en %
  const cols = points
    .map((p) => {
      const h = (Math.abs(p.value) / span) * 100;
      const pos = p.value >= 0;
      const style = pos ? `bottom:${100 - zero}%;height:${h}%` : `top:${zero}%;height:${h}%`;
      const tone = o.tone ?? (pos ? 'pos' : 'neg');
      return `<button type="button" class="g-col${p.id === o.selected ? ' on' : ''}" data-a="${o.action}" data-id="${esc(p.id)}" aria-label="${esc(p.name)} : ${esc(o.fmt(p.value))}">
        <span class="g-col-plot"><span class="g-col-bar ${tone}" style="${style}${p.value === 0 ? ';min-height:0' : ''}"></span></span>
        <small>${esc(p.label)}</small>
      </button>`;
    })
    .join('');
  const ticks = [`<span style="top:0">${esc(o.tick(max))}</span>`];
  if (max > 0 && min < 0) ticks.push(`<span style="top:${zero}%">0</span>`);
  ticks.push(`<span style="top:100%">${esc(o.tick(min))}</span>`);
  const sel = points.find((p) => p.id === o.selected) ?? points[points.length - 1];
  return `
    <p class="g-axis-y">↑ ${esc(o.yLabel)}</p>
    <div class="g-plot">
      <div class="g-ticks">${ticks.join('')}</div>
      <div class="g-chart" style="--zero:${zero}%">${cols}</div>
    </div>
    <p class="g-axis-x">${esc(o.xLabel)} →</p>
    ${sel ? `<p class="g-readout">${esc(sel.name)} : <b>${esc(o.fmt(sel.value))}</b></p>` : ''}`;
}

export interface PieSlice {
  label: string;
  value: number;
}

/** Couleurs des parts (distinctes sur fond sombre). */
const PALETTE = ['#4da3ff', '#f5a524', '#36c47a', '#e66767', '#b388ff', '#2fc6c6', '#f07ec0', '#c9b458', '#8fa3c7'];
const MAX_SLICES = 8;

/**
 * Camembert en anneau : les parts les plus grosses d'abord, au-delà de 8 elles
 * sont regroupées en « Autres ». Le total est écrit au centre.
 */
export function pieChart(slices: PieSlice[], fmt: (v: number) => string, emptyText: string): string {
  let list = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((t, s) => t + s.value, 0);
  if (total <= 0) return `<p class="g-small">${esc(emptyText)}</p>`;
  if (list.length > MAX_SLICES) {
    const rest = list.slice(MAX_SLICES - 1).reduce((t, s) => t + s.value, 0);
    list = [...list.slice(0, MAX_SLICES - 1), { label: 'Autres', value: rest }];
  }
  let acc = 0;
  const stops = list
    .map((s, i) => {
      const from = (acc / total) * 100;
      acc += s.value;
      return `${PALETTE[i % PALETTE.length]} ${from}% ${(acc / total) * 100}%`;
    })
    .join(',');
  const legend = list
    .map(
      (s, i) => `<li><span class="g-key" style="background:${PALETTE[i % PALETTE.length]}"></span>
        <span class="g-pie-name">${esc(s.label)}</span>
        <span class="g-pie-val">${esc(fmt(s.value))} <small>${Math.round((s.value / total) * 100)} %</small></span></li>`,
    )
    .join('');
  return `<div class="g-pie-wrap">
      <div class="g-pie" style="background:conic-gradient(${stops})" role="img" aria-label="Total ${esc(fmt(total))}">
        <span class="g-pie-hole"><small>Total</small><b>${esc(fmt(total))}</b></span>
      </div>
      <ul class="g-pie-legend">${legend}</ul>
    </div>`;
}
