/**
 * Page d'accueil : le globe qui tourne en fond, le compte du joueur en haut à
 * droite, et trois boutons au milieu : partie libre (avec le choix « sans
 * concurrence » ou « avec concurrence »), mode par échelons, paramètres.
 *
 * Le compte est un profil gardé sur l'appareil (pseudo, couleur, emblème,
 * chiffres de carrière, trophées du mode par échelons) ; c'est aussi là qu'on
 * gère ses parties enregistrées (exporter, importer, supprimer).
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { PROFILE_COLORS, PROFILE_EMBLEMS, inkOn, profile, rankTitle, type Profile } from '../core/profile';
import { LEVELS, levelSpec } from '../game/campaign';
import type { GameData } from '../game/data';
import {
  SLOTS,
  SLOT_LABEL,
  clearStorage,
  exportFileName,
  lastSlot,
  loadFromStorage,
  saveToStorage,
  serialize,
  slotSummaries,
  slotSummary,
  type SlotId,
  type SlotSummary,
} from '../game/save';
import type { GameMode } from '../game/state';
import { setLabels } from '../map/baseStyle';
import { globeZoom } from '../map/createMap';
import { canInstall, install, isInstalled } from '../pwa';
import { compact, esc, flagEmoji, money, num } from './game/dom';
import { logoHtml } from './game/logo';
import { copyText, downloadText, readImport } from './game/saves';
import type { Ui } from './game/ui';
import { hasIcon, icon, type IconName } from './icons';
import { pushLayer } from './layers';

export interface HomeHooks {
  /** Reprendre la partie d'un emplacement. */
  resume(slot: SlotId): void;
  /** Créer une compagnie dans ce mode (l'éventuelle partie du mode est remplacée à la création). */
  create(mode: GameMode, competition: boolean): void;
  /** Ouvrir les paramètres. */
  settings(): void;
}

type Page = 'main' | 'libre' | 'echelons' | 'compte';

/** Le globe fait un tour en trois minutes. */
const SPIN_DEG_PER_S = 2;
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

// ───────────────────────── Petits outils d'affichage ─────────────────────────

function avatarHtml(p: Profile, large = false): string {
  const inner = p.emblem && hasIcon(p.emblem) ? icon(p.emblem as IconName, large ? 38 : 20) : esc((p.name.trim().charAt(0) || 'P').toUpperCase());
  return `<span class="avatar${large ? ' l' : ''}" style="--av:${esc(p.color)};--av-ink:${inkOn(p.color)}">${inner}</span>`;
}

/** « à l'instant », « il y a 12 min », « hier », « il y a 4 jours »… */
function ago(t: number): string {
  const min = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'hier';
  if (d < 60) return `il y a ${d} jours`;
  return `le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t))}`;
}

