import type { CanvasSource, Map as MapLibreMap } from 'maplibre-gl';
import { sunAltitudeSin, type SubsolarPoint } from '../core/sun';
import { SLOT } from './layerSlots';

/**
 * Lumières nocturnes détaillées pour les vues rapprochées.
 *
 * L'image mondiale (2048 px) devient floue et pixelisée dès qu'on zoome. Ici, on
 * charge pour la zone affichée les tuiles NASA « Black Marble » (GIBS, domaine
 * public) au niveau de détail adapté au zoom (jusqu'à ~500 m par pixel), on en
 * extrait les lumières, puis on n'affiche que la partie où il fait nuit,
 * exactement comme pour la vue globale.
 */

const TILE_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';
const TILE = 256;
const MAX_TILE_ZOOM = 8; // niveau le plus fin publié par la NASA
const MAX_TILES = 48; // ~12 Mo de pixels au maximum
const MIN_ZOOM = 3; // en dessous, l'image mondiale suffit
const MASK_PER_TILE = 32; // résolution du masque jour/nuit (le dégradé est doux)
const DEG = Math.PI / 180;
const LIGHTS_ON = -1;
const LIGHTS_FULL = -7;

interface Region {
  z: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

export class NightLightsDetail {
  /** Lumières extraites (couleur + transparence), sans le masque de nuit. */
  private raw = document.createElement('canvas');
  /** Ce qui est affiché : lumières × nuit. */
  private out = document.createElement('canvas');
  private mask = document.createElement('canvas');
  private region: Region | null = null;
  private requestId = 0;
  private sun: SubsolarPoint | null = null;
  private tileCache = new Map<string, Promise<HTMLImageElement | null>>();

  constructor(private map: MapLibreMap) {
    this.out.width = this.out.height = 1;
    this.raw.width = this.raw.height = 1;
  }

  async install(): Promise<void> {
    const map = this.map;
    map.addSource('night-lights-detail', {
      type: 'canvas',
      canvas: this.out,
      coordinates: [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
      animate: false,
    });
    map.addLayer(
      {
        id: 'night-lights-detail',
        type: 'raster',
        source: 'night-lights-detail',
        minzoom: MIN_ZOOM,
        maxzoom: 10.5,
        layout: { visibility: 'none' },
        paint: {
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM, 0, 4.2, 1, 6.5, 0.85, 8.5, 0.65, 10.2, 0],
        },
      },
      SLOT.night,
    );
    map.on('moveend', () => void this.loadRegion());
    void this.loadRegion();
  }

  /** Nouvelle position du soleil : on recalcule seulement le masque (rapide). */
  update(sun: SubsolarPoint): void {
    this.sun = sun;
    if (!this.region) return;
    this.compose();
  }

  private async loadRegion(): Promise<void> {
    const zoom = this.map.getZoom();
    if (zoom < MIN_ZOOM) return;
    const region = this.computeRegion(zoom);
    if (!region || (this.region && sameRegion(region, this.region))) return;
    const id = ++this.requestId;

    const tiles = await Promise.all(
      Array.from({ length: region.cols * region.rows }, (_, i) => {
        const cx = i % region.cols;
        const cy = Math.floor(i / region.cols);
        return this.loadTile(region.z, region.x0 + cx, region.y0 + cy).then((img) => ({ img, cx, cy }));
      }),
    );
    if (id !== this.requestId) return; // une zone plus récente a été demandée

    const w = region.cols * TILE;
    const h = region.rows * TILE;
    const raw = document.createElement('canvas');
    raw.width = w;
    raw.height = h;
    const ctx = raw.getContext('2d', { willReadFrequently: true })!;
    for (const { img, cx, cy } of tiles) if (img) ctx.drawImage(img, cx * TILE, cy * TILE);
    extractLights(ctx, w, h);
    this.raw = raw;
    this.region = region;
    this.out.width = w;
    this.out.height = h;
    this.mask.width = region.cols * MASK_PER_TILE;
    this.mask.height = region.rows * MASK_PER_TILE;

    const src = this.map.getSource('night-lights-detail') as CanvasSource | undefined;
    if (!src) return;
    src.setCoordinates(regionCorners(region));
    this.map.setLayoutProperty('night-lights-detail', 'visibility', 'visible');
    this.compose();
  }

