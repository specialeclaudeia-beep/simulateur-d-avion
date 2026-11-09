/**
 * Pilotes : équipe, fiche d'un pilote (avion, qualifications, licenciement),
 * recrutement de pilotes expérimentés et formation de débutants.
 */
import * as act from '../../../game/actions';
import { PILOT_SEVERANCE_MONTHS, PILOT_SIGNING_MONTHS, TRAINING_DAYS } from '../../../game/config';
import { pilotProblem } from '../../../game/economy';
import { familyMinStars, trainingCost, typeRatingSpec } from '../../../game/pilots';
import type { Pilot } from '../../../game/state';
import { avatar, badge, btn, dateLong, empty, esc, kv, money, note, num, num1, row, section, stars, when } from '../dom';
import type { Ui, View } from '../ui';
import { aircraftName, pilotFullName } from './common';
import { aircraftView } from './fleet';

function findPilot(ui: Ui, id: string): Pilot | undefined {
  return ui.game.state.pilots.find((p) => p.id === id);
}

/** Familles d'avions de la flotte (pour guider recrutement et formations). */
function fleetFamilies(ui: Ui): Set<string> {
  return new Set(ui.game.state.aircraft.map((a) => ui.game.data.model(a.modelId).family));
}

function pilotStatus(ui: Ui, p: Pilot): string {
  const now = ui.now;
  if (p.training) return badge(`Formation ${p.training.family} jusqu’au ${when(p.training.until, now)}`, 'work');
  if (p.aircraftId) {
    const ac = ui.game.state.aircraft.find((a) => a.id === p.aircraftId);
    return ac ? badge(`Pilote ${aircraftName(ac)}`, 'ok') : badge('Disponible', 'warn');
  }
  return badge('Disponible', 'warn');
}

// ───────────────────────── Équipe ─────────────────────────

export function pilotsView(ui: Ui): View {
  return {
    tab: 'pilots',
    live: true,
    title: () => 'Pilotes',
    render() {
      const s = ui.game.state;
      const actions = `<div class="g-actions">${btn('🤝 Recruter', 'hire')}${btn('🎓 Former un débutant', 'train', { cls: 'ghost' })}</div>`;
      if (!s.pilots.length) {
        return (
          actions +
          empty('Aucun pilote. Recrute un pilote expérimenté (prêt tout de suite) ou forme un débutant (moins cher, mais 20 jours de formation).')
        );
      }
      const payroll = s.pilots.reduce((sum, p) => sum + p.salary, 0);
      const rows = s.pilots
        .map((p) =>
          row({
            action: 'pilot',
            id: p.id,
            icon: avatar(p),
            title: `${esc(pilotFullName(p))} ${stars(p.stars)}`,
            sub: `${pilotStatus(ui, p)} ${p.ratings.length ? `· ${esc(p.ratings.join(', '))}` : ''}`,
            right: `${money(p.salary)}<small>/mois</small>`,
          }),
        )
        .join('');
      return `${actions}<p class="g-small">${s.pilots.length} pilote(s) · salaires ${money(payroll)} par mois</p><div class="g-list">${rows}</div>`;
    },
    action(a, el) {
      if (a === 'hire') ui.push(hireView(ui));
      else if (a === 'train') ui.push(trainNewView(ui));
      else if (a === 'pilot') ui.push(pilotView(ui, el.dataset.id!));
    },
  };
}

// ───────────────────────── Fiche d'un pilote ─────────────────────────

