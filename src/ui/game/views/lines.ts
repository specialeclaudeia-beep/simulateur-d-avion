/**
 * Lignes : liste des lignes de la compagnie, ouverture d'une ligne réelle
 * depuis un hub (demande, concurrents, prix), fiche d'une ligne (prix du
 * billet, avions affectés, résultats, fermeture).
 */
import * as act from '../../../game/actions';
import { PERKS, limits } from '../../../game/campaign';
import { demandContext, playerShare, presentRivals, rivalList, warOn } from '../../../game/competition';
import { PRICE_FACTOR_MAX, PRICE_FACTOR_MIN } from '../../../game/config';
import type { Route } from '../../../game/data';
import { domesticVatRate, playerPaxPerDay, referenceFare, routeProblem } from '../../../game/economy';
import { lineFrequency } from '../../../game/schedule';
import { emptyStats, type Line } from '../../../game/state';
import { icon } from '../../icons';
import { badge, btn, dateLong, empty, esc, flagEmoji, fold, kv, locked, money, note, num, pct, quota, row, section, signedMoneyHtml, withIcon } from '../dom';
import type { Ui, View } from '../ui';
import { aircraftName, cityOf, place } from './common';
import { aircraftView, buyNewView } from './fleet';
import { hubView } from './hubs';

const LIST_LIMIT = 50;

// ───────────────────────── Outils ─────────────────────────

function findLine(ui: Ui, id: string): Line | undefined {
  return ui.game.state.lines.find((l) => l.id === id);
}

function otherEnd(r: Route, iata: string): string {
  return r.a === iata ? r.b : r.a;
}

/** Passagers par jour et par sens que la compagnie peut espérer sur une ligne. */
function expectedPax(ui: Ui, line: Line, legsPerDay: number): number {
  const d = ui.game.data;
  const route = d.route(line.hub, line.dest);
  if (!route) return 0;
  return playerPaxPerDay(demandContext(ui.ctx, line, route, 90, legsPerDay, ui.game.state.time));
}

/**
 * Les compagnies présentes sur une ligne, en toutes lettres, avec ce qui a
 * changé depuis le début de la partie (nouvelle venue, guerre des prix).
 */
function competitors(ui: Ui, r: Route, max = 4): string {
  if (!ui.game.state.competition) return 'aucun (partie sans concurrence)';
  const present = rivalList(ui.ctx, r, ui.now).filter((x) => x.status !== 'gone');
  if (!present.length) return 'aucune compagnie';
  const names = present
    .slice(0, max)
    .map((x) => `${esc(x.name)}${x.status === 'war' ? ` ${badge('guerre des prix', 'bad')}` : x.status === 'new' ? ` ${badge('nouvelle', 'warn')}` : ''}`);
  return names.join(', ') + (present.length > max ? ` et ${present.length - max} autre(s)` : '');
}

/** Nombre de concurrents sur une ligne, en quelques mots (liste des destinations). */
function rivalCount(ui: Ui, r: Route): string {
  if (!ui.game.state.competition) return 'sans concurrence';
  const n = presentRivals(ui.game.state, r).length;
  return n ? `${n} concurrent(s)` : 'aucun concurrent';
}

/** Mode par échelons : toutes les lignes autorisées sont-elles ouvertes ? */
function linesFull(ui: Ui): boolean {
  const lim = limits(ui.game.state);
  return !!lim && ui.game.state.lines.length >= lim.lines;
}

function lineTitle(ui: Ui, l: Line): string {
  return `${place(ui.game.data, l.hub)} ⇄ ${place(ui.game.data, l.dest)}`;
}

// ───────────────────────── Liste ─────────────────────────