/** Temps de jeu : « moins d'une minute », « 45 min », « 3 h 20 ». */
function playTime(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n > 1 ? many : one}`;
}

function slotOfMode(mode: GameMode, competition: boolean): SlotId {
  return mode === 'echelons' ? 'echelons' : competition ? 'concurrence' : 'solo';
}

// ───────────────────────── Page d'accueil ─────────────────────────

export class Home {
  private root: HTMLElement;
  private page: Page = 'main';
  private offLayer: (() => void) | null = null;
  private spinning = false;
  private lastSpin = 0;
  /** Le globe ne tourne pas avant la fin de son recadrage. */
  private spinAfter = 0;

  constructor(
    private map: MapLibreMap,
    private ui: Ui,
    private data: GameData,
    private hooks: HomeHooks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'home';
    this.root.hidden = true;
    document.body.appendChild(this.root);

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onChange(e));
    profile.onChange(() => {
      if (this.visible && !this.typingName()) this.render();
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** Affiche l'accueil (le globe se recadre et se met à tourner). */
  show(): void {
    this.root.hidden = false;
    document.body.classList.add('home-on');
    this.setPage('main');
    // Un globe nu derrière le menu : les noms de la carte reviennent avec la partie.
    setLabels(this.map, false);
    this.map.stop();
    this.map.easeTo({ center: [this.map.getCenter().lng, 22], zoom: globeZoom() + 0.32, bearing: 0, pitch: 0, padding: NO_PADDING, duration: 1400 });
    this.spinAfter = performance.now() + 1500;
    this.startSpin();
  }

  hide(): void {
    if (!this.visible) return;
    this.setPage('main');
    this.root.hidden = true;
    document.body.classList.remove('home-on');
    this.spinning = false;
    setLabels(this.map, true);
  }

  /** Redessine la page affichée (ex. après un import). */
  refresh(): void {
    if (this.visible) this.render();
  }

  // ── Globe ──

  private startSpin(): void {
    if (this.spinning) return;
    this.spinning = true;
    this.lastSpin = 0;
    requestAnimationFrame(this.spin);
  }

  private spin = (t: number): void => {
    if (!this.spinning) return;
    requestAnimationFrame(this.spin);
    const dt = this.lastSpin ? Math.min(100, t - this.lastSpin) : 0;
    this.lastSpin = t;
    // Pas de mouvement en qualité « Économie » ni si le système demande moins d'animations.
    if (!dt || document.hidden || performance.now() < this.spinAfter || document.body.classList.contains('gfx-low')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = this.map.getCenter();
    this.map.jumpTo({ center: [c.lng + (dt / 1000) * SPIN_DEG_PER_S, c.lat] });
  };

  // ── Navigation entre les pages ──

  private setPage(page: Page): void {
    this.page = page;
    this.offLayer?.();
    this.offLayer = page === 'main' ? null : pushLayer(() => this.setPage('main'));
    this.render();
    this.root.querySelector<HTMLElement>('.home-page-body')?.scrollTo(0, 0);
  }

  private render(): void {
    const scroller = this.root.querySelector<HTMLElement>('.home-page-body');
    const scroll = scroller?.scrollTop ?? 0;
    this.root.dataset.page = this.page;
    this.root.innerHTML = this.page === 'main' ? this.mainHtml() : this.pageHtml();
    const again = this.root.querySelector<HTMLElement>('.home-page-body');
    if (again) again.scrollTop = scroll;
  }

  private accountChip(): string {
    const p = profile.get();
    return `<button type="button" class="home-account" data-h="account" aria-label="Mon compte : ${esc(p.name)}">
      ${avatarHtml(p)}
      <span class="home-account-text"><b>${esc(p.name)}</b><small>${esc(rankTitle(p.playMs))}</small></span>
    </button>`;
  }

  // ── Page principale ──

  private mainHtml(): string {
    const last = lastSlot();
    const sum = last ? slotSummary(last) : null;
    const resume = sum
      ? `<button type="button" class="home-resume" data-h="resume" data-slot="${sum.slot}">
           <span class="home-resume-logo">${logoHtml(sum.logo, sum.code, 38)}</span>
           <span class="home-resume-text"><b>${esc(sum.name)}</b><small>${esc(this.modeShort(sum))} · ${money(sum.cash)}</small></span>
           <span class="home-resume-go">Reprendre${icon('chevron', 16)}</span>
         </button>`
      : '';
    const installBtn =
      !isInstalled() && canInstall() ? `<button type="button" class="g-btn ghost small" data-h="install">${icon('install', 16)}<span>Installer le jeu</span></button>` : '';
    return `
      <header class="home-top">
        <span></span>
        ${this.accountChip()}
      </header>
      <main class="home-center">
        <h1 class="home-title"><small>Simulateur de</small><span>Compagnie aérienne</span></h1>
        ${resume}
        <nav class="home-menu" aria-label="Menu principal">
          <button type="button" class="home-btn" data-h="libre">
            <span class="home-btn-icon">${icon('globe', 28)}</span>
            <span class="home-btn-text"><strong>Partie libre</strong><small>Ta compagnie, où tu veux, sans limites</small></span>
            <span class="home-btn-chev">${icon('chevron', 20)}</span>
          </button>
          <button type="button" class="home-btn" data-h="echelons">
            <span class="home-btn-icon">${icon('stairs', 28)}</span>
            <span class="home-btn-text"><strong>Mode par échelons</strong><small>Pays après pays, du régional au mondial</small></span>
            <span class="home-btn-chev">${icon('chevron', 20)}</span>
          </button>
          <button type="button" class="home-btn quiet" data-h="settings">
            <span class="home-btn-icon">${icon('gear', 28)}</span>
            <span class="home-btn-text"><strong>Paramètres</strong><small>Son, graphismes, touches du clavier</small></span>
            <span class="home-btn-chev">${icon('chevron', 20)}</span>
          </button>
        </nav>
      </main>
      <footer class="home-foot">${installBtn || '<span>Tes parties sont enregistrées sur cet appareil.</span>'}</footer>
    `;
  }

  private modeShort(sum: SlotSummary): string {
    if (sum.slot === 'echelons') return sum.finished ? 'Échelons : tous gravis' : `Échelon ${sum.level ?? 1}`;
    return sum.slot === 'solo' ? 'Partie libre sans concurrence' : 'Partie libre avec concurrence';
  }

  // ── Pages ──

  private pageHtml(): string {
    const [title, lead, body, two] =
      this.page === 'libre'
        ? ['Partie libre', 'Crée ta compagnie dans le pays de ton choix, avec le capital que tu veux, et développe-la sans limite.', this.libreHtml(), true]
        : this.page === 'echelons'
          ? [
              'Mode par échelons',
              'Commence tout petit, dans un seul pays. Atteins deux objectifs sur trois pour partir dans un nouveau pays, en plus grand, avec une amélioration à choisir.',
              this.echelonsHtml(),
              false,
            ]
          : ['Mon compte', 'Ton profil et tes parties restent sur cet appareil : ni mot de passe, ni serveur.', this.compteHtml(), false];
    return `
      <header class="home-top">
        <button type="button" class="home-back" data-h="back">${icon('back', 18)}<span>Accueil</span></button>
        ${this.page === 'compte' ? '' : this.accountChip()}
      </header>
      <section class="home-page">
        <h2 class="home-page-title">${title}<small>${lead}</small></h2>
        <div class="home-page-body${two ? ' two' : ''}">${body}</div>
      </section>
    `;
  }

  /** Résumé d'une partie enregistrée. */
  private saveCard(sum: SlotSummary, tools = ''): string {
    const country = this.data.country(sum.country)?.name ?? sum.country;
    return `<div class="save-card">
      <span class="save-card-logo">${logoHtml(sum.logo, sum.code, 44)}</span>
      <span class="save-card-main">
        <b>${esc(sum.name)}</b>
        <small>${flagEmoji(sum.country)} ${esc(country)} · ${plural(sum.hubs, 'hub')} · ${plural(sum.aircraft, 'avion')} · ${plural(sum.lines, 'ligne')}</small>
        <small><span class="cash${sum.cash < 0 ? ' neg' : ''}">${money(sum.cash)}</span> · jouée ${ago(sum.savedAtReal)}${sum.bankrupt ? ' · <b class="neg">en faillite</b>' : ''}</small>
      </span>
      ${tools}
    </div>`;
  }

  private playButtons(slot: SlotId, mode: GameMode, competition: boolean, sum: SlotSummary | null): string {
    const attrs = `data-h="new" data-mode="${mode}" data-comp="${competition ? 1 : 0}"`;
    return sum
      ? `<div class="pane-actions">
           <button type="button" class="g-btn" data-h="resume" data-slot="${slot}">${icon('play', 14)}<span>Continuer</span></button>
           <button type="button" class="g-btn ghost" ${attrs}>${icon('plus', 18)}<span>Nouvelle partie</span></button>
         </div>`
      : `<div class="pane-actions"><button type="button" class="g-btn" ${attrs}>${icon('takeoff', 18)}<span>Commencer</span></button></div>`;
  }

  private libreHtml(): string {
    const pane = (slot: 'solo' | 'concurrence'): string => {
      const solo = slot === 'solo';
      const sum = slotSummary(slot);
      return `<article class="pane">
        <div class="pane-head">
          <span class="pane-icon">${icon(solo ? 'solo' : 'podium', 26)}</span>
          <div>
            <h3>${solo ? 'Sans concurrence' : 'Avec concurrence'}</h3>
            <p>${
              solo
                ? 'Tu es seul sur tes lignes : tous les passagers sont pour toi. Idéal pour apprendre et bâtir à ton rythme.'
                : 'Les vraies compagnies sont déjà sur leurs lignes. À toi de gagner ta part des passagers, et elles réagissent : nouvelles rivales, guerres des prix, abandons.'
            }</p>
          </div>
        </div>
        ${sum ? this.saveCard(sum) : ''}
        ${this.playButtons(slot, 'libre', !solo, sum)}
      </article>`;
    };
    return pane('solo') + pane('concurrence');
  }

  private echelonsHtml(): string {
    const sum = slotSummary('echelons');
    const done = new Map((sum?.done ?? []).map((d) => [d.level, d]));
    const current = sum && !sum.finished ? (sum.level ?? 1) : 0;
    const ladder = LEVELS.map((L, i) => {
      const n = i + 1;
      const d = done.get(n);
      const cls = d ? 'done' : n === current ? 'on' : '';
      const side = d ? `${flagEmoji(d.country)} réussi` : n === current ? 'en cours' : money(L.capital);
      return `<li class="${cls}">
        <span class="ladder-n">${d ? icon('check', 16) : n}</span>
        <span class="ladder-text"><b>${esc(L.name)}</b><small>${L.airports} aéroports à relier · ${L.fleet} avions · ${L.lines} lignes</small></span>
        <span class="ladder-side">${side}</span>
      </li>`;
    }).join('');
    return `
      <article class="pane">
        <div class="pane-head">
          <span class="pane-icon">${icon('stairs', 26)}</span>
          <div>
            <h3>Six échelons</h3>
            <p>À chaque échelon, trois objectifs : relier des aéroports du pays, satisfaire les passagers, gagner de l’argent. Les trois réussis donnent deux améliorations au lieu d’une.</p>
          </div>
        </div>
        <ol class="ladder">${ladder}</ol>
        ${sum ? this.saveCard(sum) : ''}
        ${this.playButtons('echelons', 'echelons', true, sum)}
      </article>
      <article class="pane">
        <h4>Améliorations à gagner</h4>
        <p class="g-small">Plus d’avions, plus de lignes, le droit de recruter des pilotes expérimentés, le fret, des terminaux et des ateliers de meilleure qualité, des avions plus gros, un hub de plus, des lignes vers l’étranger… À toi de choisir à chaque changement de pays.</p>
      </article>
    `;
  }

  private compteHtml(): string {
    const p = profile.get();
    const saves = slotSummaries();
    const flights = saves.reduce((n, s) => n + s.flights, 0);
    const pax = saves.reduce((n, s) => n + s.pax, 0);
    const campaign = saves.find((s) => s.slot === 'echelons');
    const trophies = campaign?.done ?? [];
    const stat = (value: string, label: string): string => `<div class="stat"><b>${value}</b><small>${label}</small></div>`;

    const swatches = PROFILE_COLORS.map(
      (c) => `<button type="button" class="acct-swatch${c === p.color ? ' on' : ''}" style="--c:${c}" data-h="color" data-v="${c}" aria-label="Couleur ${c}"></button>`,
    ).join('');
    const emblems = PROFILE_EMBLEMS.map((e) => {
      const inner = e && hasIcon(e) ? icon(e as IconName, 22) : esc((p.name.trim().charAt(0) || 'P').toUpperCase());
      return `<button type="button" class="acct-emblem${e === p.emblem ? ' on' : ''}" data-h="emblem" data-v="${e}" aria-label="${e ? `Emblème ${e}` : 'Initiale du pseudo'}">${inner}</button>`;
    }).join('');

    const trophyList = trophies.length
      ? trophies
          .map((d) => {
            const country = this.data.country(d.country)?.name ?? d.country;
            return `<span class="trophy">${icon('trophy', 20)}<span>Échelon ${d.level} · ${esc(levelSpec(d.level).name)}<small>${flagEmoji(d.country)} ${esc(country)} · ${plural(d.days, 'jour')} · ${d.goals} objectif${d.goals > 1 ? 's' : ''} sur 3</small></span></span>`;
          })
          .join('')
      : `<span class="trophy empty">${icon('trophy', 20)}<span>Réussis un échelon pour gagner ton premier trophée.</span></span>`;

    const saveList = SLOTS.map((slot) => {
      const sum = saves.find((s) => s.slot === slot);
      if (!sum) return `<p class="g-small">${esc(SLOT_LABEL[slot])} : aucune partie.</p>`;
      const tools = `<span class="save-tools">
        <button type="button" class="g-btn small" data-h="resume" data-slot="${slot}">${icon('play', 12)}<span>Continuer</span></button>
        <button type="button" class="g-btn ghost small" data-h="export" data-slot="${slot}">${icon('download', 16)}<span>Fichier</span></button>
        <button type="button" class="g-btn ghost small" data-h="copy" data-slot="${slot}">${icon('copy', 16)}<span>Code</span></button>
        <button type="button" class="g-btn ghost danger small" data-h="delete" data-slot="${slot}" aria-label="Supprimer cette partie">${icon('trash', 16)}</button>
      </span>`;
      return `<p class="g-small" style="margin-bottom:-6px">${esc(SLOT_LABEL[slot])}</p>${this.saveCard(sum, tools)}`;
    }).join('');

    return `
      <article class="pane">
        <div class="acct-id">
          ${avatarHtml(p, true)}
          <div class="acct-id-main">
            <input class="g-input" type="text" data-in="name" maxlength="18" value="${esc(p.name)}" placeholder="Ton pseudo" aria-label="Ton pseudo" autocomplete="off" spellcheck="false">
            <span class="acct-rank">${icon('pilot', 16)}<span>${esc(rankTitle(p.playMs))}</span></span>
          </div>
        </div>
        <div class="acct-pick" role="group" aria-label="Couleur du profil">${swatches}</div>
        <div class="acct-pick" role="group" aria-label="Emblème du profil">${emblems}</div>
      </article>
      <article class="pane">
        <h4>Carrière</h4>
        <div class="stat-grid">
          ${stat(playTime(p.playMs), 'de jeu')}
          ${stat(num(saves.length), `partie${saves.length > 1 ? 's' : ''} en cours`)}
          ${stat(compact(flights), 'vols effectués')}
          ${stat(compact(pax), 'passagers transportés')}
        </div>
      </article>
      <article class="pane">
        <h4>Trophées</h4>
        <div class="trophies">${trophyList}</div>
      </article>
      <article class="pane">
        <h4>Mes parties</h4>
        ${saveList}
        <p class="g-small">Pour continuer une partie sur un autre appareil ou un autre navigateur : exporte-la ici en fichier ou en code, puis importe-la là-bas.</p>
        <div class="pane-actions">
          <button type="button" class="g-btn ghost" data-h="paste">${icon('paste', 18)}<span>Coller un code</span></button>
          <label class="g-btn ghost g-file">${icon('upload', 18)}<span>Importer un fichier</span><input type="file" accept="application/json,.json" data-in="import"></label>
        </div>
      </article>
    `;
  }

  // ── Interactions ──

  private typingName(): boolean {
    const el = document.activeElement as HTMLElement | null;
    return !!el && this.root.contains(el) && el.dataset.in === 'name';
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const slot = el.dataset.slot as SlotId | undefined;
    switch (el.dataset.h) {
      case 'account':
        this.setPage('compte');
        break;
      case 'libre':
        this.setPage('libre');
        break;
      case 'echelons':
        this.setPage('echelons');
        break;
      case 'back':
        this.setPage('main');
        break;
      case 'settings':
        this.hooks.settings();
        break;
      case 'resume':
        if (slot) this.hooks.resume(slot);
        break;
      case 'new':
        void this.startNew(el.dataset.mode as GameMode, el.dataset.comp === '1');
        break;
      case 'install':
        void install().then((ok) => {
          if (ok) this.ui.toast('Le jeu s’installe sur ton écran d’accueil.', 'good');
          this.render();
        });
        break;
      case 'color':
        profile.set({ color: el.dataset.v! });
        break;
      case 'emblem':
        profile.set({ emblem: el.dataset.v ?? '' });
        break;
      case 'export':
        if (slot) this.exportSlot(slot);
        break;
      case 'copy':
        if (slot) void this.copySlot(slot);
        break;
      case 'delete':
        if (slot) void this.deleteSlot(slot);
        break;
      case 'paste':
        void this.pasteCode();
        break;
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.dataset?.in !== 'name') return;
    // Le pseudo s'enregistre au fil de la frappe, sans redessiner la page (le clavier reste ouvert).
    profile.set({ name: el.value });
    this.syncInitial();
  }

  /** L'initiale du pseudo, là où elle est affichée (portrait sans emblème, choix de l'emblème). */
  private syncInitial(): void {
    const p = profile.get();
    const initial = (p.name.trim().charAt(0) || 'P').toUpperCase();
    const av = this.root.querySelector('.acct-id .avatar');
    if (av && !p.emblem) av.textContent = initial;
    const pick = this.root.querySelector('.acct-emblem[data-v=""]');
    if (pick) pick.textContent = initial;
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.dataset?.in === 'name') {
      // Fin de la saisie : pas de pseudo vide. La page n'est pas redessinée (un toucher est peut-être en cours).
      const name = el.value.trim() || 'Pilote';
      el.value = name;
      profile.set({ name });
      this.syncInitial();
    } else if (el.dataset?.in === 'import') {
      const file = el.files?.[0];
      el.value = '';
      if (file) void file.text().then((text) => this.importText(text));
    }
  }

  /** Nouvelle partie : prévient si elle en remplacera une. */
  private async startNew(mode: GameMode, competition: boolean): Promise<void> {
    const existing = slotSummary(slotOfMode(mode, competition));
    if (existing) {
      const yes = await this.ui.confirm({
        title: 'Nouvelle partie ?',
        text: `Tu as déjà une partie dans ce mode : « ${esc(existing.name)} ». Elle sera <b>remplacée</b> dès que ta nouvelle compagnie sera créée. Exporte-la depuis ton compte si tu veux la garder.`,
        ok: 'Nouvelle partie',
        danger: true,
      });
      if (!yes) return;
    }
    this.hooks.create(mode, competition);
  }

  // ── Parties enregistrées ──

  /** Texte d'une partie enregistrée (pour l'exporter), ou null si elle est illisible. */
  private slotText(slot: SlotId): { name: string; text: string } | null {
    const res = loadFromStorage(slot);
    if (res.status !== 'ok') {
      this.ui.toast('Cette partie n’a pas pu être lue.', 'bad');
      this.render();
      return null;
    }
    return { name: exportFileName(res.save.state), text: serialize(res.save.state, res.save.savedAtReal) };
  }

  private exportSlot(slot: SlotId): void {
    const file = this.slotText(slot);
    if (!file) return;
    downloadText(file.name, file.text);
    this.ui.toast('Fichier de sauvegarde téléchargé.', 'good');
  }

  private async copySlot(slot: SlotId): Promise<void> {
    const file = this.slotText(slot);
    if (!file) return;
    if (await copyText(file.text)) this.ui.toast('Code copié. Sur l’autre appareil : Mon compte, puis « Coller un code ».', 'good');
    else this.ui.toast('Ce navigateur refuse la copie : utilise plutôt le fichier.', 'bad');
  }

  private async deleteSlot(slot: SlotId): Promise<void> {
    const sum = slotSummary(slot);
    if (!sum) return;
    const yes = await this.ui.confirm({
      title: 'Supprimer cette partie ?',
      text: `« ${esc(sum.name)} » (${esc(SLOT_LABEL[slot].toLowerCase())}) sera <b>effacée de cet appareil</b>. Exporte-la avant si tu veux pouvoir la reprendre.`,
      ok: 'Supprimer',
      danger: true,
    });
    if (!yes) return;
    clearStorage(slot);
    this.ui.toast('Partie supprimée.', 'info');
    this.render();
  }

  private async pasteCode(): Promise<void> {
    const code = await this.ui.prompt({
      title: 'Coller le code d’une partie',
      text: 'Sur l’autre appareil : Mon compte (ou Ma compagnie), puis « Code ». Ici, touche longuement la zone ci-dessous, puis « Coller ».',
      value: '',
      placeholder: 'Code de la partie',
      multiline: true,
      ok: 'Importer',
    });
    if (code?.trim()) await this.importText(code);
  }

  /** Range une partie importée dans l'emplacement de son mode. */
  private async importText(text: string): Promise<void> {
    const save = await readImport(this.ui, text, null);
    if (!save) return;
    if (!saveToStorage(save.state)) {
      this.ui.toast('Le navigateur refuse d’enregistrer (mode privé ou espace plein).', 'bad');
      return;
    }
    this.ui.toast(`Partie « ${save.state.company.name} » importée.`, 'good');
    this.render();
  }
}
