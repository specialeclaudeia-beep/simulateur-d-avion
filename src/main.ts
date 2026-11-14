import './fonts.css';
import './style.css';
import { installFrameGovernor, onFps, setFpsLimit } from './core/frames';
import { settings } from './core/settings';
import { GameClock } from './core/clock';
import { createMap } from './map/createMap';
import { Countries } from './map/countries';
import { DayNight } from './map/dayNight';
import { mountCountryCard } from './ui/countryCard';
import { mountHud } from './ui/hud';
import { AircraftLayer } from './map/aircraft';
import { mountFlightCard } from './ui/flightCard';
import { mountTrafficToggle } from './ui/trafficToggle';
import { NetworkLayer } from './map/networkLayer';
import { mountGame } from './ui/game';
import { setupPwa } from './pwa';
import { music } from './audio/music';
import { mountSoundToggle } from './ui/soundToggle';
import { mountFlightSounds } from './audio/flightSounds';
import { setupAudioEngine } from './audio/engine';
import { mountUiSounds } from './audio/uiSounds';

async function start(): Promise<void> {
  const clock = new GameClock();
  const map = await createMap(document.getElementById('map')!);

  const dayNight = new DayNight(map, clock);
  await dayNight.install();

  // Les avions s'installent avant les pays : toucher un avion ne sélectionne pas le pays dessous.
  const aircraft = new AircraftLayer(map, clock);
  // Le réseau du joueur aussi : toucher un de ses hubs ou une de ses lignes ouvre sa fiche.
  const network = new NetworkLayer(map);

  const countries = new Countries(map);
  await countries.install();
  aircraft.onSelect((f) => f && countries.clearSelection());
  countries.onSelect((c) => c && aircraft.clearSelection());

  // Le menu du jeu n'existe qu'une fois les données chargées : le bouton ☰ passe par ce relais.
  let openMenu = (): void => {};
  mountHud(document.getElementById('hud')!, clock, map, { onTimeJump: () => dayNight.refresh(), onMenu: () => openMenu() });
  mountCountryCard(document.body, countries);
  mountFlightCard(document.body, aircraft, clock);
  mountTrafficToggle(document.body, aircraft);
  mountSoundToggle(document.body);
  mountFlightSounds(aircraft, clock);
  mountUiSounds(map, aircraft);

  // Accès pratique depuis la console du navigateur pour tester.
  Object.assign(window, { map, clock, countries, aircraft, music });

  const app = await mountGame({ map, clock, countries, aircraft, network, onTimeJump: () => dayNight.refresh() });
  openMenu = app.openMenu;
}

/** Qualité des graphismes : une classe sur la page (en « Économie », ni flou ni animation). */
function applyGraphics(): void {
  const q = settings.get().graphics;
  for (const level of ['low', 'medium', 'high']) document.body.classList.toggle(`gfx-${level}`, q === level);
}

/** Compteur d'images par seconde (à activer dans les paramètres). */
function mountFpsCounter(): void {
  const el = document.createElement('div');
  el.className = 'fps-counter';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = !settings.get().showFps;
  el.textContent = '… FPS';
  document.body.appendChild(el);
  onFps((fps) => {
    if (el.hidden) return;
    // Sans limite, on compare à 60 images par seconde.
    const target = settings.get().fps || 60;
    el.textContent = `${fps} FPS`;
    el.classList.toggle('warn', fps < target * 0.8 && fps >= target * 0.5);
    el.classList.toggle('bad', fps < target * 0.5);
  });
  settings.onChange((s, changed) => {
    if (changed.showFps !== undefined) el.hidden = !s.showFps;
  });
}

// Cadence des images (limite de FPS des paramètres) : en place avant la carte.
installFrameGovernor(settings.get().fps);
settings.onChange((s, changed) => {
  if (changed.fps !== undefined) setFpsLimit(s.fps);
  if (changed.graphics !== undefined) applyGraphics();
});
applyGraphics();
mountFpsCounter();

// Appli installable et jeu hors connexion, prêts avant même la carte.
setupPwa();
// Musique de fond : démarre au premier toucher de l'écran.
music.setup();
// Bruitages (avions et interface) : prêts au premier toucher, eux aussi.
setupAudioEngine();

start().catch((err: unknown) => {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="fatal">Impossible de charger la carte.<br><small>${msg}</small><br>Vérifie ta connexion puis recharge la page.</div>`,
  );
});
