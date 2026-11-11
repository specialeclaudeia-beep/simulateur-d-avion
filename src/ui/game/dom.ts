/**
 * Petits outils d'affichage communs aux écrans du jeu : échappement du texte,
 * formats français (nombres, dates, durées) et morceaux de HTML réutilisés.
 */
import { flagEmoji } from '../../map/countries';
import { money } from '../../game/ledger';
import { icon, type IconName } from '../icons';

export { money, flagEmoji };

// ───────────────────────── Texte ─────────────────────────

/** Échappe un texte avant de l'insérer dans du HTML (noms choisis par le joueur…). */
export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Recherche sans accents ni majuscules. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ───────────────────────── Nombres ─────────────────────────

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function num(n: number): string {
  return nf0.format(Math.round(n));
}

export function num1(n: number): string {
  return nf1.format(n);
}

/** 1 234 567 → « 1,2 M », 45 000 → « 45 k ». */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${nf1.format(n / 1e9)}\u202fMd`;
  if (a >= 1e6) return `${nf1.format(n / 1e6)}\u202fM`;
  if (a >= 1e4) return `${nf0.format(n / 1e3)}\u202fk`;
  return nf0.format(n);
}

export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}\u202f%`;
}

export function signedMoneyHtml(v: number): string {
  const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${money(v)}</span>`;
}

// ───────────────────────── Dates et durées ─────────────────────────

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** « 14:05 » si c'est le même jour que `now`, sinon « lun. 9 nov. 14:05 ». */
export function when(t: number, now: number): string {
  const d = new Date(t);
  const same = new Date(now).toDateString() === d.toDateString();
  return same ? timeFmt.format(d) : `${dayFmt.format(d)} ${timeFmt.format(d)}`;
}

export function dateLong(t: number): string {
  return dateFmt.format(new Date(t));
}

/** Durée lisible : « 45 min », « 2 h 05 », « 3 j 4 h ». */
export function duration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  const d = Math.floor(h / 24);
  return `${d} j ${h % 24} h`;
}

// ───────────────────────── Morceaux de HTML ─────────────────────────

export function stars(n: number, max = 5): string {
  return `<span class="g-stars" aria-label="${n} étoiles sur ${max}">${'★'.repeat(n)}<span>${'★'.repeat(Math.max(0, max - n))}</span></span>`;
}

/** Barre de progression (0 à 1), colorée selon le seuil. */
export function bar(ratio: number, tone: 'auto' | 'accent' = 'auto'): string {
  const r = Math.max(0, Math.min(1, ratio));
  const cls = tone === 'accent' ? 'accent' : r < 0.35 ? 'bad' : r < 0.6 ? 'warn' : 'good';
  return `<span class="g-bar ${cls}"><span style="width:${(r * 100).toFixed(1)}%"></span></span>`;
}

export function badge(text: string, tone: string): string {
  return `<span class="g-badge ${tone}">${esc(text)}</span>`;
}

/** Bouton qui déclenche une action de l'écran (data-a) avec ses paramètres. */
export function btn(label: string, action: string, opts: { id?: string; cls?: string; disabled?: boolean; extra?: string } = {}): string {
  return `<button type="button" class="g-btn ${opts.cls ?? ''}" data-a="${action}"${opts.id !== undefined ? ` data-id="${esc(opts.id)}"` : ''}${opts.extra ?? ''}${opts.disabled ? ' disabled' : ''}>${label}</button>`;
}

/** Ligne de liste touchable entière. */
export function row(opts: { action: string; id?: string; icon?: string; title: string; sub?: string; right?: string; cls?: string }): string {
  return `<button type="button" class="g-row ${opts.cls ?? ''}" data-a="${opts.action}"${opts.id !== undefined ? ` data-id="${esc(opts.id)}"` : ''}>
    ${opts.icon ? `<span class="g-row-icon">${opts.icon}</span>` : ''}
    <span class="g-row-main"><span class="g-row-title">${opts.title}</span>${opts.sub ? `<span class="g-row-sub">${opts.sub}</span>` : ''}</span>
    ${opts.right ? `<span class="g-row-right">${opts.right}</span>` : ''}
    <span class="g-row-chev">${icon('chevron', 16)}</span>
  </button>`;
}

/**
 * Portrait d'une personne : pastille ronde à ses initiales, d'une couleur qui
 * lui est propre (tirée de son nom), avec le drapeau de son pays en badge.
 */
export function avatar(p: { firstName: string; lastName: string; nationality?: string }, size: 'm' | 'l' = 'm'): string {
  let h = 0;
  const key = `${p.firstName} ${p.lastName}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const initials = `${p.firstName.charAt(0)}${p.lastName.replace(/^(de |van |da |le |el |al-)/i, '').charAt(0)}`.toUpperCase();
  return `<span class="g-avatar ${size}" style="--h:${h % 360}" aria-hidden="true"><b>${esc(initials)}</b>${p.nationality ? `<i>${flagEmoji(p.nationality)}</i>` : ''}</span>`;
}

/** Paire « libellé : valeur » dans une grille. */
export function kv(pairs: [string, string][]): string {
  return `<dl class="g-kv">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

export function section(title: string, body: string, extra = ''): string {
  return `<section class="g-section"><h3 class="g-h3">${title}${extra}</h3>${body}</section>`;
}

export function empty(text: string, action = ''): string {
  return `<div class="g-empty"><p>${text}</p>${action}</div>`;
}

export function note(text: string, tone: 'info' | 'warn' | 'bad' | 'good' = 'info'): string {
  return `<p class="g-note ${tone}">${text}</p>`;
}

/** Libellé précédé d'une icône (boutons, puces). */
export function withIcon(name: IconName, label: string, size = 18): string {
  return `${icon(name, size)}<span>${label}</span>`;
}

/** Ce qui n'est pas encore débloqué (mode par échelons). */
export function locked(text: string): string {
  return `<p class="g-locked">${icon('lock', 18)}<span>${text}</span></p>`;
}

/** Compteur « 2 / 4 » avec son icône (limites du mode par échelons). */
export function quota(name: IconName, used: number, max: number, label: string): string {
  return `<span class="g-quota${used >= max ? ' full' : ''}" title="${esc(label)}">${icon(name, 14)}${used}\u202f/\u202f${max}</span>`;
}
