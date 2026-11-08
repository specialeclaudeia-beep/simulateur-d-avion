/**
 * Point d'entrée de l'interface du jeu : charge les données, reprend la partie
 * enregistrée (ou lance la création de compagnie), branche la carte (réseau du
 * joueur, ses avions sur le calque des avions) et les notifications.
 */
import './game.css';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { GameClock } from '../../core/clock';
import { loadGameData, type GameData } from '../../game/data';
import { playerFlights } from '../../game/flights';
import { Game, awayLabel, type AwaySummary } from '../../game/game';
import { clearStorage } from '../../game/save';
import type { LogEntry } from '../../game/state';
import type { AircraftLayer } from '../../map/aircraft';
import type { Countries } from '../../map/countries';
import type { NetworkData, NetworkLayer } from '../../map/networkLayer';
import { esc, money, num } from './dom';
import { Ui } from './ui';
import { companyView } from './views/company';
import { aircraftView, fleetBadge, fleetView } from './views/fleet';
import { financesBadge, financesView } from './views/finances';
import { hubView, hubsView } from './views/hubs';
import { lineView, linesBadge, linesView } from './views/lines';
import { pilotsBadge, pilotsView } from './views/pilots';
import { runWizard } from './wizard';

export interface GameDeps {
  map: MapLibreMap;
  clock: GameClock;
  countries: Countries;
  aircraft: AircraftLayer;
  network: NetworkLayer;
  /** Prévenir la carte d'un saut dans le temps (jour / nuit). */
  onTimeJump: () => void;
}

export async function mountGame(deps: GameDeps): Promise<Game | null> {
  const data = await loadWithRetry();
  const game = new Game(data, deps.clock, deps.onTimeJump);
  const ui = new Ui(game, deps);
  let bankruptShown = false;

  // ── Onglets ──
  ui.registerTab('company', () => companyView(ui, { newGame: restart, loaded: afterLoad }));
  ui.registerTab('hubs', () => hubsView(ui));
  ui.registerTab('fleet', () => fleetView(ui), () => fleetBadge(ui));
  ui.registerTab('pilots', () => pilotsView(ui), () => pilotsBadge(ui));
  ui.registerTab('lines', () => linesView(ui), () => linesBadge(ui));
  ui.registerTab('finances', () => financesView(ui), () => financesBadge(ui));

  // ── Carte ──
  deps.aircraft.addProvider(playerFlights);
  deps.aircraft.onSelect((f) => {
    if (!f?.player || !f.ref) return;
    // Sur téléphone le panneau cacherait la fiche du vol : on le ferme.
    if (window.innerWidth < 900) ui.close();
    const ref = f.ref;
    ui.toast(`${f.callsign} · ${f.from} → ${f.to}`, 'info', {
      label: 'Fiche de l’avion',
      run: () => {
        deps.aircraft.clearSelection();
        ui.openTab('fleet');
        ui.push(aircraftView(ui, ref));
      },
    });
  });
  deps.network.onHubClick((iata) => {
    if (!game.started) return;
    if (game.state.hubs.some((h) => h.iata === iata)) {
      ui.openTab('hubs');
      ui.push(hubView(ui, iata));
    }
  });
  deps.network.onLineClick((id) => {
    if (!game.started) return;
    ui.openTab('lines');
    ui.push(lineView(ui, id));
  });

  const updateNetwork = () => deps.network.setNetwork(game.started ? networkData(game) : null);
  game.onChange(() => {
    updateNetwork();
    checkBankruptcy();
  });
  window.setInterval(() => game.started && updateNetwork(), 2000);

  // ── Notifications ──
  game.onLog((entries) => notify(ui, game, entries));

  // ── Démarrage ──
  function play(): void {
    ui.start();
    updateNetwork();
    checkBankruptcy();
  }

  function startWizard(notice?: string): void {
    runWizard({
      data,
      map: deps.map,
      countries: deps.countries,
      network: deps.network,
      notice,
      onDone(params) {
        game.newGame(params);
        play();
        ui.openTab('hubs');
        ui.flyTo(params.hub, 5);
        ui.toast(`${params.name} est née ! Suis les premiers pas pour faire voler ton premier avion.`, 'good');
      },
    });
  }

  function restart(): void {
    clearStorage();
    game.quit();
    ui.stop();
    bankruptShown = false;
    updateNetwork();
    startWizard();
  }

  function afterLoad(): void {
    bankruptShown = false;
    ui.close();
    play();
    const hub = game.state.hubs[0];
    if (hub) ui.flyTo(hub.iata, 5);
  }

  function checkBankruptcy(): void {
    if (!game.started || !game.state.bankrupt || bankruptShown) return;
    bankruptShown = true;
    void ui
      .confirm({
        title: 'Faillite',
        text: 'La trésorerie est restée négative trop longtemps : la banque a fermé la compagnie. Tu peux consulter tes comptes ou recommencer.',
        ok: 'Nouvelle partie',
        cancel: 'Voir mes comptes',
        danger: true,
      })
      .then((again) => {
        if (again) restart();
        else ui.openTab('finances');
      });
  }

  const { result, summary } = game.resume();
  if (result.status === 'ok') {
    play();
    if (summary) showAway(ui, summary);
  } else {
    startWizard(
      result.status === 'broken'
        ? `Ta dernière sauvegarde n’a pas pu être lue (${result.error.replace(/\.$/, '')}). Elle a été mise de côté, pas effacée : tu peux commencer une nouvelle partie.`
        : undefined,
    );
  }

  // Accès pratique depuis la console du navigateur pour tester.
  Object.assign(window, { game });
  return game;
}

