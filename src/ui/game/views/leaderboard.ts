/**
 * Classement en ligne entre joueurs : la meilleure compagnie de chacun, par
 * valeur, passagers ou échelon. Rejoindre est un choix (pseudo et nom de la
 * compagnie deviennent visibles de tous les joueurs) ; on peut partir quand on
 * veut, ce qui efface ses lignes sur le serveur.
 */
import { leaderboard, type ScoreEntry, type ScoreSnapshot, type SortKey } from '../../../core/leaderboard';
import { profile } from '../../../core/profile';
import * as act from '../../../game/actions';
import { DAY } from '../../../game/config';
import { btn, compact, esc, flagEmoji, money, note, num, section } from '../dom';
import type { Ui, View } from '../ui';

/** Résumé de la partie en cours, tel qu'il part vers le classement. */
export function scoreSnapshot(ui: Ui): ScoreSnapshot {
  const s = ui.game.state;
  const p = profile.get();
  const now = ui.now;
  return {
    game_id: s.id,
    pseudo: p.name,
    pseudo_color: p.color,
    airline: s.company.name || 'Ma compagnie',
    airline_code: s.company.code,
    airline_color: /^#[0-9a-f]{6}$/i.test(s.company.color) ? s.company.color : '#ffb627',
    country: s.company.country,
    mode: s.mode,
    competition: s.competition,
    company_value: act.companyValue(ui.ctx, now),
    pax: s.stats.pax,
    flights: s.stats.flights,
    aircraft: s.aircraft.length,
    lines: s.lines.length,
    level: s.campaign ? s.campaign.level : 0,
    game_days: Math.max(0, Math.floor((now - s.startedAt) / DAY)),
    play_minutes: Math.floor(s.stats.playMs / 60_000),
  };
}

const SORTS: [SortKey, string][] = [
  ['company_value', 'Valeur'],
  ['pax', 'Passagers'],
  ['level', 'Échelons'],
];

function score(e: ScoreEntry, sort: SortKey): string {
  if (sort === 'pax') return `${compact(e.pax)} pass.`;
  if (sort === 'level') return e.mode === 'echelons' ? `Échelon ${num(e.level)}` : 'Partie libre';
  return money(e.company_value);
}

function entryRow(e: ScoreEntry, rank: number, sort: SortKey, mine: boolean): string {
  const medal = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `${rank}`;
  const mode = e.mode === 'echelons' ? `échelon ${num(e.level)}` : 'libre';
  return `<li class="g-lb-row${mine ? ' mine' : ''}">
    <span class="g-lb-rank">${medal}</span>
    <span class="g-lb-dot" style="background:${esc(e.airline_color)}"></span>
    <span class="g-lb-who"><b>${esc(e.airline)}</b>
      <small><span style="color:${esc(e.pseudo_color)}">●</span> ${esc(e.pseudo)}${mine ? ' (toi)' : ''} · ${e.country ? flagEmoji(e.country) : ''} ${num(e.aircraft)} avion${e.aircraft > 1 ? 's' : ''} · ${mode} · ${num(e.game_days)} j</small></span>
    <span class="g-lb-score">${score(e, sort)}</span>
  </li>`;
}

export function leaderboardView(ui: Ui): View {
  let sort: SortKey = 'company_value';
  let list: ScoreEntry[] | null = null;
  let error = false;
  let loading = false;
  let busy = false;

  const view: View = {
    tab: 'company',
    title: () => 'Classement en ligne',
    render() {
      const tabs = SORTS.map(([k, l]) => btn(l, `sort:${k}`, { cls: k === sort ? 'small' : 'small ghost' })).join('');
      let body: string;
      if (error) body = note('Pas de connexion au classement pour l’instant. Ta partie continue normalement, réessaie plus tard.', 'warn');
      else if (!list) body = '<p class="g-small">Chargement…</p>';
      else if (!list.length) body = '<p class="g-small">Personne n’est encore classé : sois le premier !</p>';
      else body = `<ol class="g-lb">${list.map((e, i) => entryRow(e, i + 1, sort, e.player_id === leaderboard.playerId)).join('')}</ol>`;
      const sent = leaderboard.lastSent ? new Date(leaderboard.lastSent).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
      const me = leaderboard.joined
        ? `<p class="g-small">Tu es dans le classement sous le pseudo <b>${esc(profile.get().name)}</b> (à changer dans Mon compte, à l’accueil). Ta compagnie est envoyée toutes les 5 minutes de jeu${sent ? `, la dernière fois à ${sent}` : ''}. Seule ta meilleure compagnie apparaît.</p>
           <div class="g-actions">${btn('Envoyer maintenant', 'send', { cls: 'ghost', disabled: busy })}${btn('Quitter le classement', 'leave', { cls: 'ghost danger', disabled: busy })}</div>`
        : `<p class="g-small">Compare ta compagnie à celles de tes amis. Ta partie reste sur ton appareil : seuls ton pseudo <b>${esc(profile.get().name)}</b>, le nom de ta compagnie et ses chiffres (valeur, passagers, avions, échelon) sont envoyés, et tous les joueurs les voient.</p>
           <div class="g-actions">${btn('Rejoindre le classement', 'join', { disabled: busy })}</div>`;
      return `${section('Ma place', me)}
        ${section('Les meilleurs joueurs', `<div class="g-actions g-lb-tabs">${tabs}${btn('↻', 'reload', { cls: 'small ghost', disabled: loading })}</div>${body}`)}`;
    },
    action(a) {
      if (a.startsWith('sort:')) {
        sort = a.slice(5) as SortKey;
        void load();
      } else if (a === 'reload') void load();
      else if (a === 'join') void run(async () => {
        const ok = await leaderboard.join(scoreSnapshot(ui));
        ui.toast(ok ? 'Bienvenue dans le classement !' : 'Inscrit : ta compagnie partira dès que le réseau revient.', ok ? 'good' : 'info');
      });
      else if (a === 'send') void run(async () => {
        leaderboard.offer(scoreSnapshot(ui), true);
        await new Promise((r) => setTimeout(r, 1500));
      });
      else if (a === 'leave') void run(async () => {
        const ok = await ui.confirm({ title: 'Quitter le classement ?', text: 'Tes compagnies seront effacées du classement en ligne. Ta partie, elle, ne change pas.', ok: 'Quitter', danger: true });
        if (!ok) return;
        const done = await leaderboard.leave();
        ui.toast(done ? 'Tu as quitté le classement.' : 'Pas de réseau : tes lignes n’ont pas pu être effacées, réessaie plus tard.', done ? 'info' : 'bad');
      });
    },
  };

  async function run(fn: () => Promise<void>): Promise<void> {
    busy = true;
    redraw();
    try {
      await fn();
    } finally {
      busy = false;
      await load();
    }
  }

  function redraw(): void {
    if (ui.top === view) ui.refresh(true);
  }

  async function load(): Promise<void> {
    loading = true;
    redraw();
    try {
      list = await leaderboard.top(sort);
      if (sort === 'level') list = list.filter((e) => e.mode === 'echelons');
      error = false;
    } catch {
      error = true;
    } finally {
      loading = false;
      redraw();
    }
  }

  void load();
  return view;
}