function pilotView(ui: Ui, id: string): View {
  return {
    tab: 'pilots',
    live: true,
    title: () => {
      const p = findPilot(ui, id);
      return p ? pilotFullName(p) : 'Pilote';
    },
    render() {
      const p = findPilot(ui, id);
      if (!p) return empty('Ce pilote a quitté la compagnie.');
      const s = ui.game.state;
      const d = ui.game.data;
      const ac = p.aircraftId ? s.aircraft.find((a) => a.id === p.aircraftId) : undefined;
      const age = new Date(ui.now).getUTCFullYear() - p.birthYear;
      return `
        <div class="g-card">
          <p class="g-title-line g-person">${avatar(p, 'l')} <span><b>${esc(pilotFullName(p))}</b> ${stars(p.stars)}</span></p>
          <p>${pilotStatus(ui, p)}</p>
          ${kv([
            ['Âge', `${age} ans`],
            ['Expérience', `${num(p.hours)} heures de vol`],
            ['Qualifications', p.ratings.length ? esc(p.ratings.join(', ')) : 'aucune (en formation)'],
            ['Salaire', `${money(p.salary)} par mois`],
            ['Dans la compagnie depuis', esc(dateLong(p.hiredAt))],
          ])}
          <p class="g-small">Les étoiles montent avec les heures de vol (1 500 h, 4 000 h, 8 000 h, 12 000 h) et le salaire avec elles. Un pilote expérimenté consomme un peu moins de carburant et casse moins.</p>
        </div>
        ${section(
          'Avion',
          ac
            ? `${row({ action: 'aircraft', id: ac.id, icon: '✈️', title: esc(aircraftName(ac)), sub: esc(d.model(ac.modelId).name) })}${btn('Retirer de cet avion', 'unassign', { cls: 'ghost' })}`
            : p.training
              ? note('En formation : il pourra voler à la fin.', 'info')
              : btn('✈️ Affecter à un avion', 'assign'),
        )}
        ${section('Formation', btn('🎓 Se qualifier sur une autre famille', 'rating', { cls: 'ghost', disabled: !!p.training }))}
        ${btn(`Licencier · ${money(p.salary * PILOT_SEVERANCE_MONTHS)} d’indemnité`, 'fire', { cls: 'ghost danger' })}
      `;
    },
    action(a, el) {
      const p = findPilot(ui, id);
      if (!p) return;
      switch (a) {
        case 'aircraft':
          ui.push(aircraftView(ui, el.dataset.id!));
          return;
        case 'unassign':
          if (p.aircraftId) ui.act(act.assignPilot, p.aircraftId, null);
          return;
        case 'assign':
          ui.push(assignView(ui, id));
          return;
        case 'rating':
          ui.push(typeRatingView(ui, id));
          return;
        case 'fire':
          void ui
            .confirm({
              title: 'Licencier ce pilote ?',
              text: `${esc(pilotFullName(p))} partira avec ${money(p.salary * PILOT_SEVERANCE_MONTHS)} d’indemnité.`,
              ok: 'Licencier',
              danger: true,
            })
            .then((yes) => {
              if (yes && ui.act(act.firePilot, id)) ui.back();
            });
      }
    },
  };
}

function assignView(ui: Ui, pilotId: string): View {
  return {
    tab: 'pilots',
    title: () => 'Affecter à un avion',
    render() {
      const p = findPilot(ui, pilotId);
      if (!p) return empty('Pilote introuvable.');
      const s = ui.game.state;
      const d = ui.game.data;
      const rows = s.aircraft
        .filter((ac) => ac.id !== p.aircraftId)
        .map((ac) => {
          const m = d.model(ac.modelId);
          const pb = pilotProblem(p, m);
          const current = ac.pilotId ? s.pilots.find((x) => x.id === ac.pilotId) : undefined;
          return pb
            ? `<div class="g-row static dim"><span class="g-row-main"><span class="g-row-title">${esc(aircraftName(ac))} <small>${esc(m.name)}</small></span><span class="g-row-sub">${esc(pb)}</span></span></div>`
            : row({
                action: 'pick',
                id: ac.id,
                icon: '✈️',
                title: `${esc(aircraftName(ac))} <small>${esc(m.name)}</small>`,
                sub: current ? `Remplace ${esc(pilotFullName(current))}` : 'Sans pilote',
              });
        })
        .join('');
      return rows ? `<div class="g-list">${rows}</div>` : empty('Aucun avion dans la flotte.');
    },
    action(a, el) {
      if (a === 'pick' && ui.act(act.assignPilot, el.dataset.id!, pilotId)) ui.back();
    },
  };
}

function typeRatingView(ui: Ui, pilotId: string): View {
  return {
    tab: 'pilots',
    title: () => 'Qualification',
    render() {
      const p = findPilot(ui, pilotId);
      if (!p) return empty('Pilote introuvable.');
      const d = ui.game.data;
      const s = ui.game.state;
      const mine = fleetFamilies(ui);
      const fams = [...d.families.values()].filter((f) => !p.ratings.includes(f.name)).sort((a, b) => Number(mine.has(b.name)) - Number(mine.has(a.name)) || a.name.localeCompare(b.name));
      const rows = fams
        .map((f) => {
          const spec = typeRatingSpec(d, s, f.name);
          const blocked = f.large && p.stars < 2;
          return `<div class="g-row static${blocked ? ' dim' : ''}">
            <span class="g-row-main"><span class="g-row-title">${esc(f.name)} ${mine.has(f.name) ? badge('dans ta flotte', 'ok') : ''}</span>
              <span class="g-row-sub">${f.large ? 'Gros-porteur · ' : ''}${spec.days} jours${blocked ? ' · 2 étoiles minimum' : ''}</span></span>
            ${blocked ? '' : btn(money(spec.cost), 'go', { id: f.name, cls: 'small', disabled: spec.cost > s.cash || !!p.aircraftId })}
          </div>`;
        })
        .join('');
      return `${p.aircraftId ? note('Retire d’abord ce pilote de son avion : il ne vole pas pendant la formation.', 'warn') : ''}<div class="g-list">${rows}</div>`;
    },
    action(a, el) {
      if (a === 'go' && ui.act(act.trainTypeRating, pilotId, el.dataset.id!)) ui.back();
    },
  };
}

