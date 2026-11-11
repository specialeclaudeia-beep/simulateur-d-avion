/**
 * Coque de l'interface du jeu : barre du bas (compagnie, trésorerie, onglets),
 * panneau des écrans (feuille en bas sur téléphone, colonne à droite sur
 * ordinateur) avec retour arrière, notifications et fenêtres de confirmation.
 *
 * Chaque écran (« vue ») produit son HTML ; les boutons portent un attribut
 * data-a (l'action) que la vue reçoit. L'écran affiché est redessiné quand la
 * partie change, et chaque seconde s'il montre des choses qui bougent.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { goalsReached } from '../../game/campaign';
import type { ActionResult, Ctx } from '../../game/context';
import type { Game } from '../../game/game';
import type { AircraftLayer } from '../../map/aircraft';
import type { NetworkLayer } from '../../map/networkLayer';
import { icon, type IconName } from '../icons';
import { esc, money, plural } from './dom';
import { logoHtml } from './logo';

// ───────────────────────── Types ─────────────────────────

export type TabId = 'company' | 'hubs' | 'fleet' | 'pilots' | 'lines' | 'finances';

export interface View {
  /** Onglet allumé dans la barre du bas. */
  tab: TabId;
  title(): string;
  render(): string;
  /** Redessiner chaque seconde (heures d'arrivée, avions en vol…). */
  live?: boolean;
  /** Bouton touché (attribut data-a). */
  action?(a: string, el: HTMLElement): void;
  /** Champ modifié (attribut data-in). */
  input?(el: HTMLInputElement | HTMLSelectElement, final: boolean): void;
  /** Après chaque dessin (ex. remettre le curseur dans un champ). */
  mounted?(body: HTMLElement): void;
}

export interface UiDeps {
  map: MapLibreMap;
  aircraft: AircraftLayer;
  network: NetworkLayer;
}

interface Toast {
  el: HTMLElement;
  timer: number;
}

const TABS: { id: Exclude<TabId, 'company'>; icon: IconName; label: string }[] = [
  { id: 'hubs', icon: 'hub', label: 'Hubs' },
  { id: 'fleet', icon: 'plane', label: 'Flotte' },
  { id: 'pilots', icon: 'pilot', label: 'Pilotes' },
  { id: 'lines', icon: 'route', label: 'Lignes' },
  { id: 'finances', icon: 'chart', label: 'Finances' },
];

// ───────────────────────── Interface ─────────────────────────

export class Ui {
  readonly map: MapLibreMap;
  readonly aircraft: AircraftLayer;
  readonly network: NetworkLayer;

  private stack: View[] = [];
  private tabs = new Map<TabId, () => View>();
  private badges = new Map<TabId, () => 'bad' | 'warn' | null>();
  private lastHtml = '';
  private refreshQueued = false;
  private expanded = false;
  private toasts: Toast[] = [];

  private nav: HTMLElement;
  private sheet: HTMLElement;
  private titleEl: HTMLElement;
  private body: HTMLElement;
  private toastBox: HTMLElement;
  private cashEl: HTMLElement;
  private logoEl: HTMLElement;
  private logoKey = '';
  private goalEl: HTMLButtonElement;
  private goalKey = '';
  private goalAction: () => void = () => {};

