import type { Map as MapLibreMap } from 'maplibre-gl';
import { SPEEDS, type GameClock, type Speed } from '../core/clock';
import { START_CENTER, globeZoom } from '../map/createMap';
import { icon } from './icons';

export interface HudHooks {
  /** Prévenir la carte d'un saut dans le temps (jour / nuit). */
  onTimeJump(): void;
  /** Bouton ☰ : ouvre le menu du jeu. */
  onMenu(): void;
}

/**
 * Barre du haut (pendant une partie) : menu, date et heure du jeu, vitesse du
 * temps, retour au globe.
 */
export function mountHud(root: HTMLElement, clock: GameClock, map: MapLibreMap, hooks: HudHooks): void {
  root.innerHTML = `
    <div class="hud-bar">
      <button class="hud-btn hud-menu" type="button" title="Menu" aria-label="Menu du jeu">${icon('menu', 20)}</button>
      <div class="hud-time" title="Heure du jeu">
        <span class="hud-clock"><span class="hud-hm"></span><span class="hud-sec"></span></span>
        <span class="hud-sub">
          <span class="hud-date"></span>
          <span class="hud-date-short"></span>
          <span class="hud-utc"></span>
        </span>
      </div>
      <div class="hud-speeds" role="group" aria-label="Vitesse du temps"><span class="hud-thumb" aria-hidden="true"></span></div>
      <div class="hud-tools">
        <button class="hud-btn hud-now" type="button" title="Rattraper l'heure réelle (le jeu est en retard)" aria-label="Rattraper l'heure réelle" hidden>${icon('now', 18)}<span>Maintenant</span></button>
        <button class="hud-btn hud-globe" type="button" title="Voir le globe entier" aria-label="Voir le globe entier">${icon('globe', 20)}</button>
      </div>
    </div>
  `;

  const speedsEl = root.querySelector<HTMLDivElement>('.hud-speeds')!;
  const buttons = new Map<Speed, HTMLButtonElement>();
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `hud-speed${s === 0 ? ' hud-pause' : ''}`;
    b.innerHTML = s === 0 ? icon('pause', 18) : s === 1 ? `${icon('play', 12)}<span>×1</span>` : `<span>×${s >= 1000 ? `${s / 1000}k` : s}</span>`;
    b.title = s === 0 ? 'Pause' : `Vitesse ×${s}`;
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', () => clock.setSpeed(s));
    speedsEl.appendChild(b);
    buttons.set(s, b);
  }

  root.querySelector('.hud-menu')!.addEventListener('click', () => hooks.onMenu());
  const nowBtn = root.querySelector<HTMLButtonElement>('.hud-now')!;
  nowBtn.addEventListener('click', () => {
    clock.resetToRealTime();
    hooks.onTimeJump();
  });
  root.querySelector('.hud-globe')!.addEventListener('click', () => {
    map.flyTo({ center: START_CENTER, zoom: globeZoom(), bearing: 0, pitch: 0, duration: 1800 });
  });

  const bar = root.querySelector<HTMLElement>('.hud-bar')!;
  const dateEl = root.querySelector<HTMLSpanElement>('.hud-date')!;
  const dateShortEl = root.querySelector<HTMLSpanElement>('.hud-date-short')!;
  const hmEl = root.querySelector<HTMLSpanElement>('.hud-hm')!;
  const secEl = root.querySelector<HTMLSpanElement>('.hud-sec')!;
  const utcEl = root.querySelector<HTMLSpanElement>('.hud-utc')!;
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const dateShortFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const utcFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  const thumb = speedsEl.querySelector<HTMLSpanElement>('.hud-thumb')!;
  const refreshSpeed = () => {
    for (const [s, b] of buttons) {
      b.classList.toggle('active', s === clock.speed);
      b.setAttribute('aria-pressed', String(s === clock.speed));
    }
    // Pastille qui glisse sous le bouton actif (rouge en pause, ambre sinon, cyan en très rapide).
    const on = buttons.get(clock.speed);
    if (on && on.offsetWidth) {
      thumb.style.transform = `translateX(${on.offsetLeft}px)`;
      thumb.style.width = `${on.offsetWidth}px`;
    }
    bar.classList.toggle('paused', clock.paused);
    bar.classList.toggle('fast', clock.speed >= 1000);
  };
  window.addEventListener('resize', refreshSpeed);
  // La barre est cachée hors partie : la pastille se replace dès qu'elle réapparaît.
  new ResizeObserver(refreshSpeed).observe(speedsEl);
  clock.onChange(refreshSpeed);
  refreshSpeed();

  // L'heure est relue à chaque image (elle peut filer en ×10 000), mais l'écran
  // n'est touché que si un texte change : une fois par seconde en temps réel.
  let shownMinute = Number.NaN;
  const render = () => {
    requestAnimationFrame(render);
    const now = clock.now();
    const d = new Date(now);
    const sec = String(d.getSeconds()).padStart(2, '0');
    if (secEl.textContent !== sec) secEl.textContent = sec;
    // « Maintenant » ne sert qu'à rattraper l'heure réelle : jamais à revenir en arrière.
    const behind = clock.behindRealTime;
    if (nowBtn.hidden === behind) nowBtn.hidden = !behind;
    const minute = Math.floor(now / 60_000);
    if (minute === shownMinute) return;
    shownMinute = minute;
    // Les deux-points d'une police à chasse fixe laissent un trou : on les resserre (voir .hud-hm i).
    const [hh, mm] = timeFmt.format(d).split(':');
    hmEl.innerHTML = `${hh}<i>:</i>${mm}`;
    utcEl.textContent = `${utcFmt.format(d)} UTC`;
    // « mer. 11 nov. 2026 » s'affiche en capitales : sans les points d'abréviation.
    const date = dateFmt.format(d).replace(/\./g, '');
    if (dateEl.textContent !== date) {
      dateEl.textContent = date;
      dateShortEl.textContent = dateShortFmt.format(d).replace(/\./g, '');
    }
  };
  render();
}
