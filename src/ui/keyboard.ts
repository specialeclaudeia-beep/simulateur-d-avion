/**
 * Le jeu au clavier (ordinateur). Chaque action a sa touche, réglable dans les
 * paramètres : temps (pause, plus vite, moins vite), carte (déplacer, zoomer,
 * globe, nord, trafic, suivre un avion), onglets, et la touche « retour » qui
 * ferme ce qui est ouvert puis ouvre le menu.
 *
 * Les touches ne font rien pendant qu'on écrit dans un champ, ni avec Ctrl,
 * Alt ou Cmd (raccourcis du navigateur).
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { music } from '../audio/music';
import { SPEEDS, type GameClock, type Speed } from '../core/clock';
import { normalizeKey, settings, type KeyAction } from '../core/settings';
import type { AircraftLayer } from '../map/aircraft';
import type { Countries } from '../map/countries';
import { START_CENTER, globeZoom } from '../map/createMap';
import type { Ui } from './game/ui';
import { closeTopLayer, layerOpen } from './layers';
import { capturingKey } from './settingsScreen';

export type Screen = 'home' | 'wizard' | 'game';

export interface KeyboardDeps {
  map: MapLibreMap;
  clock: GameClock;
  aircraft: AircraftLayer;
  countries: Countries;
  ui: Ui;
  /** Écran affiché. */
  screen(): Screen;
  /** Ouvre le menu du jeu. */
  openMenu(): void;
  /** Création de compagnie : étape précédente (ou abandon à la première). */
  wizardBack(): void;
}

/** Actions maintenues : elles agissent tant que la touche est enfoncée. */
const HELD: ReadonlySet<KeyAction> = new Set<KeyAction>(['panUp', 'panDown', 'panLeft', 'panRight', 'zoomIn', 'zoomOut']);
/** Actions de la carte, utiles aussi pendant la création de la compagnie. */
const MAP_ACTIONS: ReadonlySet<KeyAction> = new Set<KeyAction>([...HELD, 'globe', 'north']);
/** Actions qui marchent partout, même menu ouvert. */
const ANYWHERE: ReadonlySet<KeyAction> = new Set<KeyAction>(['back', 'mute', 'fullscreen']);

/** Vitesse de déplacement de la carte (pixels par seconde) et du zoom (niveaux par seconde). */
const PAN_PX_PER_S = 620;
const ZOOM_PER_S = 1.6;