  constructor(
    readonly game: Game,
    deps: UiDeps,
  ) {
    this.map = deps.map;
    this.aircraft = deps.aircraft;
    this.network = deps.network;

    this.nav = document.createElement('nav');
    this.nav.className = 'g-nav';
    this.nav.hidden = true;
    this.nav.innerHTML = `
      <button type="button" class="g-nav-company" data-tab="company" aria-label="Ma compagnie">
        <span class="g-nav-logo"></span><span class="g-nav-cash"></span>
      </button>
      ${TABS.map((t) => `<button type="button" class="g-tab" data-tab="${t.id}"><span class="g-tab-icon">${icon(t.icon, 22)}</span><small>${t.label}</small><i class="g-dot" hidden></i></button>`).join('')}
    `;
    this.cashEl = this.nav.querySelector('.g-nav-cash')!;
    this.logoEl = this.nav.querySelector('.g-nav-logo')!;
    this.nav.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (b) this.toggleTab(b.dataset.tab as TabId);
    });

    this.sheet = document.createElement('aside');
    this.sheet.className = 'g-sheet';
    this.sheet.hidden = true;
    this.sheet.innerHTML = `
      <header class="g-sheet-head">
        <button type="button" class="g-icon-btn g-back" aria-label="Retour">${icon('back', 22)}</button>
        <h2 class="g-sheet-title"></h2>
        <button type="button" class="g-icon-btn g-expand" aria-label="Agrandir en plein écran">${icon('expand', 19)}</button>
        <button type="button" class="g-icon-btn g-close" aria-label="Fermer">${icon('close', 20)}</button>
      </header>
      <div class="g-body"></div>
    `;
    this.titleEl = this.sheet.querySelector('.g-sheet-title')!;
    this.body = this.sheet.querySelector('.g-body')!;
    this.sheet.querySelector('.g-back')!.addEventListener('click', () => this.back());
    this.sheet.querySelector('.g-close')!.addEventListener('click', () => this.close());
    this.sheet.querySelector('.g-expand')!.addEventListener('click', () => this.setExpanded(!this.expanded));
    this.titleEl.addEventListener('click', () => this.setExpanded(!this.expanded));

    this.body.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || !this.body.contains(el) || (el as HTMLButtonElement).disabled) return;
      this.top?.action?.(el.dataset.a!, el);
    });
    this.body.addEventListener('input', (e) => this.onInput(e, false));
    this.body.addEventListener('change', (e) => this.onInput(e, true));

    // Mode par échelons : rappel des objectifs, sous la barre du haut.
    this.goalEl = document.createElement('button');
    this.goalEl.type = 'button';
    this.goalEl.className = 'g-goal';
    this.goalEl.hidden = true;
    this.goalEl.addEventListener('click', () => this.goalAction());

    this.toastBox = document.createElement('div');
    this.toastBox.className = 'g-toasts';
    this.toastBox.setAttribute('role', 'status');
    this.toastBox.setAttribute('aria-live', 'polite');

    document.body.append(this.sheet, this.nav, this.goalEl, this.toastBox);

    game.onChange(() => this.queueRefresh());
    game.onTick(() => this.updateNav());
    window.setInterval(() => {
      if (this.top?.live && !this.sheet.hidden) this.refresh();
    }, 1000);
    trackHudHeight();
  }

  // ── Accès pratiques pour les vues ──

  get ctx(): Ctx {
    return this.game.context;
  }

  get now(): number {
    return Math.max(this.game.state.time, this.game.now());
  }

  get top(): View | undefined {
    return this.stack[this.stack.length - 1];
  }

  registerTab(id: TabId, root: () => View, badge?: () => 'bad' | 'warn' | null): void {
    this.tabs.set(id, root);
    if (badge) this.badges.set(id, badge);
  }

  // ── Démarrage et arrêt ──

  /** Affiche la barre du bas (la partie a commencé). */
  start(): void {
    document.body.classList.add('game-on');
    this.nav.hidden = false;
    this.logoKey = '';
    this.updateNav();
  }

  stop(): void {
    document.body.classList.remove('game-on', 'campaign-on');
    this.nav.hidden = true;
    this.goalEl.hidden = true;
    this.goalKey = '';
    this.close();
    this.clearToasts();
  }

  /** Ce que fait la pastille des objectifs quand on la touche. */
  setGoalAction(fn: () => void): void {
    this.goalAction = fn;
  }

  /** Un panneau est-il ouvert ? */
  get sheetOpen(): boolean {
    return !this.sheet.hidden;
  }

  /** Onglet affiché (ou null si le panneau est fermé). */
  get currentTab(): TabId | null {
    return this.sheet.hidden ? null : (this.top?.tab ?? null);
  }

  // ── Navigation ──

  /** Ouvre un onglet (son écran principal) ; le referme s'il est déjà affiché. */
  toggleTab(id: TabId): void {
    if (!this.sheet.hidden && this.stack.length === 1 && this.top?.tab === id) {
      this.close();
      return;
    }
    this.openTab(id);
  }

  openTab(id: TabId): void {
    const root = this.tabs.get(id);
    if (!root) return;
    this.stack = [root()];
    this.show();
  }

  /** Ouvre un écran seul (sans passer par un onglet). */
  open(view: View): void {
    this.stack = [view];
    this.show();
  }

  /** Ouvre un écran par-dessus l'écran actuel (le bouton ‹ y revient). */
  push(view: View): void {
    this.stack.push(view);
    this.show();
  }

  /** Remplace l'écran actuel (ex. après un achat, montrer le résultat). */
  replace(view: View): void {
    this.stack[this.stack.length - 1] = view;
    this.show();
  }

  back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.show();
    } else {
      this.close();
    }
  }

  close(): void {
    this.stack = [];
    this.sheet.hidden = true;
    this.lastHtml = '';
    document.body.classList.remove('sheet-open');
    this.network.setPreview(null);
    this.updateTabs();
  }

  private show(): void {
    this.sheet.hidden = false;
    document.body.classList.add('sheet-open');
    this.lastHtml = '';
    this.body.scrollTop = 0;
    this.refresh(true);
    this.updateTabs();
  }

  private setExpanded(on: boolean): void {
    this.expanded = on;
    this.sheet.classList.toggle('expanded', on);
    document.body.classList.toggle('sheet-expanded', on);
    const b = this.sheet.querySelector<HTMLButtonElement>('.g-expand')!;
    b.innerHTML = icon(on ? 'collapse' : 'expand', 19);
    b.setAttribute('aria-label', on ? 'Réduire' : 'Agrandir en plein écran');
  }

  // ── Dessin ──

  queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.refresh();
      this.updateNav();
    });
  }

  /** Redessine l'écran affiché (sauf si le joueur est en train d'écrire dans un champ). */
  refresh(force = false): void {
    const view = this.top;
    if (!view || this.sheet.hidden || !this.game.started) return;
    const active = document.activeElement;
    if (!force && active && this.body.contains(active) && active.matches('input[type=text], input[type=search], input[type=range], textarea')) return;
    const html = view.render();
    this.titleEl.textContent = view.title();
    this.sheet.querySelector<HTMLElement>('.g-back')!.style.visibility = this.stack.length > 1 ? 'visible' : 'hidden';
    if (html === this.lastHtml) return;
    const scroll = this.body.scrollTop;
    this.body.innerHTML = html;
    this.body.scrollTop = scroll;
    this.lastHtml = html;
    view.mounted?.(this.body);
  }

  private onInput(e: Event, final: boolean): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (!el.dataset?.in) return;
    this.top?.input?.(el, final);
  }

  private updateTabs(): void {
    const current = this.sheet.hidden ? null : this.top?.tab;
    for (const b of this.nav.querySelectorAll<HTMLElement>('[data-tab]')) {
      b.classList.toggle('active', b.dataset.tab === current);
    }
  }

  /** Trésorerie, logo et pastilles d'alerte de la barre du bas. */
  private updateNav(): void {
    if (!this.game.started || this.nav.hidden) return;
    const s = this.game.state;
    const cash = money(s.cash);
    if (this.cashEl.textContent !== cash) this.cashEl.textContent = cash;
    this.cashEl.classList.toggle('neg', s.cash < 0);
    const key = JSON.stringify(s.company.logo) + s.company.code;
    if (key !== this.logoKey) {
      this.logoKey = key;
      this.logoEl.innerHTML = logoHtml(s.company.logo, s.company.code, 26);
      this.nav.style.setProperty('--company', s.company.color);
    }
    for (const [id, fn] of this.badges) {
      const dot = this.nav.querySelector<HTMLElement>(`[data-tab="${id}"] .g-dot`);
      if (!dot) continue;
      const level = fn();
      dot.hidden = level === null;
      dot.className = `g-dot ${level ?? ''}`;
    }
    this.updateGoal();
  }

  /** Pastille « Échelon 2 ●●○ » : visible en mode par échelons, tant que la campagne n'est pas finie. */
  private updateGoal(): void {
    const c = this.game.state.campaign;
    const on = !!c && !c.finished;
    if (this.goalEl.hidden === on) {
      this.goalEl.hidden = !on;
      document.body.classList.toggle('campaign-on', on);
    }
    if (!c || !on) return;
    const key = `${c.level}:${c.reached.airports}:${c.reached.satisfaction}:${c.reached.profit}:${c.cleared}`;
    if (key === this.goalKey) return;
    this.goalKey = key;
    const dots = (['airports', 'satisfaction', 'profit'] as const).map((g) => `<i class="${c.reached[g] ? 'on' : ''}"></i>`).join('');
    this.goalEl.classList.toggle('cleared', c.cleared);
    this.goalEl.innerHTML = `${icon(c.cleared ? 'trophy' : 'stairs', 17)}<span>${c.cleared ? 'Échelon réussi' : `Échelon ${c.level}`}</span><span class="g-goal-dots">${dots}</span>${c.cleared ? icon('chevron', 15) : ''}`;
    this.goalEl.setAttribute('aria-label', `Échelon ${c.level} : ${plural(goalsReached(c), 'objectif atteint', 'objectifs atteints')} sur 3. Voir les objectifs.`);
  }

  // ── Actions du joueur ──

  /** Exécute une action de la partie ; affiche son message ou son erreur. */
  act<A extends unknown[]>(fn: (ctx: Ctx, t: number, ...args: A) => ActionResult, ...args: A): boolean {
    const res = this.game.run(fn, ...args);
    if (!res.ok) this.toast(res.error, 'bad');
    else if (res.message) this.toast(res.message, 'good');
    this.refresh(true);
    return res.ok;
  }

  // ── Notifications ──

  toast(text: string, tone: 'info' | 'good' | 'bad' | 'money' = 'info', action?: { label: string; run: () => void }): void {
    const el = document.createElement('div');
    el.className = `g-toast ${tone}`;
    el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="g-btn small">${esc(action.label)}</button>` : ''}`;
    const remove = () => {
      window.clearTimeout(t.timer);
      el.remove();
      this.toasts = this.toasts.filter((x) => x !== t);
    };
    el.addEventListener('click', (e) => {
      if (action && (e.target as HTMLElement).closest('button')) action.run();
      remove();
    });
    const t: Toast = { el, timer: window.setTimeout(remove, tone === 'bad' ? 7000 : 4500) };
    this.toasts.push(t);
    this.toastBox.appendChild(el);
    while (this.toasts.length > 3) {
      const old = this.toasts.shift()!;
      window.clearTimeout(old.timer);
      old.el.remove();
    }
  }

  private clearToasts(): void {
    for (const t of this.toasts) {
      window.clearTimeout(t.timer);
      t.el.remove();
    }
    this.toasts = [];
  }

  // ── Fenêtres ──

  /** Fenêtre de confirmation ; renvoie true si le joueur confirme. */
  confirm(opts: { title: string; text: string; ok: string; danger?: boolean; cancel?: string }): Promise<boolean> {
    return modal(
      `<h2>${esc(opts.title)}</h2><p>${opts.text}</p>
       <div class="g-modal-actions">
         <button type="button" class="g-btn ghost" data-r="0">${esc(opts.cancel ?? 'Annuler')}</button>
         <button type="button" class="g-btn ${opts.danger ? 'danger' : ''}" data-r="1">${esc(opts.ok)}</button>
       </div>`,
    ).then((r) => r === '1');
  }

  /**
   * Demande un texte (ex. renommer un avion, coller le code d'une partie) ; null si annulé.
   * `multiline` : grande zone de texte, sans limite de longueur.
   */
  prompt(opts: {
    title: string;
    value: string;
    placeholder?: string;
    maxLength?: number;
    multiline?: boolean;
    text?: string;
    ok?: string;
  }): Promise<string | null> {
    let value = opts.value;
    const placeholder = `placeholder="${esc(opts.placeholder ?? '')}"`;
    const field = opts.multiline
      ? `<textarea class="g-input g-paste" rows="5" ${placeholder}>${esc(opts.value)}</textarea>`
      : `<input class="g-input" type="text" value="${esc(opts.value)}" ${placeholder} maxlength="${opts.maxLength ?? 30}">`;
    return modal(
      `<h2>${esc(opts.title)}</h2>
       ${opts.text ? `<p>${opts.text}</p>` : ''}
       ${field}
       <div class="g-modal-actions">
         <button type="button" class="g-btn ghost" data-r="0">Annuler</button>
         <button type="button" class="g-btn" data-r="1">${esc(opts.ok ?? 'Valider')}</button>
       </div>`,
      (box) => {
        const input = box.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
        input.addEventListener('input', () => (value = input.value));
        input.focus();
        input.select();
      },
    ).then((r) => (r === '1' ? value : null));
  }

  /** Message simple avec un bouton. */
  alert(title: string, html: string, ok = 'Compris'): Promise<void> {
    return modal(
      `<h2>${esc(title)}</h2>${html}<div class="g-modal-actions"><button type="button" class="g-btn" data-r="1">${esc(ok)}</button></div>`,
    ).then(() => undefined);
  }

  // ── Carte ──

  /** Centre la carte sur un aéroport (en laissant la place au panneau). */
  flyTo(iata: string, zoom = 6.5): void {
    const a = this.game.data.airportByIata.get(iata);
    if (!a) return;
    this.map.flyTo({ center: [a.lon, a.lat], zoom, padding: mapPadding(), duration: 1600, essential: true });
  }

  /** Cadre la carte sur un ensemble d'aéroports. */
  fitAirports(codes: string[]): void {
    const pts = codes.map((c) => this.game.data.airportByIata.get(c)).filter((a) => a !== undefined);
    if (pts.length < 2) {
      if (pts[0]) this.flyTo(pts[0].iata);
      return;
    }
    // Longitudes « déroulées » autour du premier point (lignes qui traversent l'antiméridien).
    const lon0 = pts[0].lon;
    let w = Infinity;
    let e = -Infinity;
    let s = Infinity;
    let n = -Infinity;
    for (const a of pts) {
      let lon = a.lon;
      while (lon - lon0 > 180) lon -= 360;
      while (lon - lon0 < -180) lon += 360;
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, a.lat);
      n = Math.max(n, a.lat);
    }
    // MapLibre ajoute les marges déjà posées sur la carte à celles demandées ici
    // (et, sur le globe, ignore les marges « absolues ») : on remet d'abord les
    // marges de la carte à zéro, sans bouger l'image, puis on cadre.
    const canvas = this.map.getCanvas();
    const middle = this.map.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]);
    this.map.jumpTo({ center: middle, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: mapPadding(60), maxZoom: 7, duration: 1600 },
    );
  }
}

