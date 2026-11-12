/**
 * Statistiques de la partie : temps de jeu, début, argent encaissé et
 * dépensé, passagers, vols, heures de vol, avions achetés et accidents.
 * Tout vient de `state.stats`, enregistré avec la partie (et donc dans
 * l'export / import).
 */
import { icon, type IconName } from '../../icons';
import { compact, dateLong, duration, esc, money, num, plural, section, signedMoneyHtml } from '../dom';
import type { Ui, View } from '../ui';

interface Tile {
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad' | 'accent' | 'info';
}

function tile(t: Tile): string {
  return `<div class="g-stat${t.tone ? ` ${t.tone}` : ''}">
    <span class="g-stat-icon">${icon(t.icon, 20)}</span>
    <span class="g-stat-label">${esc(t.label)}</span>
    <b class="g-stat-value">${t.value}</b>
    ${t.sub ? `<small>${t.sub}</small>` : ''}
  </div>`;
}

const grid = (tiles: Tile[]) => `<div class="g-stats">${tiles.map(tile).join('')}</div>`;

/** Temps de jeu réel : « 2 h 05 », « 45 min », « moins d'une minute ». */
export function playTime(ms: number): string {
  return ms < 60_000 ? 'moins d’une minute' : duration(ms);
}

export function statsView(ui: Ui): View {
  return {
    tab: 'company',
    live: true,
    title: () => 'Statistiques',
    render() {
      const s = ui.game.state;
      const st = s.stats;
      const now = ui.now;
      const gameDays = Math.max(0, Math.floor((now - s.startedAt) / 86_400_000));
      const balance = st.earned - st.spent;
      const avgPax = st.flights ? st.pax / st.flights : 0;
      return `
        ${section(
          'La partie',
          grid([
            { icon: 'clock', label: 'Temps de jeu', value: esc(playTime(st.playMs)), sub: 'temps réel passé dans le jeu', tone: 'accent' },
            {
              icon: 'flag',
              label: 'Début de la partie',
              value: esc(dateLong(s.startedAt)),
              sub: `${plural(gameDays, 'jour')} de jeu${st.startedReal ? ` · créée le ${esc(dateLong(st.startedReal))}` : ''}`,
            },
          ]),
        )}
        ${section(
          'Argent',
          grid([
            { icon: 'money', label: 'Argent encaissé', value: money(st.earned), sub: 'billets, fret et ventes', tone: 'good' },
            { icon: 'cart', label: 'Argent dépensé', value: money(st.spent), sub: 'achats, frais, salaires et impôts', tone: 'bad' },
          ]) + `<p class="g-small g-stat-balance">Solde : ${signedMoneyHtml(balance)} (hors emprunts)</p>`,
        )}
        ${section(
          'Vols',
          grid([
            { icon: 'users', label: 'Passagers desservis', value: num(st.pax), sub: st.flights ? `${num(avgPax)} par vol en moyenne` : undefined, tone: 'info' },
            { icon: 'takeoff', label: 'Vols effectués', value: num(st.flights), sub: `${compact(st.km)} km parcourus` },
            { icon: 'clock', label: 'Heures de vol', value: `${num(st.hours)} h`, sub: st.flights ? `${duration((st.hours / st.flights) * 3_600_000)} par vol` : undefined },
            ...(st.cargoT ? [{ icon: 'box' as IconName, label: 'Fret transporté', value: `${num(st.cargoT)} t` }] : []),
          ]),
        )}
        ${section(
          'Flotte',
          grid([
            { icon: 'plane', label: 'Avions achetés', value: num(st.bought), sub: `${plural(s.aircraft.length, 'avion')} dans la flotte aujourd’hui` },
            {
              icon: 'alert',
              label: 'Avions crashés',
              value: num(st.crashes),
              sub: st.crashes ? 'perdus faute d’entretien' : 'aucun accident',
              tone: st.crashes ? 'bad' : 'good',
            },
          ]) + '<p class="g-small">Un avion bien entretenu ne s’écrase pas : le risque n’apparaît que sous 20 % d’état.</p>',
        )}`;
    },
  };
}
