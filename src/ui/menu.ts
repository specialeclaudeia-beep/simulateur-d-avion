/**
 * Menu du jeu (bouton ☰ de la barre du haut, ou touche Échap) : une petite
 * fenêtre avec quelques grandes entrées (reprendre, objectifs, paramètres,
 * retour à l'accueil). Ce fichier ne fait que l'afficher ; ce que font les
 * entrées est décidé par l'appelant.
 */
import { icon, type IconName } from './icons';
import { pushLayer } from './layers';

export interface MenuItem {
  icon: IconName;
  label: string;
  sub?: string;
  /** Entrée mise en avant (bouton ambre). */
  primary?: boolean;
  /** Le menu reste ouvert dessous (ex. les paramètres s'ouvrent par-dessus). */
  keepOpen?: boolean;
  run(): void;
}

export interface MenuOptions {
  title: string;
  sub: string;
  /** HTML du logo de la compagnie. */
  logo: string;
  items: MenuItem[];
  /** Petite ligne d'aide en bas (HTML). */
  foot?: string;
  /** Appelé quand le menu se ferme (y compris après le choix d'une entrée). */
  onClose?(): void;
}

let closeCurrent: (() => void) | null = null;

export function menuOpen(): boolean {
  return closeCurrent !== null;
}

export function closeMenu(): void {
  closeCurrent?.();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function openMenu(opts: MenuOptions): void {
  if (closeCurrent) return;
  const root = document.createElement('div');
  root.className = 'ov menu';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Menu du jeu');
  root.innerHTML = `
    <div class="menu-card">
      <div class="menu-head">
        <span class="menu-head-logo">${opts.logo}</span>
        <span class="menu-head-text"><b>${escapeHtml(opts.title)}</b><small>${escapeHtml(opts.sub)}</small></span>
        <button type="button" class="g-icon-btn menu-close" aria-label="Fermer le menu">${icon('close', 20)}</button>
      </div>
      <div class="menu-items">
        ${opts.items
          .map(
            (it, i) => `<button type="button" class="menu-item${it.primary ? ' primary' : ''}" data-i="${i}">
              <span class="menu-item-icon">${icon(it.icon, 22)}</span>
              <span class="menu-item-text"><b>${escapeHtml(it.label)}</b>${it.sub ? `<small>${escapeHtml(it.sub)}</small>` : ''}</span>
            </button>`,
          )
          .join('')}
      </div>
      ${opts.foot ? `<p class="menu-keys">${opts.foot}</p>` : ''}
    </div>
  `;

  const offLayer = pushLayer(() => close());
  const before = document.activeElement as HTMLElement | null;

  function close(): void {
    if (!closeCurrent) return;
    closeCurrent = null;
    offLayer();
    root.remove();
    before?.blur?.();
    opts.onClose?.();
  }
  closeCurrent = close;

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === root || target.closest('.menu-close')) {
      close();
      return;
    }
    const b = target.closest<HTMLElement>('.menu-item');
    if (!b) return;
    const item = opts.items[Number(b.dataset.i)];
    if (!item.keepOpen) close();
    item.run();
  });

  document.body.appendChild(root);
  root.querySelector<HTMLElement>('.menu-item')?.focus({ preventScroll: true });
}
