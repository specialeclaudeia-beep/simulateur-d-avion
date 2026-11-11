/**
 * Hubs : guide des premiers pas, liste des hubs, fiche d'un hub (capacités et
 * améliorations : portes, licences de lignes, parking, qualité, atelier) et
 * achat d'un nouveau hub dans le monde entier.
 */
import * as act from '../../../game/actions';
import { PERKS, limits } from '../../../game/campaign';
import { DEPARTURES_PER_GATE, HUB_RESALE } from '../../../game/config';
import { TIER_LABEL, type Airport } from '../../../game/data';
import { HUB_UPGRADE_LABEL, hubPrice, hubResale, upgradeInfo, type HubUpgrade } from '../../../game/hubs';
import { basedAircraft, hubDepartures } from '../../../game/schedule';
import { icon } from '../../icons';
import { bar, btn, compact, empty, esc, flagEmoji, fold, kv, locked, money, note, num, quota, row, section, stars, withIcon } from '../dom';
import type { Ui, View } from '../ui';
import { aircraftName, cityOf, place } from './common';
import { aircraftView, buyNewView } from './fleet';
import { lineView, openLineView } from './lines';
import { hireView } from './pilots';

const UPGRADES: HubUpgrade[] = ['gates', 'lineSlots', 'parking', 'quality', 'maintenance'];
const LIST_LIMIT = 50;

// ───────────────────────── Premiers pas ─────────────────────────

function guide(ui: Ui): string {
  const s = ui.game.state;
  // Mode par échelons, sans bureau de recrutement : le premier pilote arrive avec le premier avion.
  const lim = limits(s);
  const founder = !!lim && !lim.recruit;
  const steps = [
    { done: s.lines.length > 0, text: 'Ouvre ta première ligne depuis ton hub', a: 'g-line', label: 'Ouvrir une ligne' },
    { done: s.aircraft.length > 0, text: founder ? 'Achète un avion : ton premier pilote arrive avec lui' : 'Achète un avion, neuf ou d’occasion', a: 'g-plane', label: 'Acheter' },
    founder
      ? { done: s.pilots.length > 0, text: 'Accueille ton premier pilote (les suivants se forment)', a: 'g-pilots', label: 'Pilotes' }
      : { done: s.pilots.length > 0, text: 'Recrute un pilote qualifié pour cet avion', a: 'g-pilot', label: 'Recruter' },
    { done: s.aircraft.some((a) => a.pilotId && a.program.length), text: 'Dans la fiche de l’avion : donne-lui son pilote et sa ligne', a: 'g-fleet', label: 'Flotte' },
  ];
  if (steps.every((x) => x.done) && s.stats.flights > 0) return '';
  const next = steps.findIndex((x) => !x.done);
  return `<div class="g-card g-guide">
    <h3 class="g-h3">Premiers pas</h3>
    <ol>${steps
      .map(
        (x, i) =>
          `<li class="${x.done ? 'done' : ''}"><span>${x.done ? icon('checkCircle', 18) : `<b class="g-step-n">${i + 1}</b>`} ${x.text}</span>${!x.done && i === next ? btn(x.label, x.a, { cls: 'small' }) : ''}</li>`,
      )
      .join('')}</ol>
    <p class="g-small">Ensuite, accélère le temps en haut (×100, ×1000) pour voir tes avions voler et l’argent rentrer.</p>
  </div>`;
}

function guideAction(ui: Ui, a: string): boolean {
  const s = ui.game.state;
  switch (a) {
    case 'g-line':
      ui.push(openLineView(ui, s.hubs[0].iata));
      return true;
    case 'g-plane':
      ui.push(buyNewView(ui));
      return true;
    case 'g-pilot':
      ui.push(hireView(ui));
      return true;
    case 'g-pilots':
      ui.openTab('pilots');
      return true;
    case 'g-fleet':
      ui.openTab('fleet');
      return true;
  }
  return false;
}

// ───────────────────────── Liste des hubs ─────────────────────────