export function mountKeyboard(deps: KeyboardDeps): void {
  const { map, clock, aircraft, countries, ui } = deps;

  // ── Touche → action ──
  let byKey = new Map<string, KeyAction>();
  const rebuild = (): void => {
    byKey = new Map();
    for (const [action, key] of Object.entries(settings.get().keys)) if (key) byKey.set(key, action as KeyAction);
  };
  rebuild();
  settings.onChange((_s, changed) => {
    if (changed.keys) rebuild();
  });

  const actionFor = (e: KeyboardEvent): KeyAction | undefined => {
    const key = normalizeKey(e.key);
    // « = » vaut « + » : sur beaucoup de claviers, le + demande la touche Maj.
    return byKey.get(key) ?? (key === '=' ? byKey.get('+') : undefined);
  };

  // ── Temps ──
  let speedBeforePause: Speed = 1;
  clock.onChange(() => {
    if (clock.speed > 0) speedBeforePause = clock.speed;
  });
  /** Passe par les boutons de la barre du haut : même effet, même son. */
  const setSpeed = (speed: Speed): void => {
    const b = document.querySelectorAll<HTMLButtonElement>('.hud-speed')[SPEEDS.indexOf(speed)];
    if (b) b.click();
    else clock.setSpeed(speed);
  };

  // ── Carte : déplacement et zoom tant que la touche est enfoncée ──
  const held = new Set<KeyAction>();
  let looping = false;
  let last = 0;
  const loop = (t: number): void => {
    if (!held.size) {
      looping = false;
      return;
    }
    requestAnimationFrame(loop);
    const dt = last ? Math.min(60, t - last) : 16;
    last = t;
    const dx = (held.has('panRight') ? 1 : 0) - (held.has('panLeft') ? 1 : 0);
    const dy = (held.has('panDown') ? 1 : 0) - (held.has('panUp') ? 1 : 0);
    const dz = (held.has('zoomIn') ? 1 : 0) - (held.has('zoomOut') ? 1 : 0);
    const step = (PAN_PX_PER_S * dt) / 1000;
    if (dx || dy) map.panBy([dx * step, dy * step], { duration: 0 });
    if (dz) map.setZoom(map.getZoom() + (dz * ZOOM_PER_S * dt) / 1000);
  };
  const hold = (action: KeyAction): void => {
    if (held.has(action)) return;
    // Déplacer la carte à la main arrête le suivi d'un avion.
    if (action.startsWith('pan') && aircraft.isFollowing) aircraft.follow(false);
    held.add(action);
    if (!looping) {
      looping = true;
      last = 0;
      requestAnimationFrame(loop);
    }
  };
  const release = (): void => held.clear();
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', release);

  // ── Actions ──

  /** Ferme ce qui est ouvert, du plus récent au plus ancien ; s'il n'y a rien, ouvre le menu. */
  const back = (): void => {
    if (closeTopLayer()) return;
    const screen = deps.screen();
    if (screen === 'wizard') {
      deps.wizardBack();
      return;
    }
    if (screen !== 'game') return;
    if (ui.sheetOpen) ui.back();
    else if (aircraft.selectedFlight()) aircraft.clearSelection();
    else if (countries.hasSelection) countries.clearSelection();
    else deps.openMenu();
  };

  const run = (action: KeyAction): void => {
    switch (action) {
      case 'pause':
        setSpeed(clock.paused ? speedBeforePause : 0);
        break;
      case 'faster':
        setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(clock.speed) + 1)]);
        break;
      case 'slower':
        // Jamais en dessous de ×1 : la pause a sa propre touche.
        if (clock.speed > 1) setSpeed(SPEEDS[SPEEDS.indexOf(clock.speed) - 1]);
        break;
      case 'globe':
        map.flyTo({ center: START_CENTER, zoom: globeZoom(), bearing: 0, pitch: 0, duration: 1800 });
        break;
      case 'north':
        map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
        break;
      case 'traffic':
        document.querySelector<HTMLElement>('.traffic-toggle')?.click();
        break;
      case 'follow':
        if (aircraft.selectedFlight()) aircraft.follow(!aircraft.isFollowing);
        break;
      case 'company':
      case 'hubs':
      case 'fleet':
      case 'pilots':
      case 'lines':
      case 'finances':
        document.querySelector<HTMLElement>(`.g-nav [data-tab="${action}"]`)?.click();
        break;
      case 'mute':
        music.setOn(!music.on);
        break;
      case 'fullscreen':
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void document.documentElement.requestFullscreen?.().catch(() => {});
        break;
      case 'back':
        back();
        break;
      default:
        break;
    }
  };

  // ── Écoute ──
  // En phase de capture : avant la fenêtre de confirmation (qui gère elle-même Échap et Entrée).
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || capturingKey()) return;
      if (document.querySelector('.g-modal-back')) return;
      const action = actionFor(e);
      if (!action) return;

      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        // Dans un champ, seule la touche « retour » agit : elle quitte le champ.
        if (action === 'back') target.blur();
        return;
      }
      // Un bouton choisi au clavier (Tab) garde Espace et Entrée pour lui.
      const focused = document.activeElement as HTMLElement | null;
      if ((e.key === ' ' || e.key === 'Enter') && focused && focused !== document.body && focused.matches('button, a, summary, [tabindex]') && focused.matches(':focus-visible')) {
        return;
      }

      const screen = deps.screen();
      const free = !layerOpen();
      const allowed = ANYWHERE.has(action) || (free && screen === 'game') || (free && screen === 'wizard' && MAP_ACTIONS.has(action));
      if (!allowed) return;
      e.preventDefault();
      if (HELD.has(action)) hold(action);
      else if (!e.repeat) run(action);
    },
    true,
  );

  window.addEventListener('keyup', (e) => {
    const action = actionFor(e);
    if (action) held.delete(action);
    // Maj relâchée avant la touche : la touche ne porte plus le même nom, on relâche tout.
    if (e.key === 'Shift') release();
  });
}