export function linesView(ui: Ui): View {
  return {
    tab: 'lines',
    live: true,
    title: () => 'Lignes',
    render() {
      const s = ui.game.state;
      const lim = limits(s);
      const top = btn(withIcon('plus', 'Ouvrir une ligne'), 'open');
      if (!s.lines.length) {
        return top + empty('Aucune ligne pour l’instant. Ouvre une ligne réelle depuis ton hub, puis affecte-lui un avion et un pilote.');
      }
      const rows = s.lines
        .map((l) => {
          const served = s.aircraft.filter((a) => a.program.includes(l.id)).length;
          const f = lineFrequency(ui.ctx, l.id);
          const perDay = f.pax + f.cargo;
          const m = l.month;
          const load = m.seats ? m.pax / m.seats : m.capT ? m.cargoT / m.capT : 0;
          return row({
            action: 'line',
            id: l.id,
            icon: served ? icon('takeoff', 22) : icon('pauseCircle', 22, 'warn'),
            title: lineTitle(ui, l),
            sub: served
              ? `${served} avion(s) · ${perDay.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} vol(s)/jour · ce mois : ${m.flights ? `remplissage ${pct(load)}, marge ${signedMoneyHtml(m.revenue - m.costs)}` : 'pas encore de vol'}`
              : `${badge('Sans avion', 'warn')} ${num(l.km)} km`,
            right: `${Math.round(l.priceFactor * 100)}\u202f%`,
          });
        })
        .join('');
      return `${top}<p class="g-small">${lim ? quota('route', s.lines.length, lim.lines, 'Lignes autorisées à cet échelon') : `${s.lines.length} ligne(s).`} À droite : prix du billet par rapport au prix habituel.</p><div class="g-list">${rows}</div>`;
    },
    action(a, el) {
      if (a === 'open') ui.push(openLineView(ui, ui.game.state.hubs[0].iata));
      else if (a === 'line') ui.push(lineView(ui, el.dataset.id!));
    },
  };
}

// ───────────────────────── Ouvrir une ligne ─────────────────────────