export function hubsView(ui: Ui): View {
  return {
    tab: 'hubs',
    live: true,
    title: () => 'Hubs',
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const rows = s.hubs
        .map((h) => {
          const a = d.airport(h.iata);
          const dep = hubDepartures(ui.ctx, h);
          const lines = s.lines.filter((l) => l.hub === h.iata).length;
          const based = basedAircraft(s, h.iata).length;
          return row({
            action: 'hub',
            id: h.iata,
            icon: icon('hub', 22),
            title: `${esc(a.city || a.name)} <small>${a.iata}</small>`,
            sub: `${TIER_LABEL[a.tier]} · ${lines}/${h.lineSlots} lignes · ${based}/${h.parking} avions · ${Math.ceil(dep.used)}/${dep.capacity} départs/jour`,
            right: stars(h.quality),
          });
        })
        .join('');
      const lim = limits(s);
      const more =
        lim && s.hubs.length >= lim.hubs
          ? locked(`${lim.hubs > 1 ? `${lim.hubs} hubs au plus` : 'Un seul hub'} à cet échelon. L’amélioration « ${PERKS.hub.title} » en ouvre un de plus.`)
          : btn(withIcon('plus', 'Acheter un nouveau hub'), 'catalog', { cls: 'ghost' });
      return `${guide(ui)}${lim ? `<p class="g-small">${quota('hub', s.hubs.length, lim.hubs, 'Hubs autorisés à cet échelon')}</p>` : ''}<div class="g-list">${rows}</div>${more}`;
    },
    action(a, el) {
      if (guideAction(ui, a)) return;
      if (a === 'hub') ui.push(hubView(ui, el.dataset.id!));
      else if (a === 'catalog') ui.push(hubCatalogView(ui));
    },
  };
}

// ───────────────────────── Fiche d'un hub ─────────────────────────

