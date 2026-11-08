/**
 * Sons de l'interface : touches, onglets, interrupteurs, curseurs, messages
 * (réussite, erreur, argent, panne), fenêtres de confirmation, vitesse du
 * temps. Et, tant que l'onglet Hubs est ouvert, l'ambiance d'un terminal
 * (annonces, scanners de cartes d'embarquement, portiques de sécurité).
 *
 * Tout passe par des écouteurs posés sur la page : aucun écran du jeu n'a
 * besoin de savoir que le son existe.
 */
import { LoopSet, audio, onAudioReady, playSound } from './engine';
import { music } from './music';

const UI_LEVEL = 0.5;
const HOVER_EVERY_MS = 90;
const DIAL_EVERY_MS = 60;

export function mountUiSounds(): void {
  let bus: GainNode | null = null;
  onAudioReady((ctx, master) => {
    bus = ctx.createGain();
    bus.gain.value = UI_LEVEL;
    bus.connect(master);
  });
  const ui = (name: string, volume = 1, delay = 0) => {
    if (bus && music.uiOn) playSound(name, volume, delay, bus);
  };

  // Touches
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('button, .g-row, label.g-btn');
      if (!el || (el as HTMLButtonElement).disabled) return;
      if (el.matches('.g-back')) ui('ui_back');
      else if (el.matches('.g-tab, .g-nav-company')) ui('ui_page_turn');
      else if (el.matches('.hud-speed')) ui('ui_progress', 0.7);
      else if (el.matches('.hud-now')) ui('ui_countdown_beep');
      else if (!el.matches('.sound-toggle')) ui('ui_click');
    },
    true,
  );

  // Survol à la souris (ordinateur seulement)
  let lastHover = 0;
  let hovered: Element | null = null;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as HTMLElement).closest('.g-btn, .g-row, .g-tab, .hud-btn');
    if (!el || el === hovered) return;
    hovered = el;
    const now = performance.now();
    if (now - lastHover < HOVER_EVERY_MS) return;
    lastHover = now;
    ui('ui_hover', 0.6);
  });

  // Cases à cocher, curseurs et listes
  let lastDial = 0;
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type !== 'range') return;
    const now = performance.now();
    if (now - lastDial < DIAL_EVERY_MS) return;
    lastDial = now;
    ui('ui_dial_tick', 0.8);
  });
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type === 'checkbox') ui(el.checked ? 'ui_toggle_on' : 'ui_toggle_off');
    else if (el.tagName === 'SELECT') ui('ui_dial_tick');
  });

  // Messages et fenêtres qui apparaissent
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.classList.contains('g-toast')) {
          const text = n.textContent ?? '';
          if (/est née/.test(text)) ui('ui_launch');
          else if (n.classList.contains('money')) ui('ui_coins');
          else if (n.classList.contains('good')) ui(/achet|commande|recrut|ouvert|livr/i.test(text) ? 'ui_coins' : 'ui_confirm');
          else if (n.classList.contains('bad')) ui(/panne/i.test(text) ? 'master_caution' : 'ui_error', 0.8);
          else ui('ui_notification', 0.7);
        } else if (n.classList.contains('g-modal-back')) ui('ui_alert_soft');
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Ambiance de terminal dans l'onglet Hubs
  const terminal = new LoopSet(() => bus!);
  let nextBlip = 0;
  setInterval(() => {
    if (!audio() || !bus) return;
    const inHubs = music.uiOn && document.body.classList.contains('sheet-open') && !!document.querySelector('.g-tab.active[data-tab="hubs"]');
    if (!inHubs) {
      if (terminal.size) terminal.set({});
      return;
    }
    if (!terminal.size) terminal.set({ terminal_ambience: 0.5 }, 1.5);
    const now = performance.now() / 1000;
    if (now > nextBlip) {
      if (nextBlip) {
        const r = Math.random();
        if (r < 0.35) ui('barcode_scan', 0.4);
        else if (r < 0.6) ui('boarding_pass_print', 0.6);
        else if (r < 0.8) ui('security_beep', 0.3);
        else ui('distant_chime', 0.6);
      }
      nextBlip = now + 6 + Math.random() * 10;
    }
  }, 500);
}
