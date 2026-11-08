/**
 * Logo de la compagnie : un symbole sur une forme (cercle, carré, écusson,
 * losange) aux couleurs choisies, ou une image importée par le joueur
 * (réduite à 96 × 96 pixels pour garder une sauvegarde légère).
 */
import type { Logo, LogoShape } from '../../game/state';
import { esc } from './dom';

// ───────────────────────── Symboles ─────────────────────────

/** Symboles dessinés dans une grille de 24 × 24 (pleins sauf indication). */
export const LOGO_SYMBOLS: Record<string, { label: string; svg: string }> = {
  plane: {
    label: 'Avion',
    svg: '<path d="M12 2c.8 0 1.4.7 1.4 1.5V9l7.6 4.4v2l-7.6-2.2v4.6l2.2 1.6V21L12 20l-3.6 1v-1.6l2.2-1.6v-4.6L3 15.4v-2L10.6 9V3.5C10.6 2.7 11.2 2 12 2z"/>',
  },
  globe: {
    label: 'Globe',
    svg: '<g fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.8 9h16.4M3.8 15h16.4"/></g>',
  },
  star: { label: 'Étoile', svg: '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/>' },
  wing: { label: 'Aile', svg: '<path d="M2.5 17.5c6-.4 10.5-3.3 13.6-8.6L21.5 6l-1.6 5.6c-2.8 5.4-8.6 8-17.4 5.9z"/><path d="M5 20.5c5 .2 9-1.3 12-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
  bird: { label: 'Oiseau', svg: '<path d="M2 9.5c4.2-.4 7.3 1.6 10 5.2 2.6-3.6 5.8-5.6 10-5.2-4.3 1.6-7.6 4.8-10 9.8-2.4-5-5.7-8.2-10-9.8z"/>' },
  sun: {
    label: 'Soleil',
    svg: '<circle cx="12" cy="12" r="4.6"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>',
  },
  mountain: { label: 'Montagne', svg: '<path d="M1.5 20l7.5-13 4 6.6 2.4-3.6L22.5 20z"/>' },
  wave: {
    label: 'Vague',
    svg: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 9c2.4-2 4.8-2 7.2 0s4.8 2 7.2 0 3.6-1.6 4.6-.8"/><path d="M2.5 15c2.4-2 4.8-2 7.2 0s4.8 2 7.2 0 3.6-1.6 4.6-.8"/></g>',
  },
  compass: {
    label: 'Boussole',
    svg: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 4.8l2.3 7.2L12 19.2 9.7 12z"/>',
  },
  crown: { label: 'Couronne', svg: '<path d="M3 18.5h18l-1.6-10.4-4.6 4.2L12 5.6l-2.8 6.7-4.6-4.2z"/>' },
  leaf: { label: 'Feuille', svg: '<path d="M20.5 3.5C9.5 3.5 4 9.4 4 15.6c0 1.8.4 3 1 4 1.2-5 4.9-8.6 9.7-10.7-3.9 2.9-6.7 6.7-7.7 11.6 9.4 0 13.5-7.2 13.5-17z"/>' },
  bolt: { label: 'Éclair', svg: '<path d="M13.5 2L4.5 14h6.7l-1.2 8 9-12.1h-6.7z"/>' },
  heart: { label: 'Cœur', svg: '<path d="M12 21s-8.5-5.4-8.5-11.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.5 2.6C20.5 15.6 12 21 12 21z"/>' },
  text: { label: 'Initiales', svg: '' },
};

export const LOGO_SHAPES: { id: LogoShape; label: string }[] = [
  { id: 'circle', label: 'Rond' },
  { id: 'square', label: 'Carré' },
  { id: 'shield', label: 'Écusson' },
  { id: 'diamond', label: 'Losange' },
];

/** Couleurs proposées (la compagnie et le logo) ; une couleur libre reste possible. */
export const PALETTE = [
  '#1e88e5',
  '#0d47a1',
  '#00acc1',
  '#00897b',
  '#43a047',
  '#7cb342',
  '#fdd835',
  '#fb8c00',
  '#e53935',
  '#d81b60',
  '#8e24aa',
  '#5e35b1',
  '#6d4c41',
  '#546e7a',
  '#ffffff',
  '#111827',
];

function shapePath(shape: LogoShape): string {
  switch (shape) {
    case 'circle':
      return '<circle cx="12" cy="12" r="11.5"/>';
    case 'square':
      return '<rect x="0.5" y="0.5" width="23" height="23" rx="5"/>';
    case 'shield':
      return '<path d="M12 .6l10.4 3.3v7.4c0 6.1-4.3 10.6-10.4 12.3C5.9 21.9 1.6 17.4 1.6 11.3V3.9z"/>';
    case 'diamond':
      return '<path d="M12 .3L23.7 12 12 23.7.3 12z"/>';
  }
}

// ───────────────────────── Dessin ─────────────────────────

/** Logo en SVG (ou image) à la taille demandée, en pixels. */
export function logoHtml(logo: Logo, code: string, size: number): string {
  if (logo.kind === 'image') {
    return `<img class="g-logo" src="${esc(logo.dataUrl)}" width="${size}" height="${size}" alt="Logo">`;
  }
  const sym = LOGO_SYMBOLS[logo.symbol] ?? LOGO_SYMBOLS.plane;
  const inner =
    logo.symbol === 'text'
      ? `<text x="12" y="12.2" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-weight="800" font-size="${code.length > 1 ? 10 : 13}" fill="currentColor">${esc(code)}</text>`
      : `<g transform="translate(4.2 4.2) scale(0.65)">${sym.svg}</g>`;
  return `<svg class="g-logo" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="Logo" style="color:${esc(logo.fg)}"><g fill="${esc(logo.bg)}">${shapePath(logo.shape)}</g><g fill="currentColor">${inner}</g></svg>`;
}

// ───────────────────────── Image importée ─────────────────────────

const IMAGE_SIZE = 96;

/** Lit une image choisie par le joueur et la réduit (recadrage carré au centre). */
export async function imageToLogo(file: File): Promise<Logo> {
  if (!file.type.startsWith('image/')) throw new Error('Ce fichier n’est pas une image.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image illisible.'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = IMAGE_SIZE;
    const c = canvas.getContext('2d')!;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    c.drawImage(img, sx, sy, side, side, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
    let dataUrl = canvas.toDataURL('image/webp', 0.85);
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/png');
    return { kind: 'image', dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}