export function openLineView(ui: Ui, startHub: string): View {
  let hub = startHub;
  let search = '';
  let sort: 'demand' | 'near' | 'far' = 'demand';
  let lastPreview = '';

  const candidates = (): Route[] => {
    const d = ui.game.data;
    const s = ui.game.state;
    const taken = new Set(s.lines.filter((l) => l.hub === hub || l.dest === hub).map((l) => (l.hub === hub ? l.dest : l.hub)));
    const q = fold(search.trim());
    let list = d.routesFrom(hub).filter((r) => !taken.has(otherEnd(r, hub)));
    // Mode par échelons : tant que les droits internationaux ne sont pas acquis, lignes intérieures seulement.
    const lim = limits(s);
    if (lim && !lim.intl) list = list.filter((r) => d.airport(otherEnd(r, hub)).country === s.company.country);
    if (q) {
      list = list.filter((r) => {
        const a = d.airport(otherEnd(r, hub));
        return fold(`${a.city} ${a.name} ${a.iata} ${d.country(a.country)?.name ?? ''}`).includes(q);
      });
    }
    const by = { demand: (x: Route, y: Route) => y.demand - x.demand, near: (x: Route, y: Route) => x.km - y.km, far: (x: Route, y: Route) => y.km - x.km }[sort];
    return list.sort(by);
  };

  const preview = (list: Route[]) => {
    const key = `${hub}:${list.slice(0, 40).map((r) => otherEnd(r, hub)).join(',')}`;
    if (key === lastPreview) return;
    lastPreview = key;
    const d = ui.game.data;
    ui.network.setPreview({ focus: d.airport(hub), dests: list.slice(0, 40).map((r) => d.airport(otherEnd(r, hub))) });
  };

  return {
    tab: 'lines',
    title: () => 'Ouvrir une ligne',
    render() {
      const d = ui.game.data;
      const s = ui.game.state;
      if (!s.hubs.some((h) => h.iata === hub)) hub = s.hubs[0].iata;
      const h = s.hubs.find((x) => x.iata === hub)!;
      const used = s.lines.filter((l) => l.hub === hub).length;
      const list = candidates();
      preview(list);
      const shown = list.slice(0, LIST_LIMIT);
      const rows = shown
        .map((r) => {
          const dest = d.airport(otherEnd(r, hub));
          return row({
            action: 'dest',
            id: dest.iata,
            icon: `<span class="g-flag">${flagEmoji(dest.country)}</span>`,
            title: `${esc(dest.city || dest.name)} <small>${dest.iata}</small>`,
            sub: `${num(r.km)} km · ${num(r.demand)} pass./jour · ${rivalCount(ui, r)}`,
            right: money(act.lineOpeningCost(r.km)),
          });
        })
        .join('');
      const hubPicker =
        s.hubs.length > 1
          ? `<label class="g-field"><span>Depuis le hub</span><select class="g-input" data-in="hub">${s.hubs
              .map((x) => `<option value="${x.iata}"${x.iata === hub ? ' selected' : ''}>${esc(cityOf(d, x.iata))} (${x.iata})</option>`)
              .join('')}</select></label>`
          : '';
      const lim = limits(s);
      const domesticOnly = !!lim && !lim.intl;
      return `
        ${hubPicker}
        <p class="g-small">Licences de lignes à ${esc(cityOf(d, hub))} : <b>${used} / ${h.lineSlots}</b> utilisées.${lim ? ` ${quota('route', s.lines.length, lim.lines, 'Lignes autorisées à cet échelon')}` : ''}</p>
        ${linesFull(ui) ? locked(`${lim!.lines} lignes au plus à cet échelon. L’amélioration « ${PERKS.lines.title} » ou l’échelon suivant en autorisent plus.`) : ''}
        ${domesticOnly ? locked(`Lignes intérieures seulement pour l’instant : l’étranger s’ouvre à l’échelon 5 ou avec l’amélioration « ${PERKS.intl.title} ».`) : ''}
        ${used >= h.lineSlots ? `${note('Toutes les licences sont utilisées : achète une licence de plus à ce hub.', 'warn')}${btn(withIcon('hub', 'Améliorer le hub'), 'hub', { cls: 'ghost' })}` : ''}
        <input class="g-input" type="search" data-in="search" placeholder="Rechercher une ville, un pays…" value="${esc(search)}">
        <div class="g-chips">
          ${(['demand', 'near', 'far'] as const).map((k) => `<button type="button" class="g-chip${sort === k ? ' on' : ''}" data-a="sort" data-id="${k}">${{ demand: 'Plus de passagers', near: 'Plus proches', far: 'Plus lointaines' }[k]}</button>`).join('')}
        </div>
        <p class="g-small">Vraies lignes au départ de ${esc(cityOf(d, hub))}. Passagers par jour et par sens, toutes compagnies confondues.</p>
        ${rows ? `<div class="g-list">${rows}</div>` : empty('Aucune destination ne correspond.')}
        ${list.length > shown.length ? `<p class="g-small">… et ${list.length - shown.length} autres destinations : utilise la recherche.</p>` : ''}
      `;
    },
    input(el, final) {
      if (el.dataset.in === 'search') {
        search = el.value;
        const pos = (el as HTMLInputElement).selectionStart;
        ui.refresh(true);
        const again = document.querySelector<HTMLInputElement>('.g-body [data-in=search]');
        if (again) {
          again.focus();
          if (pos !== null) again.setSelectionRange(pos, pos);
        }
      } else if (el.dataset.in === 'hub' && final) {
        hub = el.value;
        ui.refresh(true);
      }
    },
    action(a, el) {
      if (a === 'sort') {
        sort = el.dataset.id as typeof sort;
        ui.refresh(true);
      } else if (a === 'dest') ui.push(linePreviewView(ui, hub, el.dataset.id!));
      else if (a === 'hub') ui.push(hubView(ui, hub));
    },
  };
}

