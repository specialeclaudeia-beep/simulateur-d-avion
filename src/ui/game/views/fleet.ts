/**
 * Flotte : liste des avions, fiche d'un avion (pilote, lignes, révision,
 * réparation, vente…), contrats chez les constructeurs et marché de l'occasion.
 */
import * as act from '../../../game/actions';
import { DAY, MIN_STARS, USED_DELIVERY_HOURS, USED_MARKET_SIZE } from '../../../game/config';
import { CATEGORY_LABEL, type AircraftModel } from '../../../game/data';
import { YEAR, ageYears, aircraftValue, blockMinutes, pilotProblem, routeProblem } from '../../../game/economy';
import { orderQuote } from '../../../game/fleet';
import { maintenanceQuote, repairQuote } from '../../../game/sim';
import type { Aircraft } from '../../../game/state';
import { avatar, badge, bar, btn, dateLong, empty, esc, flagEmoji, kv, money, note, num, pct, row, section, signedMoneyHtml, stars, when } from '../dom';
import type { Ui, View } from '../ui';
import { aircraftName, cityOf, pilotFullName, place, statusOf } from './common';
import { openLineView } from './lines';
import { hireView, trainNewView } from './pilots';

// ───────────────────────── Outils ─────────────────────────

function modelIcon(m: AircraftModel): string {
  if (m.kind === 'cargo') return '📦';
  return m.category === 'regional_turboprop' ? '🛩️' : '✈️';
}

function capacity(m: AircraftModel): string {
  return m.kind === 'cargo' ? `${num(m.cargoT ?? 0)} t de fret` : `${num(m.seats ?? 0)} sièges`;
}

function findAc(ui: Ui, id: string): Aircraft | undefined {
  return ui.game.state.aircraft.find((a) => a.id === id);
}

/** Choix du hub de livraison (seulement si la compagnie en a plusieurs). */
function hubSelect(ui: Ui, selected: string): string {
  const s = ui.game.state;
  if (s.hubs.length < 2) return '';
  return `<label class="g-field"><span>Hub de livraison</span><select class="g-input" data-in="base">${s.hubs
    .map((h) => `<option value="${h.iata}"${h.iata === selected ? ' selected' : ''}>${esc(cityOf(ui.game.data, h.iata))} (${h.iata})</option>`)
    .join('')}</select></label>`;
}

/** Places libres au parking d'un hub. */
function parkingLeft(ui: Ui, iata: string): number {
  const s = ui.game.state;
  const hub = s.hubs.find((h) => h.iata === iata);
  return hub ? hub.parking - s.aircraft.filter((a) => a.base === iata).length : 0;
}

// ───────────────────────── Liste ─────────────────────────

export function fleetView(ui: Ui): View {
  return {
    tab: 'fleet',
    live: true,
    title: () => 'Flotte',
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const now = ui.now;
      const actions = `<div class="g-actions">${btn('🛒 Acheter neuf', 'buyNew')}${btn('♻️ Occasion', 'used', { cls: 'ghost' })}</div>`;
      if (!s.aircraft.length) {
        return (
          actions +
          empty(
            'Pas encore d’avion. Neuf, il arrive en quelques jours après la signature du contrat ; d’occasion, il est livré en 36 h et coûte bien moins cher.',
          )
        );
      }
      const flying = s.aircraft.filter((a) => a.status === 'flying').length;
      const rows = s.aircraft
        .map((ac) => {
          const m = d.model(ac.modelId);
          const st = statusOf(ui.ctx, ac, now);
          return row({
            action: 'open',
            id: ac.id,
            icon: modelIcon(m),
            title: `${esc(aircraftName(ac))} <small>${esc(m.name)}</small>`,
            sub: `${badge(st.label, st.tone)} ${st.detail}`,
            right: `${bar(ac.condition / 100)}<small>${Math.round(ac.condition)}\u202f%</small>`,
          });
        })
        .join('');
      return `${actions}<p class="g-small">${s.aircraft.length} avion(s) · ${flying} en vol</p><div class="g-list">${rows}</div>`;
    },
    action(a, el) {
      if (a === 'buyNew') ui.push(buyNewView(ui));
      else if (a === 'used') ui.push(usedMarketView(ui));
      else if (a === 'open') ui.push(aircraftView(ui, el.dataset.id!));
    },
  };
}