export function hubView(ui: Ui, iata: string): View {
  let flown = false;
  return {
    tab: 'hubs',
    live: true,
    title: () => cityOf(ui.game.data, iata),
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const h = s.hubs.find((x) => x.iata === iata);
      if (!h) return empty('Ce hub ne t’appartient plus.');
      const a = d.airport(iata);
      if (!flown) {
        flown = true;
        ui.flyTo(iata, 6);
      }
      const dep = hubDepartures(ui.ctx, h);
      const lines = s.lines.filter((l) => l.hub === iata);
      const based = basedAircraft(s, iata);
      const lim = limits(s);
      const upgrades = UPGRADES.map((kind) => {
        const info = upgradeInfo(d, h, kind, lim);
        // Bloqué par l'échelon (et non par l'aéroport) : il reste de la marge sans la limite.
        const capped = !info && !!lim && upgradeInfo(d, h, kind) !== null;
        const label = HUB_UPGRADE_LABEL[kind];
        const current = kind === 'maintenance' ? (h.maintenance ? `niveau ${h.maintenance}` : 'aucun') : kind === 'quality' ? stars(h.quality) : String(h[kind]);
        return `<div class="g-upgrade">
          <span class="g-upgrade-icon">${icon(label.icon, 22)}</span>
          <span class="g-upgrade-main"><b>${label.title}</b> <span class="g-small">${current}${info ? ` → ${kind === 'quality' ? `${info.next} ★` : kind === 'maintenance' ? `niveau ${info.next}` : info.next}` : ''}</span>
            <small>${info ? esc(info.effect) : capped ? 'Maximum de cet échelon : il montera au suivant, ou avec une amélioration' : 'Maximum atteint'}</small></span>
          ${info ? btn(money(info.cost), 'up', { id: kind, cls: 'small', disabled: info.cost > s.cash }) : capped ? `<span class="g-upgrade-lock">${icon('lock', 18)}</span>` : ''}
        </div>`;
      }).join('');
      return `
        <div class="g-card">
          <p class="g-title-line"><b>${esc(a.name)}</b> <small>${a.iata}</small></p>
          <p class="g-small">${TIER_LABEL[a.tier]} · n° ${a.rank} mondial · ${compact(a.pax)} passagers par an · ${d.routesFrom(iata).length} destinations réelles</p>
          ${kv([
            ['Départs par jour', `${bar(dep.capacity ? 1 - dep.used / dep.capacity : 0, 'auto')} ${Math.ceil(dep.used)} / ${dep.capacity} <small>(${h.gates} porte(s) × ${DEPARTURES_PER_GATE})</small>`],
            ['Lignes', `${lines.length} / ${h.lineSlots} licences`],
            ['Avions basés', `${based.length} / ${h.parking} places`],
          ])}
          <div class="g-actions">${btn(withIcon('pin', 'Voir sur la carte'), 'map', { cls: 'ghost' })}</div>
        </div>
        ${section('Améliorer le hub', `<div class="g-upgrades">${upgrades}</div>`)}
        ${section(
          `Lignes depuis ce hub (${lines.length})`,
          (lines.length
            ? `<div class="g-list">${lines.map((l) => row({ action: 'line', id: l.id, icon: icon('route', 22), title: `${place(d, l.hub)} ⇄ ${place(d, l.dest)}`, sub: `${num(l.km)} km` })).join('')}</div>`
            : '') + btn(withIcon('plus', 'Ouvrir une ligne'), 'open', { cls: lines.length ? 'ghost' : '' }),
        )}
        ${section(
          `Avions basés ici (${based.length})`,
          based.length
            ? `<div class="g-list">${based.map((ac) => row({ action: 'aircraft', id: ac.id, icon: icon('plane', 22), title: esc(aircraftName(ac)), sub: esc(d.model(ac.modelId).name) })).join('')}</div>`
            : note('Aucun avion basé ici.', 'info'),
        )}
        ${s.hubs.length > 1 ? btn('Vendre ce hub', 'sell', { cls: 'ghost danger' }) : ''}
      `;
    },
    action(a, el) {
      const h = ui.game.state.hubs.find((x) => x.iata === iata);
      if (!h) return;
      switch (a) {
        case 'map':
          ui.flyTo(iata, 9);
          if (window.innerWidth < 900) ui.close();
          return;
        case 'up':
          ui.act(act.upgradeHub, iata, el.dataset.id as HubUpgrade);
          return;
        case 'line':
          ui.push(lineView(ui, el.dataset.id!));
          return;
        case 'open':
          ui.push(openLineView(ui, iata));
          return;
        case 'aircraft':
          ui.push(aircraftView(ui, el.dataset.id!));
          return;
        case 'sell': {
          void ui
            .confirm({ title: 'Vendre ce hub ?', text: `Tu récupères ${money(hubResale(h))} (${Math.round(HUB_RESALE * 100)}\u202f% de ce que tu y as mis).`, ok: 'Vendre', danger: true })
            .then((yes) => {
              if (yes && ui.act(act.sellHub, iata)) ui.back();
            });
        }
      }
    },
  };
}

// ───────────────────────── Acheter un hub ─────────────────────────