function linePreviewView(ui: Ui, hub: string, dest: string): View {
  let shown = false;
  return {
    tab: 'lines',
    title: () => `${cityOf(ui.game.data, hub)} ⇄ ${cityOf(ui.game.data, dest)}`,
    render() {
      const d = ui.game.data;
      const s = ui.game.state;
      const route = d.route(hub, dest);
      if (!route) return empty('Cette ligne n’existe pas.');
      const A = d.airport(hub);
      const B = d.airport(dest);
      if (!shown) {
        shown = true;
        ui.network.setPreview({ focus: B, origin: A, dests: [B] });
        ui.fitAirports([hub, dest]);
      }
      const fake: Line = { id: '', number: 0, hub, dest, km: route.km, priceFactor: 1, openedAt: 0, stats: emptyStats(), month: emptyStats() };
      const one = expectedPax(ui, fake, 1);
      const three = expectedPax(ui, fake, 3);
      const fare = referenceFare(d, A, B, route.km);
      const vat = domesticVatRate(d, s, A, B);
      const based = s.aircraft.filter((ac) => ac.base === hub);
      const fleetOk = based.filter((ac) => !routeProblem(d, d.model(ac.modelId), A, B, route.km));
      const cost = act.lineOpeningCost(route.km);
      const h = s.hubs.find((x) => x.iata === hub)!;
      const full = s.lines.filter((l) => l.hub === hub).length >= h.lineSlots;
      const capped = linesFull(ui);
      return `
        <div class="g-card">
          ${kv([
            ['Distance', `${num(route.km)} km`],
            ['Demande réelle', `${num(route.demand)} passagers par jour et par sens`],
            ['Concurrents', competitors(ui, route, 6)],
            ['Ta part des passagers', `≈ ${pct(playerShare(ui.ctx, fake, route, ui.now))} <small>(avec 1 vol par jour)</small>`],
            ['Billet moyen', `${money(fare)}${vat > 0 ? ` <small>(TVA intérieure ${pct(vat)})</small>` : ''}`],
            ['Tes passagers estimés', `≈ ${num(one)} par jour avec 1 vol quotidien, ${num(three)} avec 3`],
            ['Ouverture', money(cost)],
          ])}
        </div>
        ${
          fleetOk.length
            ? note(`${fleetOk.length} de tes avions basés ici peuvent voler sur cette ligne.`, 'good')
            : based.length
              ? note('Aucun de tes avions basés ici ne peut la desservir : il en faudra un avec assez de rayon d’action.', 'info')
              : note('Pas encore d’avion basé ici : tu en achèteras un juste après.', 'info')
        }
        ${full ? note('Plus de licence de ligne libre à ce hub.', 'warn') : ''}
        ${capped ? locked('Toutes les lignes autorisées à cet échelon sont ouvertes.') : ''}
        ${btn(`Ouvrir la ligne · ${money(cost)}`, 'open', { disabled: full || capped || cost > s.cash })}
      `;
    },
    action(a) {
      if (a !== 'open') return;
      if (ui.act(act.openLine, hub, dest)) {
        const line = ui.game.state.lines.find((l) => l.hub === hub && l.dest === dest);
        if (line) {
          ui.network.setPreview(null);
          ui.replace(lineView(ui, line.id));
        }
      }
    },
  };
}

// ───────────────────────── Fiche d'une ligne ─────────────────────────

