/**
 * Mode par échelons : les objectifs de l'échelon en cours, puis le passage à
 * l'échelon suivant en trois écrans (amélioration à choisir, nouveau pays,
 * nouveau hub). Les règles sont dans game/campaign.ts et game/campaignFlow.ts.
 */
import {
  CLASS_ORDER,
  GOALS_TO_CLEAR,
  LEVELS,
  PERKS,
  domesticDests,
  eligibleCountries,
  goalsReached,
  hubsFor,
  levelGoals,
  levelSpec,
  limits,
  nextCapital,
  nextLimits,
  perkCount,
  perkOffer,
  picksAllowed,
  progress,
} from '../../../game/campaign';
import { followingPilot, playedCountries } from '../../../game/campaignFlow';
import { DAY, FIRST_HUB_BUDGET_SHARE } from '../../../game/config';
import { CATEGORY_LABEL, TIER_LABEL, type Airport } from '../../../game/data';
import { pilotName } from '../../../game/pilots';
import type { GoalId, PerkId } from '../../../game/state';
import { icon, perkIcon, type IconName } from '../../icons';
import { bar, btn, compact, empty, esc, flagEmoji, fold, kv, money, note, num, row, section, withIcon } from '../dom';
import { mapPadding, type Ui, type View } from '../ui';

export interface CampaignHooks {
  /** Un échelon vient de commencer : nouveau pays, ou échelon recommencé. */
  levelStarted(): void;
}

const GOAL_ICON: Record<GoalId, IconName> = { airports: 'pin', satisfaction: 'smile', profit: 'money' };
const LIST_LIMIT = 60;

function countryName(ui: Ui, code: string): string {
  return ui.game.data.country(code)?.name ?? code;
}

function limitChip(name: IconName, text: string, on = true): string {
  return `<span class="cg-limit${on ? '' : ' off'}">${icon(on ? name : 'lock', 15)}<span>${text}</span></span>`;
}

/** Les améliorations déjà gagnées, regroupées (« Flotte élargie ×2 »). */
function ownedPerks(perks: readonly PerkId[]): string {
  const counts = new Map<PerkId, number>();
  for (const p of perks) counts.set(p, (counts.get(p) ?? 0) + 1);
  if (!counts.size) return '<p class="g-small">Aucune pour l’instant : tu en choisiras une en changeant de pays.</p>';
  return `<div class="cg-perks">${[...counts]
    .map(([id, n]) => {
      const P = PERKS[id];
      return `<div class="cg-perk static">
        <span class="cg-perk-icon">${perkIcon(P.icon, 26)}</span>
        <span class="cg-perk-text"><b>${esc(P.title)}</b><small>${esc(P.text)}</small></span>
        <span class="cg-perk-check">${n > 1 ? `×${n}` : ''}</span>
      </div>`;
    })
    .join('')}</div>`;
}

// ───────────────────────── Présentation d'un échelon (fenêtre) ─────────────────────────

/** Titre et contenu de la fenêtre qui présente l'échelon en cours (au début de chaque échelon). */
export function levelIntro(ui: Ui): { title: string; html: string } | null {
  const s = ui.game.state;
  const c = s.campaign;
  if (!c || c.finished) return null;
  const L = levelSpec(c.level);
  const lim = limits(s);
  return {
    title: `Échelon ${c.level} · ${L.name}`,
    html: `
      <p>${flagEmoji(s.company.country)} ${esc(countryName(ui, s.company.country))}. ${esc(L.pitch)}</p>
      <ul class="cg-intro-list">
        <li>${icon('pin', 18)}<span>Relier des aéroports du pays</span><b>${c.goals.airports}</b></li>
        <li>${icon('smile', 18)}<span>Satisfaire les passagers</span><b>${c.goals.satisfaction} %</b></li>
        <li>${icon('money', 18)}<span>Gagner de l’argent</span><b>${money(c.goals.profit)}</b></li>
      </ul>
      <p class="g-small" style="margin-top:12px">Deux objectifs sur trois ouvrent l’échelon suivant ; les trois donnent deux améliorations au lieu d’une.${
        lim ? ` À cet échelon : ${lim.fleet} avions, ${lim.lines} lignes${lim.recruit ? '' : ', et un pilote fondateur qui arrive avec ton premier avion'}.` : ''
      }</p>`,
  };
}

// ───────────────────────── Objectifs ─────────────────────────

