/**
 * Statistiques de la partie : temps de jeu, début, argent encaissé et
 * dépensé, passagers, vols, heures de vol, avions achetés et accidents.
 * Tout vient de `state.stats`, enregistré avec la partie (et donc dans
 * l'export / import).
 */
import { icon, type IconName } from '../../icons';
import { badge, compact, dateLong, duration, esc, money, num, num1, plural, row, section, signedMoneyHtml, when } from '../dom';
import { PHASE_LABEL, crashRisk, oneIn } from '../../../game/safety';
import type { CrashRecord } from '../../../game/state';
import { playCrashScene } from '../crashScene';
import type { Ui, View } from '../ui';

/** Ferme la feuille et rejoue l'accident sur la carte. */
export function showCrash(ui: Ui, c: CrashRecord): void {
  ui.close();
  const co = ui.game.state.company;
  playCrashScene(ui.map, c, { color: co.color, code: co.code });
}

/** « 1 vol sur 4,2 millions ». */
export function oneInText(p: number): string {
  const n = oneIn(p);
  if (!Number.isFinite(n)) return 'aucun risque';
  if (n >= 1e6) return `1 vol sur ${num1(n / 1e6)} million${n >= 2e6 ? 's' : ''}`;
  return `1 vol sur ${num(n)}`;
}

/** Risque moyen par vol de la flotte actuelle (avions en service). */
function fleetRisk(ui: Ui): number | null {
  const s = ui.game.state;
  const list = s.aircraft.filter((a) => a.status !== 'delivery');
  if (!list.length) return null;
  let sum = 0;
  for (const ac of list) sum += crashRisk(ui.game.data, ac, s.pilots.find((p) => p.id === ac.pilotId) ?? null, ui.now, s.settings.crashFrequency).p;
  return sum / list.length;
}

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
    action(a, el) {
      if (a !== 'replay') return;
      const c = ui.game.state.crashes.find((x) => x.id === el.dataset.id);
      if (c) showCrash(ui, c);
    },
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
              sub: st.crashes ? 'détruits dans un accident' : 'aucun accident',
              tone: st.crashes ? 'bad' : 'good',
            },
          ]),
        )}
        ${section(
          'Sécurité',
          (() => {
            const r = fleetRisk(ui);
            const freq = s.settings.crashFrequency;
            const head =
              freq === 'aucun'
                ? '<p class="g-small">Les accidents sont désactivés dans les réglages de la partie.</p>'
                : `<p>Risque moyen de ta flotte : <b>${r === null ? '—' : esc(oneInText(r))}</b>${freq === 'frequent' ? ' ' + badge('× 100', 'warn') : ''}.</p>
                   <p class="g-small">Calculé pour chaque vol d’après les vraies statistiques (Boeing 2025 : 1 avion détruit pour 6 millions de vols d’A320, 1 pour 300 000 de MD-11), puis ajusté : pilote débutant × 2,2, avion mal entretenu jusqu’à × 67, plus de 25 ans, vol cargo × 3.</p>`;
            const list = [...s.crashes]
              .reverse()
              .map((c) =>
                row({
                  action: 'replay',
                  id: c.id,
                  icon: icon('alert', 22),
                  title: `${esc(c.registration)} · ${esc(ui.game.data.model(c.modelId).name)} · ${esc(PHASE_LABEL[c.phase])}`,
                  sub: `${esc(when(c.t, now))} · ${esc(c.from)}→${esc(c.to)} · ${c.fatalities ? `${plural(c.fatalities, 'victime')}` : 'aucune victime'}${c.injured ? `, ${plural(c.injured, 'blessé')}` : ''} sur ${num(c.pax + c.crew)} à bord`,
                  right: badge('Revoir', 'bad'),
                }),
              )
              .join('');
            return head + (list ? `<div class="g-list">${list}</div>` : '');
          })(),
        )}`;
    },
  };
}