export function lineView(ui: Ui, id: string): View {
  let shown = false;
  return {
    tab: 'lines',
    live: true,
    title: () => {
      const l = findLine(ui, id);
      return l ? `${cityOf(ui.game.data, l.hub)} ⇄ ${cityOf(ui.game.data, l.dest)}` : 'Ligne';
    },
    render() {
      const l = findLine(ui, id);
      if (!l) {
        ui.network.setSelectedLine(null);
        return empty('Cette ligne a été fermée.');
      }
      const d = ui.game.data;
      const s = ui.game.state;
      const route = d.route(l.hub, l.dest);
      if (!shown) {
        shown = true;
        ui.network.setPreview(null);
        ui.network.setSelectedLine(id);
        ui.fitAirports([l.hub, l.dest]);
      }
      const A = d.airport(l.hub);
      const B = d.airport(l.dest);
      const fare = referenceFare(d, A, B, l.km);
      const f = lineFrequency(ui.ctx, l.id);
      const legs = f.pax + f.cargo;
      const est = expectedPax(ui, l, Math.max(1, f.pax));
      const served = s.aircraft.filter((a) => a.program.includes(l.id));
      const m = l.month;
      const t = l.stats;
      const stats = (x: typeof m) =>
        kv([
          ['Vols', num(x.flights)],
          ...(x.seats ? ([['Passagers', `${num(x.pax)} (remplissage ${pct(x.pax / x.seats)})`]] as [string, string][]) : []),
          ...(x.capT ? ([['Fret', `${num(x.cargoT)} t (remplissage ${pct(x.cargoT / x.capT)})`]] as [string, string][]) : []),
          ['Recettes', money(x.revenue)],
          ['Coûts des vols', money(x.costs)],
          ['Marge', signedMoneyHtml(x.revenue - x.costs)],
        ]);
      const war = route ? warOn(s, route, ui.now) : null;
      const gone = route ? rivalList(ui.ctx, route, ui.now).filter((x) => x.status === 'gone') : [];
      const rivalry =
        route && s.competition
          ? section(
              'Concurrence',
              `${war ? note(`Guerre des prix : ${esc(d.airlineName(war.airline))} casse ses tarifs jusqu’au ${esc(dateLong(war.until))}. Baisse tes prix ou laisse passer l’orage.`, 'bad') : ''}
               ${kv([
                 ['Ta part des passagers', `≈ ${pct(playerShare(ui.ctx, l, route, ui.now))}`],
                 ['Compagnies sur la ligne', competitors(ui, route, 8)],
                 ...(gone.length ? ([['Ont abandonné', gone.map((x) => esc(x.name)).join(', ')]] as [string, string][]) : []),
               ])}
               <p class="g-small">Une ligne bien remplie et sans rivale attire de nouvelles compagnies ; une compagnie appréciée et bien installée finit par les décourager.</p>`,
            )
          : '';
      return `
        <p class="g-small">${num(l.km)} km · ouverte le ${esc(dateLong(l.openedAt))}${route && !s.competition ? ' · partie sans concurrence' : ''}</p>
        ${section(
          'Prix du billet',
          `<div class="g-price-box">
            <b class="g-price" data-live="fare">${money(fare * l.priceFactor)}</b>
            <span data-live="factor">${Math.round(l.priceFactor * 100)}\u202f% du prix habituel (${money(fare)})</span>
          </div>
          <input class="g-range" type="range" data-in="price" min="${PRICE_FACTOR_MIN * 100}" max="${PRICE_FACTOR_MAX * 100}" step="5" value="${Math.round(l.priceFactor * 100)}" aria-label="Prix du billet">
          <p class="g-small">Moins cher : plus de passagers. Plus cher : plus de recette par passager mais des sièges vides.</p>
          <p class="g-small" data-live="estimate">${served.length ? `Demande estimée pour toi : ≈ ${num(est)} passagers par jour et par sens.` : ''}</p>`,
        )}
        ${section(
          `Avions sur la ligne (${served.length})`,
          (served.length
            ? `<div class="g-list">${served.map((a) => row({ action: 'aircraft', id: a.id, icon: icon('plane', 22), title: esc(aircraftName(a)), sub: esc(d.model(a.modelId).name) })).join('')}</div>
               <p class="g-small">≈ ${legs.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} vol(s) par jour dans chaque sens.</p>`
            : note('Aucun avion : la ligne ne rapporte rien.', 'warn')) + btn(withIcon('plus', 'Affecter un avion'), 'assign', { cls: served.length ? 'ghost' : '' }),
        )}
        ${rivalry}
        ${section('Ce mois-ci', stats(m))}
        ${section('Depuis l’ouverture', stats(t))}
        ${btn('Fermer la ligne', 'close', { cls: 'ghost danger' })}
      `;
    },
    input(el, final) {
      if (el.dataset.in !== 'price') return;
      const l = findLine(ui, id);
      if (!l) return;
      const factor = Number(el.value) / 100;
      const d = ui.game.data;
      const fare = referenceFare(d, d.airport(l.hub), d.airport(l.dest), l.km);
      const body = el.closest('.g-body')!;
      body.querySelector('[data-live=fare]')!.textContent = money(fare * factor);
      body.querySelector('[data-live=factor]')!.textContent = `${Math.round(factor * 100)}\u202f% du prix habituel (${money(fare)})`;
      const est = body.querySelector('[data-live=estimate]');
      if (est && est.textContent) {
        const f = lineFrequency(ui.ctx, l.id);
        est.textContent = `Demande estimée pour toi : ≈ ${num(expectedPax(ui, { ...l, priceFactor: factor }, Math.max(1, f.pax)))} passagers par jour et par sens.`;
      }
      if (final) {
        ui.act(act.setLinePrice, id, factor);
        (el as HTMLInputElement).blur();
      }
    },
    action(a, el) {
      const l = findLine(ui, id);
      if (!l) return;
      if (a === 'aircraft') ui.push(aircraftView(ui, el.dataset.id!));
      else if (a === 'assign') ui.push(assignAircraftView(ui, id));
      else if (a === 'close') {
        void ui
          .confirm({
            title: 'Fermer la ligne ?',
            text: `La ligne ${esc(cityOf(ui.game.data, l.hub))} ⇄ ${esc(cityOf(ui.game.data, l.dest))} sera fermée et retirée du programme de ses avions. Les frais d’ouverture ne sont pas remboursés.`,
            ok: 'Fermer la ligne',
            danger: true,
          })
          .then((yes) => {
            if (yes && ui.act(act.closeLine, id)) {
              ui.network.setSelectedLine(null);
              ui.back();
            }
          });
      }
    },
  };
}

