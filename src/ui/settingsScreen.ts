/**
 * Paramètres du jeu : son (musique, effets), graphismes (qualité, détail du
 * jeu, images par seconde) et touches du clavier. S'ouvrent depuis l'accueil
 * et depuis le menu du jeu ; ils valent pour toutes les parties sur cet
 * appareil (voir core/settings.ts et audio/music.ts).
 */
import { music } from '../audio/music';
import { currentFps, onFps } from '../core/frames';
import {
  DETAIL_LABEL,
  FPS_LIMITS,
  KEY_ACTIONS,
  QUALITY_LABEL,
  keyName,
  normalizeKey,
  settings,
  type FpsLimit,
  type KeyAction,
  type Quality,
} from '../core/settings';
import { icon, type IconName } from './icons';
import { pushLayer } from './layers';

export type SettingsTab = 'sound' | 'graphics' | 'keys';

const TABS: { id: SettingsTab; icon: IconName; label: string }[] = [
  { id: 'sound', icon: 'music', label: 'Son' },
  { id: 'graphics', icon: 'sparkles', label: 'Graphismes' },
  { id: 'keys', icon: 'keyboard', label: 'Touches' },
];

const QUALITIES: Quality[] = ['low', 'medium', 'high'];

const GRAPHICS_HINT: Record<Quality, string> = {
  low: 'Image moins nette, sans flous ni animations : pour un appareil modeste, ou pour économiser la batterie.',
  medium: 'Bonne netteté et effets légers : le bon réglage pour un téléphone.',
  high: 'Toute la netteté de l’écran et tous les effets : pour un ordinateur ou un téléphone récent.',
};

const DETAIL_HINT: Record<Quality, string> = {
  low: 'Moins d’avions du trafic réel à l’écran, lumières des villes simplifiées, moins de noms sur la carte.',
  medium: 'Davantage d’avions, lumières des villes détaillées quand on zoome.',
  high: 'Le plus d’avions, chacun avec sa traînée, lumières détaillées et tous les noms de la carte.',
};

/** Touches qui ne peuvent pas servir de raccourci à elles seules. */
const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Unidentified', 'Process', 'ContextMenu']);

let closeCurrent: (() => void) | null = null;

/** Les paramètres sont-ils en train d'attendre une touche (réglage d'un raccourci) ? */
export function capturingKey(): boolean {
  return document.querySelector('.set-key.listening') !== null;
}

export function settingsOpen(): boolean {
  return closeCurrent !== null;
}

