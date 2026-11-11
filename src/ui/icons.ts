/**
 * Icônes du jeu : petits dessins au trait (grille de 24 × 24), de la couleur
 * du texte qui les entoure. Elles remplacent les émojis, qui changent d'allure
 * d'un téléphone à l'autre.
 */

/** Roue dentée : huit dents calculées autour d'un moyeu. */
function gear(): string {
  const teeth = 8;
  const rIn = 6.3;
  const rOut = 8.9;
  const pts: string[] = [];
  const p = (r: number, a: number) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2 + Math.PI / 8;
    pts.push(p(rIn, a - 0.22), p(rOut, a - 0.14), p(rOut, a + 0.14), p(rIn, a + 0.22));
  }
  return `<path d="M${pts.join('L')}z"/><circle cx="12" cy="12" r="2.9"/>`;
}

/** Avion de ligne vu du dessus (le même dessin que sur le logo par défaut). */
const PLANE =
  'M12 2.3c.8 0 1.4.7 1.4 1.5v5.300l7.600 4.400v2l-7.600-2.200v4.500l2.200 1.600v1.500L12 19.900l-3.600 1v-1.500l2.200-1.600v-4.500L3 15.500v-2l7.600-4.400V3.800c0-.8.6-1.500 1.400-1.500z';