// ───────────────────────── Recruter ─────────────────────────

export function hireView(ui: Ui): View {
  return {
    tab: 'pilots',
    title: () => 'Recruter',
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const mine = fleetFamilies(ui);
      const needs = [...mine].map((f) => {
        const fam = d.families.get(f);
        const big = fam ? familyMinStars(fam) : 1;
        return `${esc(f)}${big > 1 ? ` (${big}★ min.)` : ''}`;
      });
      const useful = (c: { ratings: string[] }) => c.ratings.some((r) => mine.has(r));
      // Ceux qui peuvent voler sur la flotte d'abord.
      const cards = [...s.market.pilots]
        .sort((a, b) => Number(useful(b)) - Number(useful(a)))
        .map((c) => {
          const fits = useful(c);
          return `<div class="g-card g-listing${fits ? ' good' : ''}">
            <p class="g-title-line g-person">${avatar(c)} <span><b>${esc(pilotFullName(c))}</b> ${stars(c.stars)}</span></p>
            <p class="g-small">${num(c.hours)} h de vol · qualifié(e) ${esc(c.ratings.join(', '))}${fits ? ` · ${badge('vole sur ta flotte', 'ok')}` : ''}</p>
            <div class="g-listing-foot"><span>${money(c.salary)}<small>/mois</small></span>${btn(`Embaucher · ${money(c.signingFee)}`, 'hire', { id: c.id, cls: 'small', disabled: c.signingFee > s.cash })}</div>
          </div>`;
        })
        .join('');
      return `
        <p class="g-small">${needs.length ? `Ta flotte vole sur : <b>${needs.join(', ')}</b>.` : 'Achète d’abord un avion pour savoir quelle qualification chercher.'} Prime d’embauche : ${num1(PILOT_SIGNING_MONTHS)} mois de salaire. Nouveaux candidats chaque semaine.</p>
        ${cards || empty('Plus de candidat cette semaine.')}
      `;
    },
    action(a, el) {
      if (a === 'hire') ui.act(act.hirePilot, el.dataset.id!);
    },
  };
}

// ───────────────────────── Former un débutant ─────────────────────────

export function trainNewView(ui: Ui): View {
  return {
    tab: 'pilots',
    title: () => 'Former un débutant',
    render() {
      const d = ui.game.data;
      const s = ui.game.state;
      const mine = fleetFamilies(ui);
      const cost = trainingCost(d, s);
      const fams = [...d.families.values()]
        .filter((f) => !f.large && f.models.some((m) => m.inProduction || mine.has(f.name)))
        .sort((a, b) => Number(mine.has(b.name)) - Number(mine.has(a.name)) || a.name.localeCompare(b.name));
      return `
        <p class="g-small">Un élève pilote coûte <b>${money(cost)}</b> de formation et ${TRAINING_DAYS} jours d’école. Il sortira 1 étoile, qualifié sur la famille choisie (pas de gros-porteur pour commencer).</p>
        <div class="g-list">${fams
          .map(
            (f) => `<div class="g-row static"><span class="g-row-main"><span class="g-row-title">${esc(f.name)} ${mine.has(f.name) ? badge('dans ta flotte', 'ok') : ''}</span>
              <span class="g-row-sub">${esc(f.models.map((m) => m.name).slice(0, 4).join(', '))}</span></span>
              ${btn('Former', 'go', { id: f.name, cls: 'small', disabled: cost > s.cash })}</div>`,
          )
          .join('')}</div>
      `;
    },
    action(a, el) {
      if (a === 'go' && ui.act(act.trainNewPilot, el.dataset.id!)) ui.openTab('pilots');
    },
  };
}

/** Pastille de l'onglet : un pilote disponible alors qu'un avion attend. */
export function pilotsBadge(ui: Ui): 'warn' | null {
  const s = ui.game.state;
  const free = s.pilots.some((p) => !p.aircraftId && !p.training);
  const waiting = s.aircraft.some((a) => !a.pilotId && a.status !== 'delivery');
  return free && waiting ? 'warn' : null;
}
