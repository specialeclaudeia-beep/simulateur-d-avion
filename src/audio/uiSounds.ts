/**
 * Sons de l'interface et ambiances des onglets.
 *
 * - Touches, onglets, panneaux, fenêtres, interrupteurs, curseurs, défilement,
 *   messages (réussite, argent, erreur, panne, actualité), contrats signés,
 *   vitesse du temps, carte (avion touché, déplacement, zoom, trafic).
 * - Ambiance selon l'onglet ouvert : aérogare dans Hubs, hangar dans Flotte,
 *   bureau dans Ma compagnie, Pilotes, Lignes et Finances.
 *
 * Tout passe par des écouteurs posés sur la page : aucun écran du jeu n'a
 * besoin de savoir que le son existe.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AircraftLayer } from '../map/aircraft';
import { LoopSet, audio, onAudioReady, playSound } from './engine';
import { music } from './music';

const UI_LEVEL = 0.5;
/** Ambiances des onglets, plus discrètes que les touches. */
const SCENE_LEVEL = 0.6;

type Cue = [string, number, number];

interface Scene {
  loops: Record<string, number>;
  /** Petits bruits tirés au hasard ; chaque groupe se joue d'un bloc. */
  random: Cue[][];
}

const COFFEE: Cue[] = [['coffee_grinder', 0, 0.5], ['coffee_pour', 3, 0.6], ['cup_set_down', 6, 0.7]];

const SCENES: Record<string, Scene> = {
  terminal: {
    loops: { terminal_ambience: 0.8, escalator_loop: 0.25, walkway_loop: 0.25 },
    random: [
      [['barcode_scan', 0, 0.4], ['boarding_pass_tear', 0.6, 0.6]], [['boarding_pass_print', 0, 0.6]], [['security_beep', 0, 0.3]],
      [['security_tray', 0, 0.6]], [['passport_stamp', 0, 0.7]], [['checkin_bell', 0, 0.5]], [['distant_chime', 0, 0.6]],
      [['elevator_ding', 0, 0.5]], [['sliding_door', 0, 0.6]], [['footsteps_tile', 0, 0.6]], [['water_fountain', 0, 0.5]],
      [['vending_machine', 0, 0.5]], [['trash_bin', 0, 0.5]], [['suitcase_roll', 0, 0.6], ['suitcase_drop', 4, 0.6]], COFFEE,
    ],
  },
  hangar: {
    loops: { apron_ambience: 0.6 },
    random: [
      [['gpu_connect', 0, 0.7]], [['towbar_connect', 0, 0.8]], [['chock_place', 0, 0.8]], [['air_start_cart', 0, 0.4]],
      [['hydraulic_pump', 0, 0.5]], [['cargo_door', 0, 0.6]], [['tug_horn', 0, 0.4]],
    ],
  },
  office: {
    loops: { office_ambience: 0.7 },
    random: [
      [['keyboard_typing', 0, 0.6]], [['dot_matrix_print', 0, 0.5]], [['fax_telex', 0, 0.5]], [['photocopier', 0, 0.5]],
      [['phone_ring', 0, 0.4], ['phone_pickup', 3, 0.6], ['phone_hangup', 9, 0.6]], COFFEE,
    ],
  },
};
const SCENE_OF_TAB: Record<string, string> = {
  hubs: 'terminal',
  fleet: 'hangar',
  company: 'office',
  pilots: 'office',
  lines: 'office',
  finances: 'office',
};

