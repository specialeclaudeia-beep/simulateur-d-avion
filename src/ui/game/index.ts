/**
 * Point d'entrée de l'interface du jeu. Charge les données, puis mène le
 * joueur d'un écran à l'autre :
 *
 *   accueil ⇄ création de la compagnie ⇄ partie
 *
 * L'accueil s'affiche à chaque lancement (compte, partie libre, mode par
 * échelons, paramètres). Une partie se quitte toujours enregistrée ; une
 * nouvelle ne remplace l'ancienne de son mode qu'au moment où la compagnie est
 * créée. Ce fichier branche aussi la carte (réseau du joueur, ses avions), les
 * notifications, le menu du jeu et le clavier.
 */
import './game.css';
import '../screens.css';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { GameClock } from '../../core/clock';
import { profile } from '../../core/profile';
import { keyName, settings } from '../../core/settings';
import { goalsReached, picksAllowed } from '../../game/campaign';
import { loadGameData, type GameData } from '../../game/data';
import { playerFlights } from '../../game/flights';
import { Game, awayLabel, type AwaySummary } from '../../game/game';
import { loadFromStorage, type SlotId } from '../../game/save';
import type { GameMode, LogEntry } from '../../game/state';
import type { AircraftLayer } from '../../map/aircraft';
import type { Countries } from '../../map/countries';
import type { NetworkData, NetworkLayer } from '../../map/networkLayer';
import { Home } from '../home';
import type { IconName } from '../icons';
import { mountKeyboard, type Screen } from '../keyboard';
import { closeMenu, menuOpen, openMenu, type MenuItem } from '../menu';
import { closeSettings, openSettings } from '../settingsScreen';
import { esc, money, plural } from './dom';
import { logoHtml } from './logo';
import { modeLabel } from './saves';
import { showCrash } from './views/stats';
import { Ui, sidePanel, type View } from './ui';
import { campaignView, levelIntro, type CampaignHooks } from './views/campaign';
import { companyView } from './views/company';
import { aircraftView, fleetBadge, fleetView } from './views/fleet';
import { financesBadge, financesView } from './views/finances';
import { hubView, hubsView } from './views/hubs';
import { lineView, linesBadge, linesView } from './views/lines';
import { pilotsBadge, pilotsView } from './views/pilots';
import { runWizard, type WizardHandle } from './wizard';

export interface GameDeps {
  map: MapLibreMap;
  clock: GameClock;
  countries: Countries;
  aircraft: AircraftLayer;
  network: NetworkLayer;
  /** Prévenir la carte d'un saut dans le temps (jour / nuit). */
  onTimeJump: () => void;
}

export interface GameApp {
  game: Game;
  /** Ouvre le menu du jeu (bouton ☰ de la barre du haut). */
  openMenu(): void;
}

/** Le temps de jeu du compte est compté par tranches de cette durée. */
const PLAY_TICK_MS = 10_000;