// ───────────────────────── Chargement ─────────────────────────

/** Charge les données du jeu ; en cas d'échec (réseau), propose de réessayer. */
async function loadWithRetry(): Promise<GameData> {
  const box = document.createElement('div');
  box.className = 'g-loading';
  box.textContent = 'Chargement des aéroports et des lignes…';
  document.body.appendChild(box);
  for (;;) {
    try {
      const data = await loadGameData();
      box.remove();
      return data;
    } catch (err) {
      console.error(err);
      box.innerHTML = `Impossible de charger les données du jeu. Vérifie ta connexion. <button type="button" class="g-btn small">Réessayer</button>`;
      await new Promise<void>((resolve) => box.querySelector('button')!.addEventListener('click', () => resolve(), { once: true }));
      box.textContent = 'Chargement des aéroports et des lignes…';
    }
  }
}

// ───────────────────────── Réseau sur la carte ─────────────────────────

function networkData(game: Game): NetworkData {
  const s = game.state;
  const d = game.data;
  const served = new Set(s.aircraft.flatMap((a) => (a.pilotId ? a.program : [])));
  const hubSet = new Set(s.hubs.map((h) => h.iata));
  const dests = new Set<string>();
  for (const l of s.lines) if (!hubSet.has(l.dest)) dests.add(l.dest);
  const place = (iata: string) => {
    const a = d.airport(iata);
    return { iata, lon: a.lon, lat: a.lat };
  };
  return {
    color: s.company.color,
    hubs: s.hubs.map((h) => place(h.iata)),
    dests: [...dests].map(place),
    lines: s.lines.map((l) => ({ id: l.id, from: place(l.hub), to: place(l.dest), served: served.has(l.id) })),
  };
}

// ───────────────────────── Notifications ─────────────────────────

/** Les événements importants du journal s'affichent en bandeau (pannes, livraisons, bilans). */
function notify(ui: Ui, game: Game, entries: LogEntry[]): void {
  for (const e of entries.slice(0, 3)) {
    if (e.kind === 'money' || e.kind === 'info') continue;
    const ref = e.ref;
    if (ref?.type === 'aircraft') {
      const ac = game.state.aircraft.find((a) => a.id === ref.id);
      const open = () => {
        ui.openTab('fleet');
        ui.push(aircraftView(ui, ref.id));
      };
      if (ac?.status === 'broken') ui.toast(e.text, 'bad', { label: 'Réparer', run: open });
      else ui.toast(e.text, e.kind, { label: 'Voir', run: open });
    } else {
      ui.toast(e.text, e.kind);
    }
  }
}

function showAway(ui: Ui, s: AwaySummary): void {
  const lines = [
    `<li>${num(s.flights)} vol(s) effectué(s)</li>`,
    `<li>Trésorerie : <b class="${s.cash < 0 ? 'neg' : 'pos'}">${s.cash >= 0 ? '+' : ''}${esc(money(s.cash))}</b></li>`,
  ];
  if (s.breakdowns) lines.push(`<li class="neg">${s.breakdowns} panne(s) : regarde ta flotte</li>`);
  void ui.alert(`Pendant ton absence (${awayLabel(s.gameMs)})`, `<ul class="g-away">${lines.join('')}</ul>`, 'Continuer');
}
