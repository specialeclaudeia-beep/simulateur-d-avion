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
        <span class="hud-date"></span>
        <span class="hud-date-short"></span>
        <span class="hud-clock"></span>
        <span class="hud-utc"></span>
      </div>
      <div class="hud-speeds" role="group" aria-label="Vitesse du temps"></div>
      <button class="hud-btn hud-now" type="button" title="Rattraper l'heure réelle (le jeu est en retard)" hidden>Maintenant</button>
      <button class="hud-btn hud-globe" type="button" title="Voir le globe entier" aria-label="Voir le globe entier">🌍</button>
    </div>
  `;

  const speedsEl = root.querySelector<HTMLDivElement>('.hud-speeds')!;
  const buttons = new Map<Speed, HTMLButtonElement>();
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hud-btn hud-speed';
    b.textContent = s === 0 ? '⏸' : `×${s >= 1000 ? `${s / 1000}k` : s}`;
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
  const clockEl = root.querySelector<HTMLSpanElement>('.hud-clock')!;
  const utcEl = root.querySelector<HTMLSpanElement>('.hud-utc')!;
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const dateShortFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const utcFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  const refreshSpeed = () => {
    for (const [s, b] of buttons) b.classList.toggle('active', s === clock.speed);
  };
  clock.onChange(refreshSpeed);
  refreshSpeed();

  const render = () => {
    const d = new Date(clock.now());
    dateEl.textContent = dateFmt.format(d);
    dateShortEl.textContent = dateShortFmt.format(d);
    // « Maintenant » ne sert qu'à rattraper l'heure réelle : jamais à revenir en arrière.
    const behind = clock.behindRealTime;
    if (nowBtn.hidden === behind) nowBtn.hidden = !behind;
    clockEl.textContent = timeFmt.format(d);
    utcEl.textContent = `${utcFmt.format(d)} UTC`;
    requestAnimationFrame(render);
  };
  render();
}