// ───────────────────────── Fiche d'un avion ─────────────────────────

export function aircraftView(ui: Ui, id: string): View {
  return {
    tab: 'fleet',
    live: true,
    title: () => {
      const ac = findAc(ui, id);
      return ac ? aircraftName(ac) : 'Avion';
    },
    render() {
      const ac = findAc(ui, id);
      if (!ac) return empty('Cet avion ne fait plus partie de la flotte.');
      const s = ui.game.state;
      const d = ui.game.data;
      const now = ui.now;
      const m = d.model(ac.modelId);
      const mfr = d.manufacturerById.get(m.mfr);
      const st = statusOf(ui.ctx, ac, now);
      const pilot = ac.pilotId ? s.pilots.find((p) => p.id === ac.pilotId) : undefined;
      const atHub = s.hubs.some((h) => h.iata === ac.location);
      const canService = (ac.status === 'idle' || ac.status === 'ground') && atHub && ac.condition < 99;

      // Actions principales selon l'état.
      const main: string[] = [btn('🗺️ Voir sur la carte', 'map', { cls: 'ghost' })];
      if (ac.status === 'broken') {
        const q = repairQuote(ui.ctx, ac);
        main.unshift(btn(`🔧 Réparer · ${money(q.cost)}`, 'repair'));
      } else {
        // Toujours affiché (grisé quand c'est impossible) : sinon, en vitesse ×10 000, le
        // bouton apparaît et disparaît à chaque escale et toute la fiche saute.
        const q = maintenanceQuote(ui.ctx, ac);
        main.push(
          btn(`🛠️ Révision · ${money(q.cost)} · ${q.hours} h`, 'service', {
            cls: 'ghost',
            disabled: !canService,
            extra: canService ? '' : ' title="Possible seulement quand l’avion est au sol à un hub"',
          }),
        );
      }

      const pilotBlock = pilot
        ? `<div class="g-card g-inline"><span class="g-person">${avatar(pilot)} <b>${esc(pilotFullName(pilot))}</b> ${stars(pilot.stars)}</span>
             <span>${btn('Changer', 'pickPilot', { cls: 'ghost small' })}${btn('Retirer', 'unassign', { cls: 'ghost small' })}</span></div>`
        : `${note('Sans pilote, l’avion reste au sol.', 'warn')}${btn('🧑‍✈️ Choisir un pilote', 'pickPilot')}`;

      const lines = ac.program.map((lid) => s.lines.find((l) => l.id === lid)).filter((l) => l !== undefined);
      const departures = act.dailyDepartures(ui.ctx, ac);
      const linesBlock = lines.length
        ? `<div class="g-list">${lines
            .map(
              (l) => `<div class="g-row static"><span class="g-row-main"><span class="g-row-title">${place(d, l.hub)} ⇄ ${place(d, l.dest)}</span>
                <span class="g-row-sub">${num(l.km)} km · ${Math.round(blockMinutes(l.km, m))} min de vol</span></span>
                ${btn('✕', 'removeLine', { id: l.id, cls: 'ghost small', extra: ' aria-label="Retirer la ligne"' })}</div>`,
            )
            .join('')}</div>
           <p class="g-small">≈ ${departures.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} départs par jour depuis ${esc(cityOf(d, ac.base))}, en alternant les lignes.</p>`
        : note('Aucune ligne : l’avion ne vole pas.', 'warn');

      const age = ageYears(ac, now);
      const value = aircraftValue(d, ac, now);
      const profit = ac.stats.revenue - ac.stats.costs;
      return `
        <div class="g-card">
          <p class="g-title-line">${modelIcon(m)} <b>${esc(mfr?.name ?? '')} ${esc(m.name)}</b> · ${capacity(m)}</p>
          <p class="g-status-line">${badge(st.label, st.tone)} ${st.detail}</p>
          <p class="g-cond">État ${bar(ac.condition / 100)} <b>${Math.round(ac.condition)}\u202f%</b></p>
          <div class="g-actions">${main.join('')}</div>
        </div>
        ${section('Pilote', pilotBlock)}
        ${section('Lignes', linesBlock + btn('＋ Ajouter une ligne', 'addLine', { cls: lines.length ? 'ghost' : '' }))}
        ${section(
          'Résultats depuis l’achat',
          kv([
            ['Vols', num(ac.stats.flights)],
            [m.kind === 'cargo' ? 'Fret transporté' : 'Passagers', m.kind === 'cargo' ? `${num(ac.stats.cargoT)} t` : num(ac.stats.pax)],
            ['Recettes', money(ac.stats.revenue)],
            ['Coûts des vols', money(ac.stats.costs)],
            ['Marge', signedMoneyHtml(profit)],
          ]),
        )}
        ${section(
          'Fiche technique',
          kv([
            ['Hub', place(d, ac.base)],
            ['Catégorie', CATEGORY_LABEL[m.category]],
            ['Rayon d’action', `${num(m.rangeKm)} km`],
            ['Vitesse de croisière', `${num(m.cruiseKmh)} km/h`],
            ['Piste minimale', `${num(m.runwayM)} m`],
            ['Âge', age < 1 ? 'neuf' : `${age.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ans`],
            ['Heures de vol', num(ac.hours)],
            ['Valeur estimée', money(value)],
            ['Prix payé', money(ac.pricePaid)],
          ]),
        )}
        ${section(
          'Gestion',
          `<div class="g-actions">${btn('✏️ Renommer', 'rename', { cls: 'ghost' })}${s.hubs.length > 1 ? btn('🏢 Changer de hub', 'transfer', { cls: 'ghost' }) : ''}${btn(
            `Vendre · ${money(act.resalePrice(ui.ctx, ac, now))}`,
            'sell',
            { cls: 'ghost danger' },
          )}</div>`,
        )}
      `;
    },
    action(a, el) {
      const ac = findAc(ui, id);
      if (!ac) return;
      switch (a) {
        case 'map':
          if (ac.status === 'flying' && ac.leg) {
            ui.aircraft.selectProvided(ac.leg.id);
            ui.aircraft.follow(true);
            if (window.innerWidth < 900) ui.close();
          } else {
            ui.flyTo(ac.location, 9);
          }
          return;
        case 'repair':
          ui.act(act.repairAircraft, id);
          return;
        case 'service':
          ui.act(act.maintainAircraft, id);
          return;
        case 'pickPilot':
          ui.push(pilotPickView(ui, id));
          return;
        case 'unassign':
          ui.act(act.assignPilot, id, null);
          return;
        case 'addLine':
          ui.push(linePickView(ui, id));
          return;
        case 'removeLine':
          ui.act(act.removeLineFromAircraft, id, el.dataset.id!);
          return;
        case 'rename':
          void ui.prompt({ title: 'Nom de l’avion', value: ac.name ?? '', placeholder: 'Ex. Ville de Nantes' }).then((name) => {
            if (name !== null) ui.act(act.renameAircraft, id, name);
          });
          return;
        case 'transfer':
          ui.push(transferView(ui, id));
          return;
        case 'sell': {
          const price = act.resalePrice(ui.ctx, ac, ui.now);
          void ui
            .confirm({ title: 'Vendre cet avion ?', text: `${esc(aircraftName(ac))} sera vendu ${money(price)}. Ses lignes et son pilote seront libérés.`, ok: 'Vendre', danger: true })
            .then((yes) => {
              if (yes && ui.act(act.sellAircraft, id)) ui.back();
            });
          return;
        }
      }
    },
  };
}

// ───────────────────────── Choisir un pilote ─────────────────────────

function pilotPickView(ui: Ui, acId: string): View {
  return {
    tab: 'fleet',
    title: () => 'Choisir un pilote',
    render() {
      const ac = findAc(ui, acId);
      if (!ac) return empty('Avion introuvable.');
      const s = ui.game.state;
      const m = ui.game.data.model(ac.modelId);
      const min = MIN_STARS[m.category] ?? 1;
      const ok = s.pilots.filter((p) => !pilotProblem(p, m) && p.id !== ac.pilotId);
      const others = s.pilots.filter((p) => pilotProblem(p, m) && p.id !== ac.pilotId);
      const intro = `<p class="g-small">Il faut un pilote qualifié sur la famille <b>${esc(m.family)}</b>${min > 1 ? ` avec au moins ${min} étoiles` : ''}.</p>`;
      const list = ok.length
        ? `<div class="g-list">${ok
            .map((p) => {
              const other = p.aircraftId ? s.aircraft.find((a) => a.id === p.aircraftId) : undefined;
              return row({
                action: 'pick',
                id: p.id,
                icon: avatar(p),
                title: `${esc(pilotFullName(p))} ${stars(p.stars)}`,
                sub: other ? `Pilote déjà ${esc(aircraftName(other))} : il changera d’avion` : `Disponible · ${num(p.hours)} h de vol`,
              });
            })
            .join('')}</div>`
        : note(`Aucun pilote disponible pour un ${esc(m.name)}.`, 'warn');
      const unfit = others.length
        ? section(
            'Pas qualifiés pour cet avion',
            `<div class="g-list">${others
              .map((p) => `<div class="g-row static dim"><span class="g-row-main"><span class="g-row-title">${esc(pilotFullName(p))} ${stars(p.stars)}</span><span class="g-row-sub">${esc(pilotProblem(p, m) ?? '')}</span></span></div>`)
              .join('')}</div>`,
          )
        : '';
      return `${intro}${list}<div class="g-actions">${btn('Recruter un pilote', 'hire', { cls: 'ghost' })}${btn('Former un débutant', 'train', { cls: 'ghost' })}</div>${unfit}`;
    },
    action(a, el) {
      if (a === 'pick') {
        if (ui.act(act.assignPilot, acId, el.dataset.id!)) ui.back();
      } else if (a === 'hire') ui.push(hireView(ui));
      else if (a === 'train') ui.push(trainNewView(ui));
    },
  };
}

// ───────────────────────── Ajouter une ligne ─────────────────────────

function linePickView(ui: Ui, acId: string): View {
  return {
    tab: 'fleet',
    title: () => 'Ajouter une ligne',
    render() {
      const ac = findAc(ui, acId);
      if (!ac) return empty('Avion introuvable.');
      const s = ui.game.state;
      const d = ui.game.data;
      const candidates = s.lines.filter((l) => l.hub === ac.base && !ac.program.includes(l.id));
      const rows = candidates
        .map((l) => {
          const pb = act.aircraftLineProblem(ui.ctx, ac, l);
          const served = s.aircraft.filter((x) => x.program.includes(l.id)).length;
          return pb
            ? `<div class="g-row static dim"><span class="g-row-main"><span class="g-row-title">${place(d, l.hub)} ⇄ ${place(d, l.dest)}</span><span class="g-row-sub">${esc(pb)}</span></span></div>`
            : row({
                action: 'add',
                id: l.id,
                icon: '🗺️',
                title: `${place(d, l.hub)} ⇄ ${place(d, l.dest)}`,
                sub: `${num(l.km)} km · ${served ? `${served} avion(s) déjà dessus` : 'aucun avion pour l’instant'}`,
              });
        })
        .join('');
      return `
        <p class="g-small">Lignes au départ de ${place(d, ac.base)}. Un avion peut en desservir plusieurs à tour de rôle.</p>
        ${rows ? `<div class="g-list">${rows}</div>` : note('Aucune autre ligne ne part de ce hub.', 'info')}
        ${btn('＋ Ouvrir une nouvelle ligne', 'open', { cls: 'ghost' })}
      `;
    },
    action(a, el) {
      const ac = findAc(ui, acId);
      if (!ac) return;
      if (a === 'add') {
        if (ui.act(act.addLineToAircraft, acId, el.dataset.id!)) ui.back();
      } else if (a === 'open') ui.push(openLineView(ui, ac.base));
    },
  };
}

// ───────────────────────── Changer de hub ─────────────────────────

function transferView(ui: Ui, acId: string): View {
  return {
    tab: 'fleet',
    title: () => 'Changer de hub',
    render() {
      const ac = findAc(ui, acId);
      if (!ac) return empty('Avion introuvable.');
      const d = ui.game.data;
      const m = d.model(ac.modelId);
      const rows = ui.game.state.hubs
        .filter((h) => h.iata !== ac.base)
        .map((h) => {
          const km = Math.round(d.distanceKm(ac.base, h.iata));
          const left = parkingLeft(ui, h.iata);
          const problem = km > m.rangeKm ? 'Trop loin pour cet avion' : left < 1 ? 'Parking plein' : '';
          return problem
            ? `<div class="g-row static dim"><span class="g-row-main"><span class="g-row-title">${place(d, h.iata)}</span><span class="g-row-sub">${problem}</span></span></div>`
            : row({ action: 'go', id: h.iata, icon: '🏢', title: place(d, h.iata), sub: `${num(km)} km · vol de convoyage sans passagers` });
        })
        .join('');
      return `${note('L’avion part tout de suite s’installer à son nouveau hub. Ses lignes actuelles lui sont retirées.', 'info')}<div class="g-list">${rows}</div>`;
    },
    action(a, el) {
      if (a === 'go' && ui.act(act.transferAircraft, acId, el.dataset.id!)) ui.back();
    },
  };
}

// ───────────────────────── Avions neufs ─────────────────────────

export function buyNewView(ui: Ui): View {
  return {
    tab: 'fleet',
    title: () => 'Constructeurs',
    render() {
      const d = ui.game.data;
      const s = ui.game.state;
      const rows = d.manufacturers
        .filter((mf) => !mf.usedOnly && mf.contractDiscount)
        .map((mf) => {
          const models = d.models.filter((m) => m.mfr === mf.id && m.inProduction);
          if (!models.length) return '';
          const [lo, hi] = mf.contractDiscount!;
          const bought = s.relations[mf.id] ?? 0;
          return row({
            action: 'mfr',
            id: mf.id,
            icon: `<span class="g-flag">${flagEmoji(mf.country)}</span>`,
            title: esc(mf.name),
            sub: `${models.length} modèle(s) · remise ${Math.round(lo * 100)} à ${Math.round(hi * 100)}\u202f% selon la quantité${bought ? ` · ${bought} déjà acheté(s)` : ''}`,
          });
        })
        .join('');
      return `<p class="g-small">Un contrat se négocie : plus tu commandes d’avions d’un coup, plus la remise sur le prix catalogue est grande. Les clients fidèles gagnent un petit bonus.</p>
        ${btn('♻️ Moins cher : les avions d’occasion', 'used', { cls: 'ghost' })}
        <div class="g-list">${rows}</div>`;
    },
    action(a, el) {
      if (a === 'mfr') ui.push(manufacturerView(ui, el.dataset.id!));
      else if (a === 'used') ui.push(usedMarketView(ui));
    },
  };
}

function manufacturerView(ui: Ui, mfrId: string): View {
  return {
    tab: 'fleet',
    title: () => ui.game.data.manufacturerById.get(mfrId)?.name ?? 'Constructeur',
    render() {
      const d = ui.game.data;
      const year = new Date(ui.now).getUTCFullYear();
      const models = d.models.filter((m) => m.mfr === mfrId && m.inProduction).sort((a, b) => a.priceUsd - b.priceUsd);
      return `<div class="g-list">${models
        .map((m) =>
          row({
            action: 'model',
            id: m.id,
            icon: modelIcon(m),
            title: `${esc(m.name)}${m.eis > year ? ` ${badge(`dès ${m.eis}`, 'mute')}` : ''}`,
            sub: `${CATEGORY_LABEL[m.category]} · ${capacity(m)} · ${num(m.rangeKm)} km`,
            right: money(m.priceUsd),
          }),
        )
        .join('')}</div><p class="g-small">Prix catalogue, avant remise.</p>`;
    },
    action(a, el) {
      if (a === 'model') ui.push(modelView(ui, el.dataset.id!));
    },
  };
}

function modelView(ui: Ui, modelId: string): View {
  let qty = 1;
  let base = ui.game.state.hubs[0]?.iata ?? '';
  return {
    tab: 'fleet',
    title: () => ui.game.data.model(modelId).name,
    render() {
      const d = ui.game.data;
      const s = ui.game.state;
      const m = d.model(modelId);
      const mfr = d.manufacturerById.get(m.mfr)!;
      if (!s.hubs.some((h) => h.iata === base)) base = s.hubs[0].iata;
      const q = orderQuote(d, s, m, qty, ui.now);
      const hub = d.airport(base);
      const reachable = d.routesFrom(base).filter((r) => !routeProblem(d, m, d.airport(r.a), d.airport(r.b), r.km)).length;
      const left = parkingLeft(ui, base);
      const min = MIN_STARS[m.category] ?? 1;
      const problems: string[] = [];
      if (left < qty) problems.push(`Parking de ${esc(cityOf(d, base))} : ${left} place(s) libre(s). Agrandis-le dans l’onglet Hubs.`);
      if (q.total > s.cash) problems.push(`Il te manque ${money(q.total - s.cash)}.`);
      return `
        <div class="g-card">
          <p class="g-title-line">${modelIcon(m)} <b>${esc(mfr.name)} ${esc(m.name)}</b></p>
          ${kv([
            ['Catégorie', CATEGORY_LABEL[m.category]],
            ['Capacité', capacity(m)],
            ['Rayon d’action', `${num(m.rangeKm)} km`],
            ['Vitesse', `${num(m.cruiseKmh)} km/h`],
            ['Consommation', `${num(m.fuelKgH)} kg de kérosène par heure`],
            ['Piste minimale', `${num(m.runwayM)} m`],
            ['Pilotes', `qualification ${esc(m.family)}${min > 1 ? `, ${min} étoiles minimum` : ''}`],
            ['Prix catalogue', money(m.priceUsd)],
          ])}
          <p class="g-small">Depuis ${esc(hub.city || hub.name)}, il peut desservir <b>${reachable}</b> des ${d.routesFrom(base).length} lignes réelles.</p>
        </div>
        ${section(
          'Contrat',
          `${hubSelect(ui, base)}
          <div class="g-stepper">
            <span>Nombre d’avions</span>
            <button type="button" class="g-btn ghost small" data-a="qty" data-id="-1" aria-label="Un de moins">−</button>
            <b>${qty}</b>
            <button type="button" class="g-btn ghost small" data-a="qty" data-id="1" aria-label="Un de plus">＋</button>
          </div>
          ${kv([
            ['Remise négociée', `${pct(q.discount)}${q.loyalty > 0 ? ` <small>(dont fidélité ${pct(q.loyalty)})</small>` : ''}`],
            ['Prix par avion', money(q.unitPrice)],
            ['Total', `<b>${money(q.total)}</b>`],
            ['Première livraison', `${esc(dateLong(q.deliveries[0]))} (${Math.max(1, Math.round((q.deliveries[0] - ui.now) / DAY))} jours)`],
            ...(qty > 1 ? ([['Dernière livraison', esc(dateLong(q.deliveries[q.deliveries.length - 1]))]] as [string, string][]) : []),
          ])}
          ${problems.map((p) => note(p, 'warn')).join('')}
          ${btn(`✍️ Signer le contrat · ${money(q.total)}`, 'sign', { disabled: problems.length > 0 })}`,
        )}
      `;
    },
    input(el) {
      if (el.dataset.in === 'base') {
        base = el.value;
        ui.refresh(true);
      }
    },
    action(a, el) {
      if (a === 'qty') {
        qty = Math.min(30, Math.max(1, qty + Number(el.dataset.id)));
        ui.refresh(true);
      } else if (a === 'sign') {
        const m = ui.game.data.model(modelId);
        const q = orderQuote(ui.game.data, ui.game.state, m, qty, ui.now);
        void ui
          .confirm({
            title: 'Signer le contrat ?',
            text: `${qty} × ${esc(m.name)} pour <b>${money(q.total)}</b>, payés aujourd’hui. Livraison à partir du ${esc(dateLong(q.deliveries[0]))}.`,
            ok: 'Signer',
          })
          .then((yes) => {
            if (yes && ui.act(act.orderAircraft, modelId, qty, base)) ui.openTab('fleet');
          });
      }
    },
  };
}

// ───────────────────────── Occasion ─────────────────────────

export function usedMarketView(ui: Ui): View {
  let base = ui.game.state.hubs[0]?.iata ?? '';
  return {
    tab: 'fleet',
    title: () => 'Marché de l’occasion',
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const now = ui.now;
      if (!s.hubs.some((h) => h.iata === base)) base = s.hubs[0].iata;
      const next = s.market.refreshedAt + 7 * DAY;
      const cards = s.market.used
        .map((l) => {
          const m = d.model(l.modelId);
          const age = (now - l.builtAt) / YEAR;
          return `<div class="g-card g-listing">
            <p class="g-title-line">${modelIcon(m)} <b>${esc(d.manufacturerById.get(m.mfr)?.name ?? '')} ${esc(m.name)}</b> · ${capacity(m)}</p>
            <p class="g-small">${age.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ans · ${num(l.hours)} h de vol · ${num(m.rangeKm)} km de rayon d’action</p>
            <p class="g-cond">État ${bar(l.condition / 100)} <b>${l.condition}\u202f%</b></p>
            <div class="g-listing-foot"><b class="g-price">${money(l.price)}</b>${btn('Acheter', 'buy', { id: l.id, disabled: l.price > s.cash })}</div>
          </div>`;
        })
        .join('');
      return `
        <p class="g-small">${USED_MARKET_SIZE} annonces renouvelées chaque semaine (prochaines ${esc(when(next, now))}). Livraison en ${USED_DELIVERY_HOURS} h. Un avion usé coûte moins cher mais tombe plus souvent en panne.</p>
        ${hubSelect(ui, base)}
        ${parkingLeft(ui, base) < 1 ? note(`Parking de ${esc(cityOf(d, base))} plein : agrandis-le dans l’onglet Hubs.`, 'warn') : ''}
        ${cards || empty('Plus aucune annonce cette semaine.')}
      `;
    },
    input(el) {
      if (el.dataset.in === 'base') {
        base = el.value;
        ui.refresh(true);
      }
    },
    action(a, el) {
      if (a !== 'buy') return;
      const l = ui.game.state.market.used.find((x) => x.id === el.dataset.id);
      if (!l) return;
      const m = ui.game.data.model(l.modelId);
      void ui
        .confirm({ title: 'Acheter cet avion ?', text: `${esc(m.name)} d’occasion (état ${l.condition}\u202f%) pour <b>${money(l.price)}</b>, livré à ${esc(cityOf(ui.game.data, base))}.`, ok: 'Acheter' })
        .then((yes) => {
          if (yes && ui.act(act.buyUsed, l.id, base)) ui.openTab('fleet');
        });
    },
  };
}

/** Pastille de l'onglet : rouge si un avion est en panne, orange s'il reste inactif. */
export function fleetBadge(ui: Ui): 'bad' | 'warn' | null {
  const s = ui.game.state;
  if (s.aircraft.some((a) => a.status === 'broken')) return 'bad';
  if (s.aircraft.some((a) => a.status === 'idle')) return 'warn';
  return null;
}