/** Message → son. Le premier motif qui correspond l'emporte. */
const TOAST_SOUNDS: [RegExp, string, Cue[]][] = [
  [/est née/, 'good', [['ui_swoosh_long', 0, 0.8], ['ui_launch', 0.3, 1], ['fanfare_success', 1.2, 0.8]]],
  [/contrat|commande/i, 'good', [['contract_stamp', 0, 0.9], ['ui_coins', 0.6, 0.8]]],
  [/livr|arriv/i, 'good', [['ui_timer_end', 0, 0.8]]],
  [/hub/i, 'good', [['ui_unlock', 0, 0.9], ['cash_register', 0.5, 0.6]]],
  [/achet|recrut|form/i, 'good', [['ui_coins', 0, 0.9]]],
  [/sauvegarde|code copié|fichier/i, 'good', [['ui_save', 0, 0.9]]],
  [/panne/i, 'bad', [['master_caution', 0, 0.8]]],
];

const THROTTLE_MS: Record<string, number> = { ui_hover: 90, ui_dial_tick: 60, ui_scroll_tick: 120, cash: 4000 };

export function mountUiSounds(map: MapLibreMap, aircraft: AircraftLayer): void {
  let bus: GainNode | null = null;
  let sceneBus: GainNode | null = null;
  onAudioReady((ctx, master) => {
    bus = ctx.createGain();
    bus.gain.value = UI_LEVEL;
    bus.connect(master);
    sceneBus = ctx.createGain();
    sceneBus.gain.value = SCENE_LEVEL;
    sceneBus.connect(master);
  });
  const ui = (name: string, volume = 1, delay = 0) => {
    if (bus && music.uiOn) playSound(name, volume, delay, bus);
  };
  const cues = (list: Cue[], dest: 'ui' | 'scene' = 'ui') => {
    for (const [n, d, v] of list) {
      if (dest === 'ui') ui(n, v, d);
      else if (sceneBus && music.uiOn) playSound(n, v, d, sceneBus);
    }
  };
  const last: Record<string, number> = {};
  const throttled = (key: string) => {
    const now = performance.now();
    if (now - (last[key] ?? 0) < (THROTTLE_MS[key] ?? 0)) return true;
    last[key] = now;
    return false;
  };

  // ── Touches ──
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('button, .g-row, label.g-btn');
      if (!el || (el as HTMLButtonElement).disabled) return;
      const a = el.dataset.a;
      if (el.matches('.g-back')) ui('ui_back');
      else if (el.matches('.g-tab, .g-nav-company')) ui('ui_tab_switch');
      else if (el.matches('.g-row')) ui('ui_page_turn');
      else if (el.matches('.hud-speed')) ui(el.matches('.hud-pause') ? 'clock_tick' : 'ui_progress', 0.8);
      else if (el.matches('.hud-now')) ui('ui_countdown_beep');
      else if (el.matches('.hud-globe')) ui('ui_zoom_out');
      else if (el.matches('.fc-follow')) ui('ui_zoom_in');
      else if (el.matches('.traffic-toggle')) ui(el.classList.contains('active') ? 'ui_toggle_off' : 'ui_radar_sweep');
      else if (a === 'sign') ui('pen_signature');
      else if (a === 'export') ui('camera_shutter');
      else if (a === 'new') ui('dice_roll');
      else if (!el.matches('.sound-toggle')) ui('ui_click');
    },
    true,
  );

  // Survol à la souris (ordinateur seulement)
  let hovered: Element | null = null;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as HTMLElement).closest('.g-btn, .g-row, .g-tab, .hud-btn');
    if (!el || el === hovered) return;
    hovered = el;
    if (!throttled('ui_hover')) ui('ui_hover', 0.6);
  });

  // Curseurs, cases à cocher, listes, défilement
  document.addEventListener('input', (e) => {
    if ((e.target as HTMLInputElement).type === 'range' && !throttled('ui_dial_tick')) ui('ui_dial_tick', 0.8);
  });
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type === 'checkbox') ui(el.checked ? 'ui_toggle_on' : 'ui_toggle_off');
    else if (el.type === 'range') ui('ui_drop', 0.7);
    else if (el.tagName === 'SELECT') ui('ui_dial_tick');
  });
  document.addEventListener(
    'scroll',
    (e) => {
      if ((e.target as HTMLElement).classList?.contains('g-body') && !throttled('ui_scroll_tick')) ui('ui_scroll_tick', 0.4);
    },
    true,
  );

  // ── Messages, fenêtres, pastilles ──
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        const el = r.target as HTMLElement;
        if (r.attributeName === 'class' && el === document.body) {
          const open = document.body.classList.contains('sheet-open');
          if (open !== sheetOpen) {
            sheetOpen = open;
            ui(open ? 'ui_panel_open' : 'ui_panel_close', 0.7);
          }
        } else if (r.attributeName === 'hidden' && el.classList.contains('g-dot') && !el.hidden) ui('ui_badge', 0.7);
        continue;
      }
      for (const n of r.removedNodes) {
        if (n instanceof HTMLElement && n.classList.contains('g-modal-back')) ui('ui_modal_close', 0.7);
      }
      for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.classList.contains('g-toast')) toastSound(n);
        else if (n.classList.contains('g-modal-back')) {
          const text = n.textContent ?? '';
          if (/Pendant ton absence/.test(text)) cues([['alarm_clock', 0, 0.6], ['ui_modal_open', 0.2, 0.8]]);
          else if (n.querySelector('.danger')) ui('ui_alert_soft');
          else ui('ui_modal_open', 0.8);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  let sheetOpen = document.body.classList.contains('sheet-open');

  function toastSound(n: HTMLElement): void {
    const text = n.textContent ?? '';
    const tone = ['good', 'bad', 'money', 'info'].find((t) => n.classList.contains(t)) ?? 'info';
    const rule = TOAST_SOUNDS.find(([re, t]) => t === tone && re.test(text));
    if (rule) cues(rule[2]);
    else if (tone === 'good') ui('ui_confirm');
    else if (tone === 'bad') ui('ui_error', 0.8);
    else if (tone === 'money') ui('cash_register', 0.8);
    else ui(text.length > 60 ? 'news_flash' : 'ui_notification', 0.7);
  }

  // Argent qui monte ou descend (affiché dans la barre du bas)
  let cash = NaN;
  setInterval(() => {
    const el = document.querySelector('.g-nav-cash');
    const v = Number((el?.textContent ?? '').replace(/[^\d-]/g, ''));
    if (!el || !Number.isFinite(v) || !v) return;
    if (Number.isFinite(cash) && v !== cash && Math.abs(v - cash) > Math.abs(cash) * 0.02 && !throttled('cash')) {
      ui(v > cash ? 'ui_cash_plus' : 'ui_cash_minus', 0.6);
    }
    cash = v;
  }, 1000);

  // ── Carte ──
  aircraft.onSelect((f) => {
    if (f && f.id !== lastSelected) ui('ui_map_ping', 0.7);
    lastSelected = f?.id ?? null;
  });
  let lastSelected: string | null = null;
  map.on('dragstart', () => ui('ui_drag_start', 0.4));
  map.on('dragend', () => ui('ui_drag_end', 0.4));

  // ── Ambiance de l'onglet ouvert ──
  const scene = new LoopSet(() => sceneBus!);
  let current: string | null = null;
  let nextBlip = 0;
  setInterval(() => {
    if (!audio() || !sceneBus) return;
    const tab = document.querySelector<HTMLElement>('.g-nav [data-tab].active')?.dataset.tab;
    const want = music.uiOn && document.body.classList.contains('sheet-open') && tab ? (SCENE_OF_TAB[tab] ?? null) : null;
    if (want !== current) {
      current = want;
      scene.set(want ? SCENES[want].loops : {}, 1.5);
      nextBlip = performance.now() / 1000 + 4 + Math.random() * 6;
    }
    if (!want) return;
    const now = performance.now() / 1000;
    if (now > nextBlip) {
      const pool = SCENES[want].random;
      cues(pool[Math.floor(Math.random() * pool.length)], 'scene');
      nextBlip = now + 6 + Math.random() * 10;
    }
  }, 500);
}