  /** Lumières × masque de nuit, puis envoi au GPU. */
  private compose(): void {
    const region = this.region;
    const sun = this.sun;
    if (!region || !sun) return;

    // Masque : on évalue la hauteur du soleil sur une petite grille.
    const mw = this.mask.width;
    const mh = this.mask.height;
    const mctx = this.mask.getContext('2d')!;
    const data = mctx.createImageData(mw, mh);
    const a = Math.sin(LIGHTS_ON * DEG);
    const b = Math.sin(LIGHTS_FULL * DEG);
    const n = 2 ** region.z;
    for (let y = 0; y < mh; y++) {
      const lat = tileYToLat(region.y0 + ((y + 0.5) / mh) * region.rows, n);
      for (let x = 0; x < mw; x++) {
        const lon = tileXToLon(region.x0 + ((x + 0.5) / mw) * region.cols, n);
        const t = (a - sunAltitudeSin(lat, lon, sun)) / (a - b);
        data.data[(y * mw + x) * 4 + 3] = t <= 0 ? 0 : t >= 1 ? 255 : t * t * (3 - 2 * t) * 255;
      }
    }
    mctx.putImageData(data, 0, 0);

    const ctx = this.out.getContext('2d')!;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.raw, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mask, 0, 0, this.out.width, this.out.height);
    ctx.globalCompositeOperation = 'source-over';

    const src = this.map.getSource('night-lights-detail') as CanvasSource | undefined;
    if (src && typeof src.play === 'function') {
      src.play();
      src.pause();
    }
  }

  /** Tuiles couvrant la vue (avec une marge), au niveau de détail adapté au zoom. */
  private computeRegion(zoom: number): Region | null {
    const b = this.map.getBounds();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let z = Math.min(MAX_TILE_ZOOM, Math.max(1, Math.round(zoom + Math.log2(dpr))));
    const padX = (b.getEast() - b.getWest()) * 0.25;
    const padY = (b.getNorth() - b.getSouth()) * 0.25;
    const west = Math.max(-180, b.getWest() - padX);
    const east = Math.min(180, b.getEast() + padX);
    const north = Math.min(85.05, b.getNorth() + padY);
    const south = Math.max(-85.05, b.getSouth() - padY);
    if (east <= west) return null;
    for (; z >= 1; z--) {
      const n = 2 ** z;
      const x0 = clamp(Math.floor(lonToTileX(west, n)), 0, n - 1);
      const x1 = clamp(Math.floor(lonToTileX(east, n)), 0, n - 1);
      const y0 = clamp(Math.floor(latToTileY(north, n)), 0, n - 1);
      const y1 = clamp(Math.floor(latToTileY(south, n)), 0, n - 1);
      const cols = x1 - x0 + 1;
      const rows = y1 - y0 + 1;
      if (cols * rows <= MAX_TILES) return { z, x0, y0, cols, rows };
    }
    return null;
  }

  private loadTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
    const key = `${z}/${x}/${y}`;
    let p = this.tileCache.get(key);
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      });
      this.tileCache.set(key, p);
      if (this.tileCache.size > 300) this.tileCache.delete(this.tileCache.keys().next().value!);
    }
    return p;
  }
}

/**
 * Les images NASA montrent aussi le sol (bleu sombre) et la neige (bleutée) :
 * on ne garde que les lumières, qui sont chaudes (rouge > bleu).
 */
function extractLights(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const v = (r - 0.6 * b - 18) / 110;
    if (v <= 0) {
      px[i + 3] = 0;
      continue;
    }
    const a = Math.min(1, v);
    // Couleur des lumières, légèrement réchauffée et éclaircie.
    px[i] = Math.min(255, r * 1.1 + 25);
    px[i + 1] = Math.min(255, g * 1.05 + 15);
    px[i + 2] = Math.min(255, b * 0.9 + 5);
    px[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
}

function lonToTileX(lon: number, n: number): number {
  return ((lon + 180) / 360) * n;
}
function latToTileY(lat: number, n: number): number {
  const r = lat * DEG;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
}
function tileXToLon(x: number, n: number): number {
  return (x / n) * 360 - 180;
}
function tileYToLat(y: number, n: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / DEG;
}
function regionCorners(r: Region): [[number, number], [number, number], [number, number], [number, number]] {
  const n = 2 ** r.z;
  const w = tileXToLon(r.x0, n);
  const e = tileXToLon(r.x0 + r.cols, n);
  const nn = tileYToLat(r.y0, n);
  const s = tileYToLat(r.y0 + r.rows, n);
  return [
    [w, nn],
    [e, nn],
    [e, s],
    [w, s],
  ];
}
function sameRegion(a: Region, b: Region): boolean {
  return a.z === b.z && a.x0 === b.x0 && a.y0 === b.y0 && a.cols === b.cols && a.rows === b.rows;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