function hubCatalogView(ui: Ui): View {
  let country = ui.game.state.company.country;
  let search = '';
  return {
    tab: 'hubs',
    title: () => 'Nouveau hub',
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const owned = new Set(s.hubs.map((h) => h.iata));
      const q = fold(search.trim());
      let list = d.airportsOfCountry(country).filter((a) => !owned.has(a.iata));
      if (q) list = list.filter((a) => fold(`${a.city} ${a.name} ${a.iata}`).includes(q));
      const shown = list.slice(0, LIST_LIMIT);
      // Mode par échelons : les hubs restent dans le pays de l'échelon.
      const home = !!limits(s);
      if (home) country = s.company.country;
      const foreign = country !== s.company.country;
      const options = d
        .playableCountries()
        .map((c) => `<option value="${c.code}"${c.code === country ? ' selected' : ''}>${flagEmoji(c.code)} ${esc(c.name)}</option>`)
        .join('');
      return `
        ${home ? `<p class="g-small">Aéroports de ${flagEmoji(country)} ${esc(d.country(country)?.name ?? country)} : en mode par échelons, tes hubs restent dans le pays de l’échelon.</p>` : `<label class="g-field"><span>Pays</span><select class="g-input" data-in="country">${options}</select></label>`}
        ${foreign ? note('Hors de ton pays, un hub coûte 25\u202f% de plus (droits de trafic).', 'info') : ''}
        <input class="g-input" type="search" data-in="search" placeholder="Rechercher une ville, un aéroport…" value="${esc(search)}">
        <div class="g-list">${shown.map((a) => airportRow(ui, a)).join('') || empty('Aucun aéroport ne correspond.')}</div>
        ${list.length > shown.length ? `<p class="g-small">… et ${list.length - shown.length} autres : précise ta recherche.</p>` : ''}
      `;
    },
    input(el, final) {
      if (el.dataset.in === 'country' && final) {
        country = el.value;
        search = '';
        ui.refresh(true);
      } else if (el.dataset.in === 'search') {
        search = el.value;
        const pos = (el as HTMLInputElement).selectionStart;
        ui.refresh(true);
        const again = document.querySelector<HTMLInputElement>('.g-body [data-in=search]');
        if (again) {
          again.focus();
          if (pos !== null) again.setSelectionRange(pos, pos);
        }
      }
    },
    action(a, el) {
      if (a === 'airport') ui.push(hubBuyView(ui, el.dataset.id!));
    },
  };
}

function airportRow(ui: Ui, a: Airport): string {
  const price = hubPrice(ui.game.state, a);
  return row({
    action: 'airport',
    id: a.iata,
    icon: `<span class="g-rank">${a.rankCountry}</span>`,
    title: `${esc(a.city || a.name)} <small>${a.iata}</small>`,
    sub: `${TIER_LABEL[a.tier]} · ${compact(a.pax)} pass./an · ${num(ui.game.data.routesFrom(a.iata).length)} destinations`,
    right: `<span class="${price > ui.game.state.cash ? 'neg' : ''}">${money(price)}</span>`,
  });
}

function hubBuyView(ui: Ui, iata: string): View {
  let shown = false;
  return {
    tab: 'hubs',
    title: () => cityOf(ui.game.data, iata),
    render() {
      const d = ui.game.data;
      const s = ui.game.state;
      const a = d.airport(iata);
      const routes = d.routesFrom(iata);
      if (!shown) {
        shown = true;
        const dests = routes
          .slice()
          .sort((x, y) => y.demand - x.demand)
          .slice(0, 60)
          .map((r) => d.airport(r.a === iata ? r.b : r.a));
        ui.network.setPreview({ focus: a, dests });
        ui.flyTo(iata, 4);
      }
      const price = hubPrice(s, a);
      const owned = s.hubs.some((h) => h.iata === iata);
      return `
        <div class="g-card">
          <p class="g-title-line"><b>${esc(a.name)}</b> <small>${a.iata}</small> ${flagEmoji(a.country)}</p>
          ${kv([
            ['Taille', `${TIER_LABEL[a.tier]} · n° ${a.rank} mondial`],
            ['Passagers par an', num(a.pax)],
            ['Destinations réelles', num(routes.length)],
            ['Prix', `<b>${money(price)}</b>`],
          ])}
        </div>
        ${owned ? note('Ce hub est déjà à toi.', 'good') : btn(`Acheter ce hub · ${money(price)}`, 'buy', { disabled: price > s.cash })}
      `;
    },
    action(a) {
      if (a !== 'buy') return;
      const price = hubPrice(ui.game.state, ui.game.data.airport(iata));
      void ui.confirm({ title: 'Acheter ce hub ?', text: `${esc(cityOf(ui.game.data, iata))} pour <b>${money(price)}</b>.`, ok: 'Acheter' }).then((yes) => {
        if (yes && ui.act(act.buyHub, iata)) {
          ui.network.setPreview(null);
          ui.openTab('hubs');
          ui.push(hubView(ui, iata));
        }
      });
    },
  };
}

