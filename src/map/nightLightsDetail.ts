import type { Map as MapLibreMap } from 'maplibre-gl';
import type { NightGl } from './nightGl';

/**
 * Lumières nocturnes détaillées pour les vues rapprochées.
 *
 * L'image mondiale (2048 px) devient floue dès qu'on zoome. Ici, on charge pour
 * la zone affichée les tuiles NASA « Black Marble » (GIBS, domaine public) au
 * niveau de détail adapté au zoom (jusqu'à ~500 m par pixel) et on en extrait
 * les lumières, une fois par tuile. Le calque de la nuit (nightGl.ts) les
 * affiche là où il fait nuit : aucun recalcul quand le soleil bouge.
 */

const TILE_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';
const TILE = 256;
const MAX_TILE_ZOOM = 8; // niveau le plus fin publié par la NASA
const MAX_TILES = 48; // ~12 Mo de pixels au maximum
const MIN_ZOOM = 3; // en dessous, l'image mondiale suffit
const DEG = Math.PI / 180;

interface Region {
  z: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

export class NightLightsDetail {
  private region: Region | null = null;
  private requestId = 0;
  private enabled = true;
  /** Tuiles déjà chargées, lumières extraites (null : tuile indisponible). */
  private tileCache = new Map<string, Promise<HTMLCanvasElement | null>>();

  constructor(
    private map: MapLibreMap,
    private night: NightGl,
  ) {}

  install(): void {
    this.map.on('moveend', () => void this.loadRegion());
    void this.loadRegion();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.night.detailEnabled = on;
    if (on) void this.loadRegion();
    else this.map.triggerRepaint();
  }

  private async loadRegion(): Promise<void> {
    if (!this.enabled) return;
    const zoom = this.map.getZoom();
    if (zoom < MIN_ZOOM) return;
    const region = this.computeRegion(zoom);
    if (!region || (this.region && sameRegion(region, this.region))) return;
    const id = ++this.requestId;

    const tiles = await Promise.all(
      Array.from({ length: region.cols * region.rows }, (_, i) => {
        const cx = i % region.cols;
        const cy = Math.floor(i / region.cols);
        return this.loadTile(region.z, region.x0 + cx, region.y0 + cy).then((image) => ({ image, x: cx * TILE, y: cy * TILE }));
      }),
    );
    if (id !== this.requestId) return; // une zone plus récente a été demandée

    this.region = region;
    const n = 2 ** region.z;
    this.night.setDetail({
      bounds: [region.x0 / n, region.y0 / n, (region.x0 + region.cols) / n, (region.y0 + region.rows) / n],
      width: region.cols * TILE,
      height: region.rows * TILE,
      tiles: tiles.filter((t): t is { image: HTMLCanvasElement; x: number; y: number } => t.image !== null),
    });
  }

  /** Tuiles couvrant la vue (avec une marge), au niveau de détail adapté au zoom. */
  private computeRegion(zoom: number): Region | null {
    const b = this.map.getBounds();
    const dpr = this.map.getPixelRatio();
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

  private loadTile(z: number, x: number, y: number): Promise<HTMLCanvasElement | null> {
    const key = `${z}/${x}/${y}`;
    let p = this.tileCache.get(key);
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(extractLights(img));
        img.onerror = () => resolve(null);
        img.src = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      });
      this.tileCache.set(key, p);
      if (this.tileCache.size > 200) this.tileCache.delete(this.tileCache.keys().next().value!);
    }
    return p;
  }
}

/**
 * Les images NASA montrent aussi le sol (bleu sombre) et la neige (bleutée) :
 * on ne garde que les lumières, qui sont chaudes (rouge > bleu).
 */
function extractLights(tile: HTMLImageElement): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(tile, 0, 0, TILE, TILE);
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, TILE, TILE);
  } catch {
    return null; // image lue sans autorisation de partage : inutilisable
  }
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
  return canvas;
}

function lonToTileX(lon: number, n: number): number {
  return ((lon + 180) / 360) * n;
}
function latToTileY(lat: number, n: number): number {
  const r = lat * DEG;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
}
function sameRegion(a: Region, b: Region): boolean {
  return a.z === b.z && a.x0 === b.x0 && a.y0 === b.y0 && a.cols === b.cols && a.rows === b.rows;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
