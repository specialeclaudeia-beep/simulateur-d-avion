import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Silhouettes d'avions vues de dessus, dessinées au démarrage (aucune image à
 * télécharger) puis converties en « champ de distance » (SDF) : MapLibre peut
 * alors les teindre à la couleur de chaque compagnie et leur ajouter un contour.
 *
 * Une silhouette par grande famille d'avions : turbopropulseur, jet régional à
 * moteurs à l'arrière (CRJ, ERJ, 717) ou sous les ailes (E-Jet, A220), monocouloir,
 * gros-porteur biréacteur, quadriréacteur (A340), triréacteur (MD-11), 747 (bosse)
 * et A380 (double pont).
 *
 * Chaque silhouette a aussi un « accent » (dérive, moteurs, bouts d'ailes) teint
 * d'une seconde couleur : chaque compagnie a ainsi sa livrée (voir liveryOf).
 */

export type IconKind =
  | 'regional_turboprop'
  | 'regional_jet'
  | 'regional_wing'
  | 'narrowbody'
  | 'widebody'
  | 'quad'
  | 'trijet'
  | 'jumbo'
  | 'superjumbo';
export const ICON_KINDS: IconKind[] = [
  'regional_turboprop',
  'regional_jet',
  'regional_wing',
  'narrowbody',
  'widebody',
  'quad',
  'trijet',
  'jumbo',
  'superjumbo',
];

/** Silhouette d'un modèle, d'après sa famille (sinon sa catégorie). */
export function iconKindFor(model: { family: string; category: string; id: string } | undefined): IconKind {
  if (!model) return 'narrowbody';
  switch (model.family) {
    case 'A380':
      return 'superjumbo';
    case '747':
      return 'jumbo';
    case 'A340':
      return 'quad';
    case 'MD-11':
      return 'trijet';
    case 'E-Jet':
    case 'A220':
    case 'SSJ':
    case 'C909':
      return 'regional_wing';
  }
  if (model.category === 'jumbo') return 'widebody'; // 777-9 : grand biréacteur
  return model.category as IconKind;
}

const SIZE = 64; // pixels de l'icône (envergure ≈ 48 px)
const BUFFER = 8; // marge pour le contour
/** Distance (px) couverte par le champ : MapLibre place le bord à 0,75 et compte 8 px par unité. */
const SDF_RADIUS = 8;

export const iconId = (kind: IconKind): string => `plane-${kind}`;
export const accentId = (kind: IconKind): string => `plane-${kind}-accent`;

/**
 * Livrée d'une compagnie : couleur du fuselage et des accents. Quatre styles,
 * choisis d'après le code de la compagnie (toujours le même pour elle).
 */
export function liveryOf(code: string, color: string): { body: string; accent: string } {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  switch (h % 4) {
    case 0:
      return { body: color, accent: '#ffffff' };
    case 1:
      return { body: '#f4f6fa', accent: color };
    case 2:
      return { body: color, accent: shade(color, -0.45) };
    default:
      return { body: '#cfd8e3', accent: color };
  }
}

/** Assombrit (k < 0) ou éclaircit (k > 0) une couleur #rrggbb. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  if (Number.isNaN(n)) return hex;
  const ch = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

type Ctx = CanvasRenderingContext2D;

/**
 * Dessine dans un repère où l'avion tient dans [-1, 1], nez vers le haut (y négatif).
 * `accent` : ne dessine que les parties de la seconde couleur (dérive, moteurs, bouts d'ailes).
 */
function draw(ctx: Ctx, kind: IconKind, accent = false): void {
  const s = (SIZE - 2 * BUFFER) / 2;
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';

  // Parties « corps » : dessinées seulement pour la silhouette ; parties « accent » :
  // dessinées dans les deux (le corps reste plein sous l'accent).
  const body = !accent;
  const fuselage = (w: number, len: number) => {
    if (!body) {
      // Accent : dérive (vue de dessus, un trait épais à l'arrière) et nez.
      ctx.beginPath();
      ctx.ellipse(0, len / 2 - 0.2, w * 0.55, 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const top = -len / 2;
    const bot = len / 2;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.bezierCurveTo(w * 0.9, top, w, top + w * 1.4, w, top + w * 2.4);
    ctx.lineTo(w, bot - w * 2.5);
    ctx.quadraticCurveTo(w * 0.7, bot, 0, bot + 0.02);
    ctx.quadraticCurveTo(-w * 0.7, bot, -w, bot - w * 2.5);
    ctx.lineTo(-w, top + w * 2.4);
    ctx.bezierCurveTo(-w, top + w * 1.4, -w * 0.9, top, 0, top);
    ctx.fill();
  };
  /** Aile en flèche : racine à y0 (bord d'attaque), demi-envergure `span`, flèche `sweep`. */
  const wings = (y0: number, span: number, rootChord: number, tipChord: number, sweep: number, tail = false) => {
    if (!body) {
      // Accent : bouts d'ailes (winglets) ou empennage entier.
      for (const side of [-1, 1]) {
        ctx.beginPath();
        if (tail) {
          ctx.moveTo(0, y0);
          ctx.lineTo(side * span, y0 + sweep);
          ctx.lineTo(side * span, y0 + sweep + tipChord);
          ctx.lineTo(0, y0 + rootChord);
        } else {
          const k = 0.8; // dernier cinquième de l'aile
          ctx.moveTo(side * span * k, y0 + sweep * k);
          ctx.lineTo(side * span, y0 + sweep);
          ctx.lineTo(side * span, y0 + sweep + tipChord);
          ctx.lineTo(side * span * k, y0 + sweep * k + rootChord + (tipChord - rootChord) * k);
        }
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(side * span, y0 + sweep);
      ctx.lineTo(side * span, y0 + sweep + tipChord);
      ctx.lineTo(0, y0 + rootChord);
      ctx.closePath();
      ctx.fill();
    }
  };
  const pod = (x: number, y: number, w: number, len: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, w, len, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const quadEngines = (inner: number, outer: number, yi: number, yo: number, w: number, len: number) => {
    for (const x of [-inner, inner]) pod(x, yi, w, len);
    for (const x of [-outer, outer]) pod(x, yo, w * 0.92, len * 0.9);
  };

  switch (kind) {
    case 'regional_turboprop': {
      fuselage(0.1, 1.75);
      wings(-0.2, 1, 0.24, 0.16, 0.02); // aile droite, haute
      wings(0.68, 0.36, 0.16, 0.1, 0.06, true); // empennage
      for (const x of [-0.36, 0.36]) {
        pod(x, -0.22, 0.07, 0.22);
        ctx.fillRect(x - 0.26, -0.44, 0.52, 0.045); // hélice
      }
      break;
    }
    case 'regional_jet': {
      fuselage(0.1, 1.85);
      wings(-0.12, 0.9, 0.34, 0.12, 0.34);
      wings(0.66, 0.36, 0.18, 0.08, 0.14, true);
      for (const x of [-0.17, 0.17]) pod(x, 0.4, 0.07, 0.17); // moteurs à l'arrière
      break;
    }
    case 'regional_wing': {
      fuselage(0.1, 1.8);
      wings(-0.1, 0.92, 0.34, 0.1, 0.36);
      wings(0.64, 0.36, 0.18, 0.08, 0.15, true);
      for (const x of [-0.32, 0.32]) pod(x, 0.0, 0.07, 0.14);
      break;
    }
    case 'narrowbody': {
      fuselage(0.105, 1.9);
      wings(-0.1, 1, 0.38, 0.1, 0.42);
      wings(0.66, 0.38, 0.2, 0.08, 0.16, true);
      for (const x of [-0.36, 0.36]) pod(x, 0.02, 0.07, 0.15);
      break;
    }
    case 'widebody': {
      fuselage(0.14, 1.95);
      wings(-0.16, 1, 0.44, 0.1, 0.5);
      wings(0.62, 0.4, 0.24, 0.09, 0.2, true);
      for (const x of [-0.38, 0.38]) pod(x, 0.0, 0.095, 0.18);
      break;
    }
    case 'quad': {
      fuselage(0.12, 1.98);
      wings(-0.16, 1, 0.42, 0.1, 0.5);
      wings(0.63, 0.4, 0.22, 0.09, 0.2, true);
      quadEngines(0.3, 0.6, -0.02, 0.2, 0.065, 0.14);
      break;
    }
    case 'trijet': {
      fuselage(0.13, 1.95);
      wings(-0.14, 1, 0.42, 0.1, 0.5);
      wings(0.64, 0.4, 0.22, 0.09, 0.2, true);
      for (const x of [-0.38, 0.38]) pod(x, 0.02, 0.09, 0.17);
      pod(0, 0.66, 0.08, 0.16); // moteur dans la dérive
      break;
    }
    case 'jumbo': {
      fuselage(0.15, 1.95);
      // Bosse du pont supérieur à l'avant.
      if (body) {
        ctx.beginPath();
        ctx.ellipse(0, -0.55, 0.13, 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      wings(-0.16, 1, 0.46, 0.1, 0.52);
      wings(0.62, 0.42, 0.24, 0.09, 0.2, true);
      quadEngines(0.33, 0.64, -0.01, 0.24, 0.075, 0.16);
      break;
    }
    case 'superjumbo': {
      fuselage(0.18, 1.9); // double pont : fuselage très large
      wings(-0.2, 1, 0.56, 0.1, 0.48);
      wings(0.6, 0.42, 0.26, 0.1, 0.18, true);
      quadEngines(0.34, 0.62, -0.02, 0.18, 0.08, 0.16);
      break;
    }
  }
  ctx.restore();
}

/** Convertit un masque (canal alpha) en champ de distance au format attendu par MapLibre. */
function toSdf(mask: Uint8ClampedArray): ImageData {
  const n = SIZE * SIZE;
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = mask[i * 4 + 3] > 127 ? 1 : 0;
  const out = new ImageData(SIZE, SIZE);
  const R = SDF_RADIUS;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const me = inside[y * SIZE + x];
      // Distance au pixel de l'autre « camp » le plus proche (recherche locale bornée).
      let best = R * R;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= SIZE) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= SIZE) continue;
          if (inside[yy * SIZE + xx] !== me) {
            const d = dx * dx + dy * dy;
            if (d < best) best = d;
          }
        }
      }
      const d = (Math.sqrt(best) - 0.5) * (me ? -1 : 1); // < 0 à l'intérieur
      const a = Math.max(0, Math.min(1, 0.75 - d / 8));
      const o = (y * SIZE + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = 255;
      out.data[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/** Ajoute toutes les silhouettes à la carte (à appeler une fois, puis après un changement de style). */
export function addAircraftIcons(map: MapLibreMap): void {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  for (const kind of ICON_KINDS) {
    for (const accent of [false, true]) {
      const id = accent ? accentId(kind) : iconId(kind);
      if (map.hasImage(id)) continue;
      ctx.clearRect(0, 0, SIZE, SIZE);
      draw(ctx, kind, accent);
      const sdf = toSdf(ctx.getImageData(0, 0, SIZE, SIZE).data);
      map.addImage(id, sdf, { sdf: true, pixelRatio: 2 });
    }
  }
}