const ICONS = {
  // ── Navigation ──
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  collapse: '<path d="M20 10h-6V4M4 14h6v6M14 10l6.500-6.500M10 14l-6.500 6.500"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.300l2.800 2.800L16 9.500"/>',
  alert: '<path d="M12 4l9 15.500H3z"/><path d="M12 10v4.500M12 17v.300"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 7.600v.300"/>',
  home: '<path d="M4 11l8-7 8 7M6 9.500V20h12V9.500M10 20v-5.500h4V20"/>',
  play: '<path d="M8 4.800l11 7.200-11 7.200z" fill="currentColor"/>',
  pause: '<path d="M8 5.500v13M16 5.500v13" stroke-width="3.200"/>',
  // ── Onglets ──
  company: '<rect x="3.500" y="7.500" width="17" height="12" rx="2"/><path d="M9 7.500V5.500A1.500 1.500 0 0 1 10.500 4h3A1.500 1.500 0 0 1 15 5.500v2M3.500 12.500h17"/>',
  hub: '<path d="M9.500 21v-8.500M14.500 21v-8.500M7 12.500h10l1.500-5h-13zM8.500 7.500v-2h7v2M12 5.500V3M5 21h14"/>',
  plane: `<path d="${PLANE}"/>`,
  prop: '<path d="M12 2.800c.8 0 1.300.6 1.300 1.400v4.600h8.200v2.600l-8.200 1.200v4.600l2.600 1.300v1.800L12 19.500l-3.900.8v-1.800l2.600-1.300v-4.600l-8.200-1.200V8.800h8.200V4.200c0-.8.5-1.400 1.300-1.400z"/>',
  pilot:
    '<circle cx="12" cy="10.200" r="3.400"/><path d="M7.200 7.400c1.200-2.300 2.800-3.400 4.800-3.400s3.600 1.100 4.800 3.400zM4.800 20.500c.7-3.600 3.200-5.400 7.200-5.400s6.500 1.800 7.200 5.400"/>',
  route: '<circle cx="5.500" cy="19" r="2.200"/><circle cx="18.500" cy="5" r="2.200"/><path d="M7.700 19H15a3.500 3.500 0 0 0 0-7H9a3.500 3.500 0 0 1 0-7h7.300"/>',
  chart: '<path d="M5.500 20v-6h3v6M10.500 20V6h3v14M15.500 20v-9h3v9M3.500 20h17"/>',
  // ── Carte et barre du haut ──
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.800 2.600 4.200 5.600 4.200 9s-1.400 6.400-4.200 9c-2.800-2.600-4.200-5.600-4.200-9S9.200 5.600 12 3z"/>',
  now: '<path d="M19.500 12a7.500 7.500 0 1 1-2.300-5.400"/><path d="M19.800 3.800V8h-4.200"/>',
  target: '<circle cx="12" cy="12" r="7.500"/><circle cx="12" cy="12" r="2.600"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.500"/><path d="M12 12l6.200-6.200"/>',
  soundOn: '<path d="M4 9.500v5h3.500l4.500 4v-13l-4.500 4z"/><path d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a7.800 7.800 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.500v5h3.500l4.500 4v-13l-4.500 4z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="16.500" cy="16" r="2.500"/>',
  skip: '<path d="M5 5l9 7-9 7zM18 5v14"/>',
  pin: '<path d="M12 21s6.500-6.200 6.500-11.200a6.500 6.500 0 0 0-13 0C5.500 14.800 12 21 12 21z"/><circle cx="12" cy="9.800" r="2.300"/>',
  map: '<path d="M3.500 6.500l5.500-2 6 2 5.500-2v13l-5.500 2-6-2-5.500 2z"/><path d="M9 4.500v13M15 6.500v13"/>',
  headphones:
    '<path d="M4.500 15v-2.500a7.500 7.500 0 0 1 15 0V15"/><rect x="3.500" y="14" width="4" height="6" rx="1.500"/><rect x="16.500" y="14" width="4" height="6" rx="1.500"/>',
  cabin: '<rect x="3" y="7.500" width="18" height="9" rx="4.500"/><path d="M7.500 11v2M12 11v2M16.500 11v2"/>',
  cockpit: '<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="2"/><path d="M3.800 11h6.300M13.900 11h6.300M12 14v6.300"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  // ── Actions ──
  cart: '<path d="M3 4h2.500l2.300 10.500h9.700l2-7.500H6.300"/><circle cx="9" cy="18.500" r="1.500"/><circle cx="16.500" cy="18.500" r="1.500"/>',
  recycle: '<path d="M5 9.500a7.500 7.500 0 0 1 13.300-2.700M19 14.500a7.500 7.500 0 0 1-13.300 2.700"/><path d="M18.800 2.800v4.200h-4.200M5.200 21.200V17h4.200"/>',
  wrench:
    '<path d="M20 6.500a4.600 4.600 0 0 1-6.200 4.300l-7.300 7.300a1.900 1.900 0 0 1-2.700-2.700l7.300-7.300a4.600 4.600 0 0 1 6.300-4.200l-2.700 2.700.5 2.200 2.200.5z"/>',
  service: '<rect x="5.500" y="4.500" width="13" height="16" rx="2"/><path d="M9 4.500v-1h6v1M8.800 12.800l2.200 2.200 4.200-4.400"/>',
  edit: '<path d="M4 20l.8-4L16 4.800a1.800 1.800 0 0 1 2.600 0l.6.6a1.800 1.800 0 0 1 0 2.600L8 19.200z"/><path d="M14.500 6.300l3.200 3.200"/>',
  contract: '<path d="M7 3.500h7l4 4v13H7z"/><path d="M14 3.500v4h4M9.500 12h5M9.500 15.500h3"/>',
  userPlus: '<circle cx="10" cy="8.500" r="3.500"/><path d="M3.500 20c.6-3.600 2.900-5.400 6.500-5.400 1.500 0 2.800.3 3.800.9M18 14v6M15 17h6"/>',
  school: '<path d="M2.500 9.500L12 5l9.500 4.500L12 14z"/><path d="M6.500 11.500v4.300c1.500 1.500 3.300 2.200 5.500 2.200s4-.7 5.500-2.200v-4.300M21.500 9.500V15"/>',
  download: '<path d="M12 4v11M7.500 10.500L12 15l4.500-4.500M4.500 19.500h15"/>',
  upload: '<path d="M12 15V4M7.500 8.500L12 4l4.500 4.500M4.500 19.500h15"/>',
  copy: '<rect x="8.500" y="8.500" width="11" height="11" rx="2"/><path d="M15.500 8.500v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  paste: '<rect x="5.500" y="5" width="13" height="15.500" rx="2"/><path d="M9 5V3.500h6V5M9 11h6M9 14.500h4"/>',
  install: '<rect x="6.500" y="2.500" width="11" height="19" rx="2.500"/><path d="M12 7v6.500M9.500 11l2.500 2.500 2.500-2.500M10.500 18h3"/>',
  image: '<rect x="3.500" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.600"/><path d="M4 17l5-4.500 3.500 3 3-2.500 4.500 4"/>',
  trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l1 13h9l1-13M10 11v5.500M14 11v5.500"/>',
  save: '<path d="M5 4h11.500L20 7.500V20H5z"/><path d="M8.500 4v5h6.500V4M8 20v-6h8v6"/>',
  takeoff: '<path d="M3 20h18"/><path d="M5 15.500l12-8M17 7.500h-5.500M17 7.500V13"/>',
  pauseCircle: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  // ── Objets ──
  box: '<path d="M3.500 8L12 3.500 20.500 8v8L12 20.500 3.500 16z"/><path d="M3.500 8l8.500 4.500L20.500 8M12 12.500v8"/>',
  money:
    '<circle cx="12" cy="12" r="8.800"/><path d="M14.800 9.400c-.5-1-1.500-1.500-2.800-1.500-1.700 0-2.800.8-2.800 2 0 2.900 5.700 1.400 5.700 4.300 0 1.200-1.200 2-2.900 2-1.400 0-2.500-.5-3-1.500M12 6v1.900M12 16.200V18"/>',
  bank: '<path d="M3.500 9.500L12 4.500l8.500 5zM5.500 9.500v8M9.800 9.500v8M14.200 9.500v8M18.500 9.500v8M3.500 20h17"/>',
  users:
    '<circle cx="9" cy="8.500" r="3.200"/><path d="M3 19.500c.5-3.300 2.600-5 6-5s5.500 1.700 6 5M15.500 5.600a3.200 3.200 0 0 1 0 5.800M17.500 14.800c2 .6 3.200 2.200 3.500 4.700"/>',
  user: '<circle cx="12" cy="8.500" r="3.700"/><path d="M4.800 20c.7-3.800 3.300-5.700 7.200-5.700s6.500 1.900 7.200 5.700"/>',
  door: '<path d="M7 20.500v-16h10v16M4.500 20.500h15M14 12.300v.800"/>',
  license:
    '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14.500 6v2.500M14.500 11v2M14.500 15.500V18"/>',
  parking: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9.500 16.500v-9h3.200a2.800 2.800 0 0 1 0 5.600H9.500"/>',
  star: '<path d="M12 3.500l2.600 5.400 5.900.8-4.300 4.100 1.100 5.800L12 16.800 6.700 19.600l1.100-5.800L3.500 9.700l5.900-.8z"/>',
  trophy:
    '<path d="M8 4h8v5.500a4 4 0 0 1-8 0zM8 5.500H4.500V7A3 3 0 0 0 8 10M16 5.500h3.500V7a3 3 0 0 1-3.500 3M12 13.500V17M8.500 20.500h7M9.500 17h5v3.500h-5z"/>',
  lock: '<rect x="5.500" y="10.500" width="13" height="10" rx="2"/><path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500"/>',
  flag: '<path d="M5.500 21V4M5.500 4.500h11l-2 3.500 2 3.500h-11"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.500 14c.9 1.300 2 2 3.500 2s2.600-.7 3.500-2M9 9.500v.5M15 9.500v.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.500l3.500 2"/>',
  list: '<path d="M8.500 6.500H20M8.500 12H20M8.500 17.500H20M4 6.500h.5M4 12h.5M4 17.500h.5"/>',
  // ── Paramètres ──
  gear: gear(),
  keyboard: '<rect x="2.500" y="6" width="19" height="12" rx="2"/><path d="M6 10h.5M9.800 10h.5M13.600 10h.5M17.400 10h.5M6 14h.5M17.400 14h.5M9.500 14h5"/>',
  gauge: '<path d="M4.500 17a8.500 8.500 0 1 1 15 0"/><path d="M12 13l4-4.500"/><circle cx="12" cy="13.500" r="1.200"/>',
  sparkles:
    '<path d="M10 4l1.600 4.400L16 10l-4.400 1.600L10 16l-1.600-4.400L4 10l4.400-1.600zM17.500 14l.9 2.100 2.100.9-2.100.9-.9 2.100-.9-2.100-2.100-.9 2.100-.9z"/>',
  layers: '<path d="M12 3.500l9 4.500-9 4.500L3 8zM3.500 12.200l8.500 4.300 8.500-4.300M3.500 16.200l8.500 4.300 8.500-4.300"/>',
  // ── Modes de jeu et améliorations ──
  stairs: '<path d="M3 20h4.500v-4.500H12V11h4.500V6.500H21"/>',
  podium: '<path d="M3.500 20.500v-6H9v6M9 20.500v-10h6v10M15 20.500v-4h5.500v4M3 20.500h18"/><path d="M12 3.500v3.500M10.300 5.200h3.400"/>',
  solo: `<circle cx="12" cy="12" r="9.500"/><g transform="translate(4.800 4.800) scale(.6)"><path d="${PLANE}"/></g>`,
  fleet: `<g transform="translate(-1.500 3) scale(.82)"><path d="${PLANE}"/></g><path d="M19 2.500v5M16.500 5h5"/>`,
  deal: '<path d="M6 18L18 6"/><circle cx="7.500" cy="7.500" r="2.500"/><circle cx="16.500" cy="16.500" r="2.500"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** Icône en SVG, à la taille demandée (pixels), de la couleur du texte. */
export function icon(name: IconName, size = 20, cls = ''): string {
  return `<svg class="ic${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

export function hasIcon(name: string): name is IconName {
  return name in ICONS;
}

/** Icône d'une amélioration du mode par échelons (noms de campaign.ts). */
export function perkIcon(name: string, size = 24): string {
  const map: Record<string, IconName> = {
    fleet: 'fleet',
    lines: 'route',
    pilot: 'userPlus',
    cargo: 'box',
    star: 'star',
    wrench: 'wrench',
    plane: 'plane',
    hub: 'hub',
    globe: 'globe',
    deal: 'deal',
    school: 'school',
    money: 'money',
  };
  return icon(map[name] ?? 'star', size);
}

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
