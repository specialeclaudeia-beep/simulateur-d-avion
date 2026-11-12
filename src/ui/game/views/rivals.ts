/**
 * Les compagnies rivales pilotées par l'ordinateur (partie « avec
 * concurrence ») : politique, flotte, trésorerie, bases, humeur envers le
 * joueur, lignes partagées avec lui et dernières décisions.
 */
import { rivalCompanies, STRATEGIES } from '../../../game/competition';
import type { RivalCo } from '../../../game/state';
import { badge, esc, flagEmoji, money, num, section, when } from '../dom';
import type { Ui, View } from '../ui';

const TONE: Record<RivalCo['strategy'], string> = { lowcost: 'warn', premium: 'fly', agressive: 'bad', prudente: 'ok', expansion: 'work' };

function mood(m: number): string {
  if (m >= 70) return badge('hostile', 'bad');
  if (m >= 40) return badge('méfiante', 'warn');
  return badge('calme', 'mute');
}

function card(ui: Ui, co: RivalCo, lines: number): string {
  const d = ui.game.data;
  const al = d.airlineByCode.get(co.code);
  const st = STRATEGIES[co.strategy];
  const model = d.modelById.get(co.model);
  const hub = al ? d.airportByIata.get(al.hub) : undefined;
  const bases = co.bases.map((b) => d.airportByIata.get(b)?.city || b);
  const growth = co.fleet - co.fleet0;
  const moves = co.moves
    .slice(0, 3)
    .map((m) => `<li><span>${esc(m.text)}</span><time>${esc(when(m.t, ui.now))}</time></li>`)
    .join('');
  return `<div class="g-card g-rival">
    <div class="g-rival-head">
      ${al?.logo ? `<img class="g-rival-logo" src="${esc(al.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <span><b>${esc(d.airlineName(co.code))}</b> ${badge(st.label, TONE[co.strategy])} ${mood(co.mood)}
      <small>${al ? flagEmoji(al.country) : ''} Hub ${esc(hub?.city || al?.hub || '?')}${bases.length ? ` · bases à ${esc(bases.join(', '))}` : ''}</small></span>
    </div>
    <p class="g-small">${esc(st.text)}</p>
    <p class="g-small">${num(co.fleet)} avions${growth ? ` (${growth > 0 ? '+' : ''}${num(growth)})` : ''}${model ? ` · commande des ${esc(model.name)}` : ''} · trésorerie ${money(co.cash)} · ${
      lines ? `<b>sur ${lines} de tes lignes</b>` : 'aucune de tes lignes'
    }</p>
    ${moves ? `<ul class="g-log g-rival-moves">${moves}</ul>` : ''}
  </div>`;
}

export function rivalsView(ui: Ui): View {
  return {
    tab: 'company',
    live: true,
    title: () => 'Compagnies rivales',
    render() {
      const list = rivalCompanies(ui.ctx);
      if (!list.length) return '<p class="g-small">Partie sans concurrence : aucune compagnie ne te dispute les passagers.</p>';
      return `<p class="g-small">Ces compagnies jouent contre toi : chaque semaine, elles commandent des avions, ouvrent des bases, viennent sur tes lignes qui marchent, baissent leurs prix ou abandonnent, chacune selon sa politique. Plus tu t’installes chez elles, plus elles deviennent hostiles.</p>
        ${section('Les plus menaçantes d’abord', list.map((x) => card(ui, x.co, x.lines)).join(''))}`;
    },
  };
}
