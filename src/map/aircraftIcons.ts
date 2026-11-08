import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Silhouettes d'avions vues de dessus, dessinées au démarrage (aucune image à
 * télécharger) puis converties en « champ de distance » (SDF) : MapLibre peut
 * alors les teindre à la couleur de chaque compagnie et leur ajouter un contour.
 *
 * Une silhouette par catégorie de data/aircraft.json : turbopropulseur
 * régional, jet régional (moteurs à l'arrière), monocouloir, gros-porteur
 * biréacteur, très gros-porteur quadriréacteur.
 */

export type IconKind = 'regional_turboprop' | 'regional_jet' | 'narrowbody' | 'widebody' | 'jumbo';
export const ICON_KINDS: IconKind[] = ['regional_turboprop', 'regional_jet', 'narrowbody', 'widebody', 'jumbo'];

const SIZE = 64; // pixels de l'icône (envergure ≈ 48 px)
const BUFFER = 8; // marge pour le contour
/** Distance (px) couverte par le champ : MapLibre place le bord à 0,75 et compte 8 px par unité. */
const SDF_RADIUS = 8;

export const iconId = (kind: IconKind): string => `plane-${kind}`;

type Ctx = CanvasRenderingContext2D;

/** Dessine dans un repère où l'avion tient dans [-1, 1], nez vers le haut (y négatif). */
function draw(ctx: Ctx, kind: IconKind): void {
  const s = (SIZE - 2 * BUFFER) / 2;
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';

  const fuselage = (w: number, len: number) => {
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
  const wings = (y0: number, span: number, rootChord: number, tipChord: number, sweep: number) => {
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

  switch (kind) {
    case 'regional_turboprop': {
      fuselage(0.1, 1.75);
      wings(-0.2, 1, 0.24, 0.16, 0.02); // aile droite, haute
      wings(0.68, 0.36, 0.16, 0.1, 0.06); // empennage
      for (const x of [-0.36, 0.36]) {
        pod(x, -0.22, 0.07, 0.22);
        ctx.fillRect(x - 0.26, -0.44, 0.52, 0.045); // hélice
      }
      break;
    }
    case 'regional_jet': {
      fuselage(0.1, 1.85);
      wings(-0.12, 0.9, 0.34, 0.12, 0.34);
      wings(0.66, 0.36, 0.18, 0.08, 0.14);
      for (const x of [-0.17, 0.17]) pod(x, 0.4, 0.07, 0.17); // moteurs à l'arrière
      break;
    }
    case 'narrowbody': {
      fuselage(0.105, 1.9);
      wings(-0.1, 1, 0.38, 0.1, 0.42);
      wings(0.66, 0.38, 0.2, 0.08, 0.16);
      for (const x of [-0.36, 0.36]) pod(x, 0.02, 0.07, 0.15);
      break;
    }
    case 'widebody': {
      fuselage(0.14, 1.95);
      wings(-0.16, 1, 0.44, 0.1, 0.5);
      wings(0.62, 0.4, 0.24, 0.09, 0.2);
      for (const x of [-0.38, 0.38]) pod(x, 0.0, 0.095, 0.18);
      break;
    }
    case 'jumbo': {
      fuselage(0.15, 1.95);
      // Bosse du pont supérieur à l'avant.
      ctx.beginPath();
      ctx.ellipse(0, -0.55, 0.13, 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      wings(-0.16, 1, 0.46, 0.1, 0.52);
      wings(0.62, 0.42, 0.24, 0.09, 0.2);
      for (const x of [-0.33, 0.33]) pod(x, -0.01, 0.075, 0.16);
      for (const x of [-0.64, 0.64]) pod(x, 0.24, 0.07, 0.14);
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
    if (map.hasImage(iconId(kind))) continue;
    ctx.clearRect(0, 0, SIZE, SIZE);
    draw(ctx, kind);
    const sdf = toSdf(ctx.getImageData(0, 0, SIZE, SIZE).data);
    map.addImage(iconId(kind), sdf, { sdf: true, pixelRatio: 2 });
  }
}