// ───────────────────────── Fenêtre modale ─────────────────────────

/** Ouvre une fenêtre ; se résout avec la valeur data-r du bouton touché ('0' si fermée). */
function modal(html: string, setup?: (box: HTMLElement) => void): Promise<string> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'g-modal-back';
    back.innerHTML = `<div class="g-modal" role="dialog" aria-modal="true">${html}</div>`;
    const box = back.firstElementChild as HTMLElement;
    const done = (r: string) => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      resolve(r);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done('0');
      if (e.key === 'Enter' && box.querySelector('input')) done('1');
    };
    back.addEventListener('click', (e) => {
      if (e.target === back) return done('0');
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
      if (b) done(b.dataset.r!);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    setup?.(box);
  });
}

// ───────────────────────── Mise en page ─────────────────────────

/**
 * Marges à laisser libres sur la carte : la barre du temps en haut, et le
 * panneau ouvert (en bas sur téléphone, à droite sur ordinateur), mesuré tel
 * qu'il est affiché.
 */
export function mapPadding(base = 40): { top: number; bottom: number; left: number; right: number } {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const hud = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-h')) || 60;
  const sheet = document.querySelector<HTMLElement>('.g-sheet:not([hidden])')?.getBoundingClientRect();
  if (W >= 900) return { top: hud + base, bottom: 90 + base, left: base, right: (sheet ? W - sheet.left : 0) + base };
  // Toujours au moins 140 px de carte visible, même panneau agrandi.
  const bottom = Math.min(sheet ? H - sheet.top : 80, H - hud - 140);
  return { top: hud + base / 2, bottom: bottom + base / 2, left: base / 2, right: base / 2 };
}

/** La hauteur de la barre du temps change (retour à la ligne sur petit écran) : on la mesure. */
function trackHudHeight(): void {
  const hud = document.getElementById('hud');
  if (!hud) return;
  const set = () => document.documentElement.style.setProperty('--hud-h', `${Math.ceil(hud.getBoundingClientRect().bottom)}px`);
  new ResizeObserver(set).observe(hud);
  window.addEventListener('resize', set);
  set();
}