export function campaignView(ui: Ui, hooks: CampaignHooks): View {
  return {
    tab: 'company',
    live: true,
    title: () => (ui.game.state.campaign?.finished ? 'Campagne terminée' : 'Objectifs'),
    render() {
      const s = ui.game.state;
      const c = s.campaign;
      if (!c) return empty('Cette partie n’est pas en mode par échelons.');
      const done = c.done.length
        ? section(
            'Parcours',
            `<div class="g-list">${c.done
              .map((d) =>
                row({
                  action: 'none',
                  cls: 'static',
                  icon: icon('trophy', 22),
                  title: `Échelon ${d.level} · ${esc(levelSpec(d.level).name)}`,
                  sub: `${flagEmoji(d.country)} ${esc(countryName(ui, d.country))} · ${num(d.days)} jour${d.days > 1 ? 's' : ''} · ${d.goals} objectif${d.goals > 1 ? 's' : ''} sur 3`,
                  right: money(d.profit),
                }),
              )
              .join('')}</div>`,
          )
        : '';

      if (c.finished) {
        return `
          <div class="cg-head">
            <span class="cg-head-level">${icon('trophy', 16)}Campagne terminée</span>
            <h3>Tous les échelons gravis</h3>
            <p>Ta compagnie n’a plus aucune limite : hubs, avions, lignes, le monde entier lui est ouvert. Continue à la développer aussi longtemps que tu veux.</p>
            <div class="cg-head-steps">${LEVELS.map(() => '<i class="done"></i>').join('')}</div>
          </div>
          ${section('Améliorations gagnées', ownedPerks(c.perks))}
          ${done}`;
      }

      const L = levelSpec(c.level);
      const lim = limits(s)!;
      const days = Math.max(0, Math.floor((ui.now - c.levelStartedAt) / DAY));
      const reached = goalsReached(c);
      const picks = picksAllowed(c);
      const goals = progress(ui.ctx, ui.now)
        .map(
          (g) => `<div class="cg-goal${g.reached ? ' reached' : ''}">
            <span class="cg-goal-icon">${icon(g.reached ? 'check' : GOAL_ICON[g.id], 22)}</span>
            <div class="cg-goal-top"><span>${esc(g.title)}</span><span><b>${esc(g.now)}</b> / ${esc(g.target)}</span></div>
            ${bar(g.reached ? 1 : g.ratio, g.reached ? 'auto' : 'accent')}
            <small>${esc(g.hint)}</small>
          </div>`,
        )
        .join('');

      let status: string;
      if (s.bankrupt) {
        status = `${note('La compagnie a fait faillite. Tu peux recommencer cet échelon : même pays, même capital de départ.', 'bad')}`;
      } else if (c.cleared) {
        status = `${note(
          `<b>Échelon réussi !</b> Un nouveau pays t’attend, avec ${picks > 1 ? 'deux améliorations' : 'une amélioration'} à choisir.${
            reached < 3 ? ' Tu peux aussi rester pour atteindre le troisième objectif : tu en choisiras alors deux.' : ''
          }`,
          'good',
        )}${btn(withIcon('takeoff', 'Passer à l’échelon suivant'), 'next')}`;
      } else {
        status = `<p class="g-small">Atteins <b>${GOALS_TO_CLEAR} objectifs sur 3</b> pour ouvrir l’échelon suivant et changer de pays. Avec les trois, tu choisiras deux améliorations au lieu d’une.</p>`;
      }

      return `
        <div class="cg-head">
          <span class="cg-head-level">${icon('stairs', 16)}Échelon ${c.level} sur ${LEVELS.length}</span>
          <h3>${esc(L.name)}</h3>
          <p>${flagEmoji(s.company.country)} ${esc(countryName(ui, s.company.country))} · ${days < 1 ? 'premier jour' : `jour ${days + 1}`}. ${esc(L.pitch)}</p>
          <div class="cg-head-steps">${LEVELS.map((_, i) => `<i class="${i + 1 < c.level ? 'done' : i + 1 === c.level ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        ${status}
        ${goals}
        ${section(
          'Ce que permet cet échelon',
          `<div class="cg-limits">
            ${limitChip('fleet', `${s.aircraft.length} / ${lim.fleet} avions`)}
            ${limitChip('route', `${s.lines.length} / ${lim.lines} lignes`)}
            ${limitChip('hub', `${s.hubs.length} / ${lim.hubs} hub${lim.hubs > 1 ? 's' : ''}`)}
            ${limitChip('plane', `Jusqu’au ${CATEGORY_LABEL[CLASS_ORDER[lim.classCap]].toLowerCase()}`)}
            ${limitChip('star', `Terminal : ${lim.quality} étoiles au plus`)}
            ${limitChip('wrench', `Atelier : niveau ${lim.workshop} au plus`)}
            ${limitChip('userPlus', 'Recrutement de pilotes', lim.recruit)}
            ${limitChip('box', 'Fret', lim.cargo)}
            ${limitChip('globe', 'Lignes vers l’étranger', lim.intl)}
            ${lim.school ? limitChip('school', 'École de pilotes') : ''}
            ${lim.discount > 0 ? limitChip('deal', `Avions à −${Math.round(lim.discount * 100)} %`) : ''}
          </div>
          <p class="g-small">Ce qui est verrouillé s’ouvre avec les échelons suivants ou avec une amélioration.</p>`,
        )}
        ${section('Améliorations gagnées', ownedPerks(c.perks))}
        ${done}
        ${btn(withIcon('recycle', 'Recommencer l’échelon'), 'restart', { cls: 'ghost danger' })}
      `;
    },
    action(a) {
      if (a === 'next') ui.push(perksView(ui, hooks));
      else if (a === 'restart') {
        void ui
          .confirm({
            title: 'Recommencer l’échelon ?',
            text: 'Tu repars du début de cet échelon : même pays, même capital, même hub de départ. Tes avions, tes lignes et tes objectifs atteints ici sont <b>perdus</b> ; tes améliorations restent.',
            ok: 'Recommencer',
            danger: true,
          })
          .then((yes) => {
            if (!yes) return;
            const res = ui.game.restartLevel();
            if (!res.ok) {
              ui.toast(res.error, 'bad');
              return;
            }
            if (res.message) ui.toast(res.message, 'good');
            hooks.levelStarted();
          });
      }
    },
  };
}

// ───────────────────────── Échelon suivant : amélioration ─────────────────────────

function perksView(ui: Ui, hooks: CampaignHooks): View {
  let picked: PerkId[] = [];
  const wanted = (): number => {
    const s = ui.game.state;
    return s.campaign ? Math.min(picksAllowed(s.campaign), perkOffer(s).length) : 0;
  };
  return {
    tab: 'company',
    title: () => (wanted() > 1 ? 'Tes améliorations' : 'Ton amélioration'),
    render() {
      const s = ui.game.state;
      const c = s.campaign;
      if (!c || !c.cleared || c.finished) return empty('Atteins d’abord deux des trois objectifs de l’échelon.');
      const offer = perkOffer(s);
      const want = wanted();
      picked = picked.filter((p) => offer.includes(p)).slice(0, want);
      const cards = offer
        .map((id) => {
          const P = PERKS[id];
          const on = picked.includes(id);
          const owned = perkCount(c, id);
          return `<button type="button" class="cg-perk${on ? ' on' : ''}" data-a="perk" data-id="${id}" aria-pressed="${on}">
            <span class="cg-perk-icon">${perkIcon(P.icon, 26)}</span>
            <span class="cg-perk-text"><b>${esc(P.title)}</b><small>${esc(P.text)}</small>${owned ? `<small>Déjà prise ${owned} fois : elle se cumule.</small>` : ''}</span>
            <span class="cg-perk-check">${icon('check', 16)}</span>
          </button>`;
        })
        .join('');
      const next = levelSpec(c.level + 1);
      return `
        <p class="g-lead">${
          want > 1
            ? `Les trois objectifs sont atteints : choisis <b>${want} améliorations</b>. Tu les gardes jusqu’à la fin de la campagne.`
            : 'Choisis <b>une amélioration</b>. Tu la gardes jusqu’à la fin de la campagne.'
        }</p>
        <div class="cg-perks">${cards}</div>
        ${want === 1 && goalsReached(c) < 3 ? '<p class="g-small">En atteignant aussi le troisième objectif avant de partir, tu en choisirais deux.</p>' : ''}
        <p class="g-small">Prochain échelon : « ${esc(next.name)} », avec ${money(nextCapital(s, picked))} de capital de départ.</p>
        ${btn(`<span>Choisir le pays</span>${icon('chevron', 18)}`, 'next', { disabled: picked.length !== want })}
      `;
    },
    action(a, el) {
      if (a === 'perk') {
        const id = el.dataset.id as PerkId;
        const want = wanted();
        if (picked.includes(id)) picked = picked.filter((p) => p !== id);
        else if (picked.length < want) picked = [...picked, id];
        else if (want === 1) picked = [id];
        else ui.toast(`Tu ne peux en choisir que ${want} : retire d’abord une amélioration.`, 'info');
        ui.refresh(true);
      } else if (a === 'next') {
        ui.push(countryView(ui, hooks, [...picked]));
      }
    },
  };
}

// ───────────────────────── Échelon suivant : pays ─────────────────────────

function countryView(ui: Ui, hooks: CampaignHooks, perks: PerkId[]): View {
  let search = '';
  return {
    tab: 'company',
    title: () => 'Nouveau pays',
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const c = s.campaign;
      if (!c || !c.cleared || c.finished) return empty('Atteins d’abord deux des trois objectifs de l’échelon.');
      const level = c.level + 1;
      const L = levelSpec(level);
      const lim = nextLimits(s, perks);
      const q = fold(search.trim());
      const all = eligibleCountries(d, level, playedCountries(ui.ctx)).sort((a, b) => b.pax - a.pax);
      const list = q ? all.filter((x) => fold(x.name).includes(q) || x.code.toLowerCase() === q) : all;
      const rows = list
        .slice(0, LIST_LIMIT)
        .map((x) =>
          row({
            action: 'country',
            id: x.code,
            icon: `<span class="g-flag">${flagEmoji(x.code)}</span>`,
            title: esc(x.name),
            sub: `${num(hubsFor(d, x.code, level).length)} hub(s) possibles · impôt ${num(d.corporateTax(x.code))} %`,
            right: `${compact(x.pax)} pass./an`,
          }),
        )
        .join('');
      return `
        <div class="cg-head">
          <span class="cg-head-level">${icon('stairs', 16)}Échelon ${level} sur ${LEVELS.length}</span>
          <h3>${esc(L.name)}</h3>
          <p>${esc(L.pitch)}</p>
        </div>
        ${kv([
          ['Capital de départ', `<b>${money(nextCapital(s, perks))}</b>`],
          ['Objectifs', `${L.airports} aéroports · ${L.satisfaction} % de satisfaction · ${money(L.profit)} de bénéfices`],
          ...(lim ? ([['Tu pourras avoir', `${lim.fleet} avions · ${lim.lines} lignes · ${lim.hubs} hub${lim.hubs > 1 ? 's' : ''}`]] as [string, string][]) : []),
        ])}
        <p class="g-lead" style="margin-top:12px">Dans quel pays poursuivre ? Tu y repars de zéro, avec ton capital, tes améliorations et ton meilleur pilote.</p>
        ${all.length > 10 ? `<input class="g-input" type="search" data-in="search" placeholder="Rechercher un pays…" value="${esc(search)}">` : ''}
        ${rows ? `<div class="g-list">${rows}</div>` : empty(all.length ? 'Aucun pays ne correspond.' : 'Aucun pays ne convient à cet échelon.')}
      `;
    },
    mounted() {
      // En revenant du choix du hub, l'aperçu de ses lignes disparaît.
      ui.network.setPreview(null);
    },
    input(el) {
      if (el.dataset.in !== 'search') return;
      search = el.value;
      const pos = (el as HTMLInputElement).selectionStart;
      ui.refresh(true);
      const again = document.querySelector<HTMLInputElement>('.g-body [data-in=search]');
      if (again) {
        again.focus();
        if (pos !== null) again.setSelectionRange(pos, pos);
      }
    },
    action(a, el) {
      if (a !== 'country') return;
      const code = el.dataset.id!;
      const level = ui.game.state.campaign!.level + 1;
      const top = hubsFor(ui.game.data, code, level)[0];
      if (top) ui.map.flyTo({ center: [top.lon, top.lat], zoom: 3.8, padding: mapPadding(), duration: 1500 });
      ui.push(hubView(ui, hooks, perks, code));
    },
  };
}

// ───────────────────────── Échelon suivant : hub ─────────────────────────

function hubView(ui: Ui, hooks: CampaignHooks, perks: PerkId[], country: string): View {
  let hub: string | null = null;
  let suggested = false;

  const select = (a: Airport): void => {
    hub = a.iata;
    const d = ui.game.data;
    const dests = d
      .routesFrom(a.iata)
      .slice()
      .sort((x, y) => y.demand - x.demand)
      .map((r) => d.airport(r.a === a.iata ? r.b : r.a))
      .filter((x) => x.country === a.country)
      .slice(0, 80);
    ui.network.setPreview({ focus: a, dests });
    ui.flyTo(a.iata, 4.6);
  };

  return {
    tab: 'company',
    title: () => `Hub de départ · ${countryName(ui, country)}`,
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const c = s.campaign;
      if (!c || !c.cleared || c.finished) return empty('Atteins d’abord deux des trois objectifs de l’échelon.');
      const level = c.level + 1;
      const capital = nextCapital(s, perks);
      const all = hubsFor(d, country, level);
      if (!suggested) {
        // Propose d'emblée le plus grand hub qui laisse de quoi acheter des avions.
        suggested = true;
        const best = all.find((a) => a.price <= capital * FIRST_HUB_BUDGET_SHARE) ?? all.find((a) => a.price <= capital);
        if (best) select(best);
      }
      const a = hub ? all.find((x) => x.iata === hub) : undefined;
      const details = a
        ? `<div class="g-card g-selected">
            <h3 class="g-h3">${esc(a.name)} <small>${a.iata}</small></h3>
            ${kv([
              ['Prix', `<b>${money(a.price)}</b>`],
              ['Il te restera', a.price <= capital ? money(capital - a.price) : `<span class="neg">il manque ${money(a.price - capital)}</span>`],
              ['Taille', `${TIER_LABEL[a.tier]} · ${compact(a.pax)} passagers par an`],
              ['Lignes intérieures possibles', num(domesticDests(d, a.iata).length)],
              ['Premier objectif', `relier ${levelGoals(d, level, a.iata).airports} aéroports du pays`],
            ])}
            ${a.price <= capital && capital - a.price < capital * 0.35 ? note('Il te resterait peu pour acheter des avions : un hub moins cher serait plus prudent.', 'warn') : ''}
            ${btn(withIcon('takeoff', `Partir à ${esc(a.city || a.name)}`), 'go', { disabled: a.price > capital })}
          </div>`
        : '';
      const rows = all
        .slice(0, LIST_LIMIT)
        .map((x) => {
          const tooExpensive = x.price > capital;
          return row({
            action: 'hub',
            id: x.iata,
            cls: `${x.iata === hub ? 'on' : ''}${tooExpensive ? ' dim' : ''}`,
            icon: `<span class="g-rank">${x.rankCountry}</span>`,
            title: `${esc(x.city || x.name)} <small>${x.iata}</small>`,
            sub: `${TIER_LABEL[x.tier]} · ${compact(x.pax)} pass./an · ${num(domesticDests(d, x.iata).length)} lignes intérieures`,
            right: `<span class="${tooExpensive ? 'neg' : ''}">${money(x.price)}</span>`,
          });
        })
        .join('');
      return `
        <p class="g-lead">Ton hub de départ en ${esc(countryName(ui, country))}. Capital : <b>${money(capital)}</b>.</p>
        ${details}
        <div class="g-list">${rows}</div>
      `;
    },
    action(a, el) {
      const d = ui.game.data;
      if (a === 'hub') {
        const airport = d.airportByIata.get(el.dataset.id!);
        if (airport) select(airport);
        ui.refresh(true);
        return;
      }
      if (a !== 'go' || !hub) return;
      const s = ui.game.state;
      const airport = d.airport(hub);
      const pilot = followingPilot(s.pilots);
      const choice = { country, hub, perks };
      void ui
        .confirm({
          title: `Partir à ${airport.city || airport.name} ?`,
          text: `Ta compagnie quitte ${esc(countryName(ui, s.company.country))} : ses avions et ses hubs sont revendus, et tu repars avec <b>${money(nextCapital(s, perks))}</b>, tes améliorations${
            pilot ? ` et ton meilleur pilote, ${esc(pilotName(pilot))}` : ''
          }. Ce départ est définitif.`,
          ok: 'Partir',
        })
        .then((yes) => {
          if (!yes) return;
          const res = ui.game.nextLevel(choice);
          if (!res.ok) {
            ui.toast(res.error, 'bad');
            return;
          }
          hooks.levelStarted();
        });
    },
  };
}
