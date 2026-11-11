import type { Map as MapLibreMap } from 'maplibre-gl';
import { SPEEDS, type GameClock, type Speed } from '../core/clock';
import { START_CENTER, globeZoom } from '../map/createMap';

/**
 * Barre du haut : date et heure du jeu, vitesse du temps, retour au globe.
 */
export function mountHud(root: HTMLElement, clock: GameClock, map: MapLibreMap, onTimeJump: () => void): void {
  root.innerHTML = `
    <div class="hud-bar">
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
        <button class="hud-btn hud-now" type="button" title="Rattraper l'heure réelle (le jeu est en retard)" hidden>⟳ Maintenant</button>
        <button class="hud-btn hud-globe" type="button" title="Voir le globe entier" aria-label="Voir le globe entier">🌍</button>
      </div>
    </div>
  `;

  const speedsEl = root.querySelector<HTMLDivElement>('.hud-speeds')!;
  const buttons = new Map<Speed, HTMLButtonElement>();
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `hud-speed${s === 0 ? ' hud-pause' : ''}`;
    b.innerHTML = s === 0 ? PAUSE_ICON : s === 1 ? `${PLAY_ICON}<span>×1</span>` : `<span>×${s >= 1000 ? `${s / 1000}k` : s}</span>`;
    b.title = s === 0 ? 'Pause' : `Vitesse ×${s}`;
    b.addEventListener('click', () => clock.setSpeed(s));
    speedsEl.appendChild(b);
    buttons.set(s, b);
  }

  const nowBtn = root.querySelector<HTMLButtonElement>('.hud-now')!;
  nowBtn.addEventListener('click', () => {
    clock.resetToRealTime();
    onTimeJump();
  });
  root.querySelector('.hud-globe')!.addEventListener('click', () => {
    map.flyTo({ center: START_CENTER, zoom: globeZoom(), bearing: 0, pitch: 0, duration: 1800 });
  });

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
    // Pastille qui glisse sous le bouton actif (orange en pause, bleue sinon).
    const on = buttons.get(clock.speed);
    if (on) {
      thumb.style.transform = `translateX(${on.offsetLeft}px)`;
      thumb.style.width = `${on.offsetWidth}px`;
    }
    root.querySelector('.hud-bar')!.classList.toggle('paused', clock.paused);
    root.querySelector('.hud-bar')!.classList.toggle('fast', clock.speed >= 1000);
  };
  window.addEventListener('resize', refreshSpeed);
  requestAnimationFrame(refreshSpeed);
  clock.onChange(refreshSpeed);
  refreshSpeed();

  // L'heure est relue à chaque image (elle peut filer en ×10 000), mais l'écran
  // n'est touché que si un texte change : une fois par seconde en temps réel.
  let shownMinute = Number.NaN;
  const render = () => {
    requestAnimationFrame(render);
    const now = clock.now();
    const d = new Date(now);
    const sec = `:${String(d.getSeconds()).padStart(2, '0')}`;
    if (secEl.textContent !== sec) secEl.textContent = sec;
    // « Maintenant » ne sert qu'à rattraper l'heure réelle : jamais à revenir en arrière.
    const behind = clock.behindRealTime;
    if (nowBtn.hidden === behind) nowBtn.hidden = !behind;
    const minute = Math.floor(now / 60_000);
    if (minute === shownMinute) return;
    shownMinute = minute;
    hmEl.textContent = timeFmt.format(d);
    utcEl.textContent = `${utcFmt.format(d)} UTC`;
    const date = dateFmt.format(d);
    if (dateEl.textContent !== date) {
      dateEl.textContent = date;
      dateShortEl.textContent = dateShortFmt.format(d);
    }
  };
  render();
}

const PAUSE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/></svg>';
const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor"/></svg>';
