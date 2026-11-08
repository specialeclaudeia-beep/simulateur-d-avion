import './style.css';
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

  mountHud(document.getElementById('hud')!, clock, map, () => dayNight.refresh());
  mountCountryCard(document.body, countries);
  mountFlightCard(document.body, aircraft, clock);
  mountTrafficToggle(document.body, aircraft);
  mountSoundToggle(document.body);
  mountFlightSounds(aircraft, clock);

  // Accès pratique depuis la console du navigateur pour tester.
  Object.assign(window, { map, clock, countries, aircraft, music });

  await mountGame({ map, clock, countries, aircraft, network, onTimeJump: () => dayNight.refresh() });
}

// Appli installable et jeu hors connexion, prêts avant même la carte.
setupPwa();
// Musique de fond : démarre au premier toucher de l'écran.
music.setup();
// Bruitages (avions et interface) : prêts au premier toucher, eux aussi.
setupAudioEngine();
mountUiSounds();

start().catch((err: unknown) => {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="fatal">Impossible de charger la carte.<br><small>${msg}</small><br>Vérifie ta connexion puis recharge la page.</div>`,
  );
});