/** Ouvre les paramètres par-dessus l'écran en cours. */
export function openSettings(first: SettingsTab = 'sound'): void {
  if (closeCurrent) return;
  let tab = first;
  let listening: KeyAction | null = null;

  const root = document.createElement('div');
  root.className = 'ov settings';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Paramètres');
  root.innerHTML = `
    <div class="ov-panel">
      <header class="ov-head">
        <button type="button" class="g-icon-btn ov-back" aria-label="Fermer les paramètres">${icon('back', 22)}</button>
        <h2>Paramètres</h2>
      </header>
      <div class="set-tabs" role="tablist">
        ${TABS.map((t) => `<button type="button" class="set-tab" role="tab" data-tab="${t.id}">${icon(t.icon, 18)}<span>${t.label}</span></button>`).join('')}
      </div>
      <div class="ov-body"></div>
    </div>
  `;
  const body = root.querySelector<HTMLElement>('.ov-body')!;

  // ── Contenu des onglets ──

  const seg = (name: string, options: [string, string][]): string =>
    `<div class="seg" role="group" data-seg="${name}">${options.map(([v, label]) => `<button type="button" data-v="${v}">${label}</button>`).join('')}</div>`;

  function soundHtml(): string {
    return `
      <section class="set-group">
        <h3>${icon('soundOn', 20)}Son du jeu</h3>
        <label class="g-toggle"><input type="checkbox" data-s="on"><span>Activer le son <small>(musique et effets)</small></span></label>
        <label class="g-volume"><span>Musique</span><input type="range" min="0" max="100" step="5" data-s="music" aria-label="Volume de la musique"></label>
        <label class="g-volume"><span>Effets sonores</span><input type="range" min="0" max="100" step="5" data-s="fx" aria-label="Volume des effets sonores"></label>
        <label class="g-toggle"><input type="checkbox" data-s="ui"><span>Sons des boutons et des messages</span></label>
      </section>
      <section class="set-group">
        <h3>${icon('music', 20)}Musique</h3>
        <div class="set-track"><span data-live="track"></span><button type="button" class="g-btn ghost small" data-s="next">${icon('skip', 16)}<span>Suivant</span></button></div>
        <p class="set-hint">Les effets sonores, ce sont les avions (touche un avion sur la carte pour l’entendre, du décollage à l’atterrissage), l’ambiance des aéroports et des hangars, et les bruits des boutons.</p>
      </section>
    `;
  }

  function graphicsHtml(): string {
    return `
      <section class="set-group">
        <h3>${icon('sparkles', 20)}Qualité des graphismes</h3>
        ${seg('graphics', QUALITIES.map((q) => [q, QUALITY_LABEL[q]]))}
        <p class="set-hint" data-live="graphics"></p>
      </section>
      <section class="set-group">
        <h3>${icon('layers', 20)}Détail du jeu</h3>
        ${seg('detail', QUALITIES.map((q) => [q, DETAIL_LABEL[q]]))}
        <p class="set-hint" data-live="detail"></p>
      </section>
      <section class="set-group">
        <h3>${icon('gauge', 20)}Images par seconde</h3>
        ${seg('fps', FPS_LIMITS.map((f) => [String(f), f === 0 ? 'Sans limite' : String(f)]))}
        <p class="set-hint">30 ménage la batterie. 120 et « sans limite » ne changent quelque chose que si l’écran affiche plus de 60 images par seconde.</p>
        <label class="g-toggle"><input type="checkbox" data-s="showFps"><span>Afficher le compteur d’images par seconde</span></label>
        <p class="set-live">En ce moment : <b data-live="fps">…</b> images par seconde</p>
      </section>
    `;
  }

  function keysHtml(): string {
    const groups: string[] = [];
    for (const a of KEY_ACTIONS) if (!groups.includes(a.group)) groups.push(a.group);
    return `
      <p class="set-hint">Pour jouer au clavier, sur ordinateur. Clique sur une touche, puis appuie sur celle que tu veux à la place. <b>Suppr</b> retire le raccourci, <b>Échap</b> annule.</p>
      ${groups
        .map(
          (g) => `<section class="set-group">
            <h3>${g}</h3>
            <ul class="set-keys">${KEY_ACTIONS.filter((a) => a.group === g)
              .map((a) => `<li><span>${a.label}</span><button type="button" class="set-key" data-key="${a.id}" aria-label="Touche pour « ${a.label} »"></button></li>`)
              .join('')}</ul>
          </section>`,
        )
        .join('')}
      <button type="button" class="g-btn ghost" data-s="resetKeys" style="margin-top:18px;width:100%">${icon('recycle', 18)}<span>Remettre les touches d’origine</span></button>
    `;
  }

  function build(): void {
    stopListening();
    for (const b of root.querySelectorAll<HTMLElement>('.set-tab')) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    body.innerHTML = tab === 'sound' ? soundHtml() : tab === 'graphics' ? graphicsHtml() : keysHtml();
    body.scrollTop = 0;
    sync();
  }

  // ── Mise à jour des commandes sans les reconstruire (un curseur qu'on tient ne doit pas sauter) ──

  function setChecked(name: string, on: boolean): void {
    const el = body.querySelector<HTMLInputElement>(`[data-s="${name}"]`);
    if (el && el.checked !== on) el.checked = on;
  }

  function setRange(name: string, value: number): void {
    const el = body.querySelector<HTMLInputElement>(`[data-s="${name}"]`);
    if (el && el !== document.activeElement && el.value !== String(value)) el.value = String(value);
  }

  function setSeg(name: string, value: string): void {
    for (const b of body.querySelectorAll<HTMLElement>(`[data-seg="${name}"] button`)) {
      const on = b.dataset.v === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  function setText(name: string, text: string): void {
    const el = body.querySelector<HTMLElement>(`[data-live="${name}"]`);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function showFps(fps: number): void {
    const el = body.querySelector<HTMLElement>('[data-live="fps"]');
    if (!el) return;
    const target = settings.get().fps || 60;
    el.textContent = fps > 0 ? String(fps) : '…';
    el.classList.toggle('warn', fps > 0 && fps < target * 0.8 && fps >= target * 0.5);
    el.classList.toggle('bad', fps > 0 && fps < target * 0.5);
  }

  function sync(): void {
    const s = settings.get();
    if (tab === 'sound') {
      setChecked('on', music.on);
      setRange('music', Math.round(music.volume * 100));
      setRange('fx', Math.round(music.fxVolume * 100));
      setChecked('ui', music.uiOn);
      const track = body.querySelector<HTMLElement>('[data-live="track"]');
      if (track) {
        const html = music.on ? `${music.playing ? 'En cours' : 'Prochain morceau'}<b></b>` : 'Son coupé<b></b>';
        if (track.dataset.state !== html + music.track.title) {
          track.dataset.state = html + music.track.title;
          track.innerHTML = html;
          track.querySelector('b')!.textContent = music.track.title;
        }
      }
    } else if (tab === 'graphics') {
      setSeg('graphics', s.graphics);
      setSeg('detail', s.detail);
      setSeg('fps', String(s.fps));
      setText('graphics', GRAPHICS_HINT[s.graphics]);
      setText('detail', DETAIL_HINT[s.detail]);
      setChecked('showFps', s.showFps);
      showFps(currentFps());
    } else {
      for (const b of body.querySelectorAll<HTMLElement>('.set-key')) {
        const id = b.dataset.key as KeyAction;
        const waiting = id === listening;
        b.classList.toggle('listening', waiting);
        b.classList.toggle('none', !waiting && !s.keys[id]);
        b.textContent = waiting ? 'Appuie sur une touche…' : keyName(s.keys[id]);
      }
    }
  }

  // ── Choix d'une touche ──

  function onCapture(e: KeyboardEvent): void {
    if (!listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (IGNORED_KEYS.has(e.key)) return;
    const action = listening;
    // Échap annule, sauf pour régler la touche « retour » elle-même.
    if (e.key === 'Escape' && action !== 'back') {
      stopListening();
      sync();
      return;
    }
    stopListening();
    settings.bindKey(action, e.key === 'Delete' || e.key === 'Backspace' ? '' : normalizeKey(e.key));
    sync();
  }

  function startListening(action: KeyAction): void {
    stopListening();
    listening = action;
    window.addEventListener('keydown', onCapture, true);
    sync();
  }

  function stopListening(): void {
    if (!listening) return;
    listening = null;
    window.removeEventListener('keydown', onCapture, true);
  }

  // ── Interactions ──

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === root || target.closest('.ov-back')) {
      close();
      return;
    }
    const tabBtn = target.closest<HTMLElement>('.set-tab');
    if (tabBtn) {
      tab = tabBtn.dataset.tab as SettingsTab;
      build();
      return;
    }
    const keyBtn = target.closest<HTMLElement>('.set-key');
    if (keyBtn) {
      const id = keyBtn.dataset.key as KeyAction;
      if (listening === id) stopListening();
      else startListening(id);
      sync();
      return;
    }
    // Un clic ailleurs annule le choix d'une touche en cours.
    if (listening) {
      stopListening();
      sync();
    }
    const segBtn = target.closest<HTMLElement>('.seg button');
    if (segBtn) {
      const name = segBtn.parentElement!.dataset.seg;
      const v = segBtn.dataset.v!;
      if (name === 'graphics') settings.set({ graphics: v as Quality });
      else if (name === 'detail') settings.set({ detail: v as Quality });
      else if (name === 'fps') settings.set({ fps: Number(v) as FpsLimit });
      return;
    }
    const action = target.closest<HTMLElement>('button[data-s]')?.dataset.s;
    if (action === 'next') music.next();
    else if (action === 'resetKeys') settings.resetKeys();
  });

  const onInput = (e: Event): void => {
    const el = e.target as HTMLInputElement;
    switch (el.dataset?.s) {
      case 'on':
        music.setOn(el.checked);
        break;
      case 'ui':
        music.setUiOn(el.checked);
        break;
      case 'music':
        music.setVolume(Number(el.value) / 100);
        break;
      case 'fx':
        music.setFxVolume(Number(el.value) / 100);
        break;
      case 'showFps':
        settings.set({ showFps: el.checked });
        break;
    }
  };
  root.addEventListener('input', onInput);

  // ── Ouverture et fermeture ──

  const offSettings = settings.onChange(() => sync());
  const offMusic = music.onChange(() => sync());
  const offFps = onFps((fps) => showFps(fps));
  const offLayer = pushLayer(() => close());
  const before = document.activeElement as HTMLElement | null;

  function close(): void {
    if (!closeCurrent) return;
    closeCurrent = null;
    stopListening();
    offSettings();
    offMusic();
    offFps();
    offLayer();
    root.remove();
    before?.focus?.({ preventScroll: true });
  }
  closeCurrent = close;

  document.body.appendChild(root);
  build();
  root.querySelector<HTMLElement>('.ov-back')!.focus({ preventScroll: true });
}

export function closeSettings(): void {
  closeCurrent?.();
}