export async function mountGame(deps: GameDeps): Promise<GameApp> {
  const data = await loadWithRetry();
  const game = new Game(data, deps.clock, deps.onTimeJump);
  const ui = new Ui(game, deps);

  let screen: Screen = 'home';
  let wizard: WizardHandle | null = null;
  /** Fenêtres déjà montrées pour la partie en cours (faillite, échelon réussi, campagne terminée). */
  let bankruptShown = false;
  let clearedShown = false;
  let finishedShown = false;

  // ── Onglets ──
  ui.registerTab('company', () =>
    companyView(ui, {
      newGame: newGameSameMode,
      loaded: afterLoad,
      settings: () => openSettings(),
      home: showHome,
      goals: () => ui.push(campaignView(ui, campaignHooks)),
    }),
  );
  ui.registerTab('hubs', () => hubsView(ui));
  ui.registerTab('fleet', () => fleetView(ui), () => fleetBadge(ui));
  ui.registerTab('pilots', () => pilotsView(ui), () => pilotsBadge(ui));
  ui.registerTab('lines', () => linesView(ui), () => linesBadge(ui));
  ui.registerTab('finances', () => financesView(ui), () => financesBadge(ui));

  // ── Carte ──
  deps.aircraft.addProvider(playerFlights);
  // L'avion choisi sur la carte (le même vol est annoncé plusieurs fois : suivi, mise à jour…).
  let shownFlight: string | null = null;
  deps.aircraft.onSelect((f) => {
    const id = f?.id ?? null;
    if (id === shownFlight) return;
    shownFlight = id;
    if (!f) return;
    // Sur téléphone, le panneau cacherait la fiche de l'avion touché : on le ferme.
    if (ui.sheetOpen && window.innerWidth < 900) ui.close();
    if (!f.player || !f.ref) return;
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
  // Même chose pour la fiche d'un pays, quand le panneau occupe le bas de l'écran.
  deps.countries.onSelect((c) => {
    if (c && ui.sheetOpen && !sidePanel()) ui.close();
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

  const updateNetwork = (): void => deps.network.setNetwork(game.started ? networkData(game) : null);
  game.onChange(() => {
    updateNetwork();
    checkEvents();
  });
  window.setInterval(() => {
    if (!game.started) return;
    updateNetwork();
    checkEvents();
  }, 2000);

  // ── Notifications ──
  game.onLog((entries) => notify(ui, game, entries, openGoals));

  // ── Mode par échelons ──
  const campaignHooks: CampaignHooks = {
    levelStarted() {
      syncShown();
      ui.close();
      updateNetwork();
      const hub = game.state.hubs[0];
      if (hub) ui.flyTo(hub.iata, 5);
      showLevelIntro();
    },
  };

  let goalsView: View | null = null;
  function openGoals(): void {
    if (!game.started || !game.state.campaign) return;
    goalsView = campaignView(ui, campaignHooks);
    ui.open(goalsView);
  }
  // La pastille des objectifs ouvre l'écran des objectifs ; la toucher encore le referme.
  ui.setGoalAction(() => {
    if (ui.sheetOpen && goalsView && ui.top === goalsView) ui.close();
    else openGoals();
  });

  function showLevelIntro(): void {
    const intro = levelIntro(ui);
    if (intro) void ui.alert(intro.title, intro.html, 'C’est parti');
  }

  // ── D'un écran à l'autre ──

  /** Les fenêtres « déjà montrées » repartent de l'état de la partie (chargement, nouvel échelon). */
  function syncShown(cleared?: boolean, finished?: boolean): void {
    const c = game.started ? game.state.campaign : null;
    bankruptShown = false;
    clearedShown = cleared ?? !!c?.cleared;
    finishedShown = finished ?? !!c?.finished;
  }

  function play(): void {
    screen = 'game';
    ui.start();
    updateNetwork();
    checkEvents();
  }

  /** Quitte la partie en l'enregistrant ; l'heure du monde redevient l'heure réelle. */
  function leaveGame(): void {
    closeMenu();
    closeSettings();
    if (game.started) {
      game.saveNow();
      game.quit();
    }
    ui.stop();
    deps.aircraft.clearSelection();
    deps.countries.clearSelection();
    updateNetwork();
    deps.clock.setSpeed(1);
    deps.clock.setTime(Date.now());
    deps.onTimeJump();
  }

  function showHome(): void {
    leaveGame();
    wizard = null;
    screen = 'home';
    home.show();
  }

  /** Reprend la partie d'un emplacement. */
  function continueSlot(slot: SlotId): void {
    const result = loadFromStorage(slot);
    if (result.status !== 'ok') {
      if (result.status === 'broken') {
        void ui.alert(
          'Partie illisible',
          `<p>Cette sauvegarde n’a pas pu être lue (${esc(result.error.replace(/\.$/, ''))}). Elle a été mise de côté, pas effacée ; tu peux commencer une nouvelle partie.</p>`,
        );
      }
      home.refresh();
      return;
    }
    // Un échelon réussi pendant l'absence doit quand même être annoncé.
    const before = result.save.state.campaign;
    const wasCleared = !!before?.cleared;
    const wasFinished = !!before?.finished;
    const summary = game.loadSave(result.save);
    syncShown(wasCleared, wasFinished);
    home.hide();
    // Le résumé de l'absence d'abord ; les autres fenêtres (échelon réussi, faillite) attendent leur tour.
    if (summary) showAway(ui, summary);
    play();
    const hub = game.state.hubs[0];
    if (hub) ui.flyTo(hub.iata, 5);
  }

  /** Création d'une compagnie dans ce mode. La partie existante du mode n'est remplacée qu'à la fin. */
  function startWizard(mode: GameMode, competition: boolean): void {
    home.hide();
    screen = 'wizard';
    wizard = runWizard({
      data,
      map: deps.map,
      countries: deps.countries,
      network: deps.network,
      mode,
      competition,
      onCancel: showHome,
      onDone(params) {
        wizard = null;
        game.newGame(params);
        syncShown();
        play();
        ui.openTab('hubs');
        ui.flyTo(params.hub, 5);
        ui.toast(`${params.name} est née ! Suis les premiers pas pour faire voler ton premier avion.`, 'good');
        showLevelIntro();
      },
    });
  }

  /** « Nouvelle partie » depuis une partie : même mode de jeu. */
  function newGameSameMode(): void {
    const { mode, competition } = game.state;
    leaveGame();
    startWizard(mode, competition);
  }

  /** Une partie vient d'être importée à la place de la partie en cours. */
  function afterLoad(): void {
    syncShown();
    ui.close();
    play();
    const hub = game.state.hubs[0];
    if (hub) ui.flyTo(hub.iata, 5);
  }

  // ── Événements de la partie : faillite, échelon réussi, campagne terminée ──

  /** Une seule fenêtre à la fois : s'il y en a déjà une, on repassera (toutes les 2 secondes). */
  function checkEvents(): void {
    if (screen !== 'game' || !game.started || document.querySelector('.g-modal-back')) return;
    const s = game.state;
    const c = s.campaign;

    if (s.bankrupt && !bankruptShown) {
      bankruptShown = true;
      const retryLevel = !!c && !c.finished;
      void ui
        .confirm({
          title: 'Faillite',
          text: retryLevel
            ? 'La trésorerie est restée négative trop longtemps : la banque a fermé la compagnie. Tu peux recommencer cet échelon, dans le même pays et avec le même capital de départ ; tes améliorations restent.'
            : 'La trésorerie est restée négative trop longtemps : la banque a fermé la compagnie. Tu peux consulter tes comptes ou recommencer.',
          ok: retryLevel ? 'Recommencer l’échelon' : 'Nouvelle partie',
          cancel: 'Voir mes comptes',
          danger: true,
        })
        .then((again) => {
          if (!game.started) return;
          if (!again) ui.openTab('finances');
          else if (!retryLevel) newGameSameMode();
          else {
            const res = game.restartLevel();
            if (res.ok) campaignHooks.levelStarted();
            else ui.toast(res.error, 'bad');
          }
        });
      return;
    }

    if (!c) return;
    if (c.finished && !finishedShown) {
      finishedShown = true;
      clearedShown = true;
      void ui.alert(
        'Campagne terminée !',
        '<p>Tu as gravi les six échelons. Ta compagnie n’a plus aucune limite : hubs, avions, lignes, le monde entier lui est ouvert. Tu peux continuer à la développer aussi longtemps que tu veux.</p>',
        'Continuer',
      );
      return;
    }
    if (c.cleared && !c.finished && !clearedShown && !s.bankrupt) {
      clearedShown = true;
      const reached = goalsReached(c);
      void ui
        .confirm({
          title: `Échelon ${c.level} réussi !`,
          text: `Un nouveau pays t’attend, avec ${picksAllowed(c) > 1 ? 'deux améliorations' : 'une amélioration'} à choisir.${
            reached < 3 ? ' Tu peux aussi rester ici pour atteindre le troisième objectif : tu en choisiras alors deux.' : ''
          }`,
          ok: 'Voir la suite',
          cancel: 'Rester encore',
        })
        .then((go) => {
          if (go && game.started) openGoals();
        });
    }
  }

  // ── Menu du jeu ──

  function openGameMenu(): void {
    if (screen !== 'game' || !game.started || menuOpen()) return;
    const s = game.state;
    // Temps accéléré : le menu met le jeu en pause. En temps réel, le monde continue.
    const speed = deps.clock.speed;
    const pausedByMenu = speed > 1;
    if (pausedByMenu) deps.clock.setSpeed(0);

    const item = (icon: IconName, label: string, run: () => void, more: Partial<MenuItem> = {}): MenuItem => ({ icon, label, run, ...more });
    const items: MenuItem[] = [item('play', 'Reprendre', () => {}, { primary: true, sub: pausedByMenu ? `Le jeu est en pause (il reprendra à ×${speed})` : undefined })];
    if (s.campaign) {
      const c = s.campaign;
      items.push(
        item('stairs', c.finished ? 'Mon parcours' : 'Objectifs de l’échelon', openGoals, {
          sub: c.finished ? 'Campagne terminée' : `Échelon ${c.level} · ${plural(goalsReached(c), 'objectif atteint', 'objectifs atteints')} sur 3`,
        }),
      );
    }
    items.push(
      item('gear', 'Paramètres', () => openSettings(), { sub: 'Son, graphismes, touches du clavier', keepOpen: true }),
      item('home', 'Enregistrer et revenir à l’accueil', showHome, { sub: 'Ta partie t’attendra sur la page d’accueil' }),
    );

    const keys = settings.get().keys;
    const kbd = (key: string): string => `<kbd>${esc(keyName(key))}</kbd>`;
    openMenu({
      title: s.company.name,
      sub: modeLabel(s),
      logo: logoHtml(s.company.logo, s.company.code, 40),
      items,
      // Rappel des touches : seulement là où il y a un clavier.
      foot: window.matchMedia('(hover: hover) and (pointer: fine)').matches && keys.back && keys.pause ? `${kbd(keys.back)} ferme ce menu · ${kbd(keys.pause)} met le jeu en pause` : undefined,
      onClose() {
        if (pausedByMenu && game.started && deps.clock.paused) deps.clock.setSpeed(speed);
      },
    });
  }

  // ── Temps de jeu (compte du joueur) ──
  let lastPlayTick = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const dt = now - lastPlayTick;
    lastPlayTick = now;
    // Onglet caché ou appareil en veille : ce temps-là ne compte pas.
    if (screen === 'game' && game.started && !document.hidden && dt < 3 * PLAY_TICK_MS) profile.addPlay(dt);
  }, PLAY_TICK_MS);

  // ── Clavier ──
  mountKeyboard({
    map: deps.map,
    clock: deps.clock,
    aircraft: deps.aircraft,
    countries: deps.countries,
    ui,
    screen: () => screen,
    openMenu: openGameMenu,
    wizardBack: () => wizard?.back(),
  });

  // ── Démarrage : la page d'accueil ──
  const home = new Home(deps.map, ui, data, {
    resume: continueSlot,
    create: startWizard,
    settings: () => openSettings(),
  });
  home.show(true);

  // Accès pratique depuis la console du navigateur pour tester.
  Object.assign(window, { game, ui });
  return { game, openMenu: openGameMenu };
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
function notify(ui: Ui, game: Game, entries: LogEntry[], openGoals: () => void): void {
  for (const e of entries.slice(0, 3)) {
    if (e.kind === 'money' || e.kind === 'info') continue;
    // Échelon réussi, campagne terminée : une fenêtre l'annonce déjà (voir checkEvents).
    if (/^Échelon \d+ réussi/.test(e.text) || e.text.startsWith('Tu as gravi tous les échelons')) continue;
    const ref = e.ref;
    if (ref?.type === 'crash') {
      const c = game.state.crashes.find((x) => x.id === ref.id);
      if (!c) continue;
      showCrash(ui, c);
      ui.toast(e.text, 'bad', { label: 'Revoir', run: () => showCrash(ui, c) });
    } else if (ref?.type === 'aircraft') {
      const ac = game.state.aircraft.find((a) => a.id === ref.id);
      const open = () => {
        ui.openTab('fleet');
        ui.push(aircraftView(ui, ref.id));
      };
      if (ac?.status === 'broken') ui.toast(e.text, 'bad', { label: 'Réparer', run: open });
      else ui.toast(e.text, e.kind, { label: 'Voir', run: open });
    } else if (e.text.startsWith('Objectif atteint')) {
      ui.toast(e.text, e.kind, { label: 'Objectifs', run: openGoals });
    } else {
      ui.toast(e.text, e.kind);
    }
  }
}

function showAway(ui: Ui, s: AwaySummary): void {
  const lines = [
    `<li>${s.flights ? plural(s.flights, 'vol effectué', 'vols effectués') : 'Aucun vol effectué'}</li>`,
    `<li>Trésorerie : <b class="${s.cash < 0 ? 'neg' : 'pos'}">${s.cash >= 0 ? '+' : ''}${esc(money(s.cash))}</b></li>`,
  ];
  if (s.crashes) lines.push(`<li class="neg">${plural(s.crashes, 'accident')} : voir les statistiques</li>`);
  if (s.breakdowns) lines.push(`<li class="neg">${plural(s.breakdowns, 'panne')} : regarde ta flotte</li>`);
  void ui.alert('Pendant ton absence', `<p>Ton absence a duré ${esc(awayLabel(s.gameMs))}. Ta compagnie a continué de tourner :</p><ul class="g-away">${lines.join('')}</ul>`, 'Continuer');
}