function assignAircraftView(ui: Ui, lineId: string): View {
  return {
    tab: 'lines',
    title: () => 'Affecter un avion',
    render() {
      const l = findLine(ui, lineId);
      if (!l) return empty('Ligne introuvable.');
      const d = ui.game.data;
      const s = ui.game.state;
      const list = s.aircraft.filter((a) => !a.program.includes(lineId));
      const rows = list
        .map((ac) => {
          const pb = act.aircraftLineProblem(ui.ctx, ac, l);
          const m = d.model(ac.modelId);
          const others = ac.program.length;
          return pb
            ? `<div class="g-row static dim"><span class="g-row-main"><span class="g-row-title">${esc(aircraftName(ac))} <small>${esc(m.name)}</small></span><span class="g-row-sub">${esc(pb)}</span></span></div>`
            : row({
                action: 'pick',
                id: ac.id,
                icon: icon('plane', 22),
                title: `${esc(aircraftName(ac))} <small>${esc(m.name)}</small>`,
                sub: others ? `Dessert déjà ${others} ligne(s) : il alternera` : 'Libre',
              });
        })
        .join('');
      return rows
        ? `<p class="g-small">L’avion doit être basé à ${esc(cityOf(d, l.hub))} et pouvoir faire ${num(l.km)} km.</p><div class="g-list">${rows}</div>`
        : empty('Tous tes avions desservent déjà cette ligne, ou tu n’as pas encore d’avion.', btn(withIcon('cart', 'Acheter un avion'), 'buy'));
    },
    action(a, el) {
      if (a === 'pick') {
        if (ui.act(act.addLineToAircraft, el.dataset.id!, lineId)) ui.back();
      } else if (a === 'buy') ui.push(buyNewView(ui));
    },
  };
}

/** Pastille de l'onglet : une ligne sans aucun avion. */
export function linesBadge(ui: Ui): 'warn' | null {
  const s = ui.game.state;
  return s.lines.some((l) => !s.aircraft.some((a) => a.program.includes(l.id))) ? 'warn' : null;
}
