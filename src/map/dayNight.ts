import type { CanvasSource, Map as MapLibreMap } from 'maplibre-gl';
import type { GameClock } from '../core/clock';
import { subsolarPoint, sunAltitudeSin, type SubsolarPoint } from '../core/sun';
import { SLOT } from './layerSlots';
import { NightLightsDetail } from './nightLightsDetail';

/**
 * Cycle jour / nuit.
 *
 * - Une ombre bleu nuit couvre la face non éclairée de la Terre, avec un
 *   dégradé pour le crépuscule.
 * - Vue de loin, les lumières des villes viennent de l'image « Black Marble »
 *   de la NASA, affichée seulement là où il fait nuit.
 * - En zoomant, des images NASA plus détaillées (chargées pour la zone vue)
 *   prennent le relais en fondu, puis les rues s'éclairent de près.
 *
 * Fluidité : l'ombre ne dépend que de la déclinaison du soleil (qui change très
 * lentement) et de sa longitude. On calcule donc une seule fois une ombre
 * « de référence » (soleil à la longitude 0), puis à chaque image on la décale
 * simplement vers l'est ou l'ouest. C'est très peu coûteux, donc on peut le
 * faire à chaque image, même en ×10 000.
 */

const MERC_MAX_LAT = 85.051129;
const COORDS: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, MERC_MAX_LAT],
  [180, MERC_MAX_LAT],
  [180, -MERC_MAX_LAT],
  [-180, -MERC_MAX_LAT],
];

const SHADE_SIZE = 512; // l'ombre est floue de toute façon
const LIGHTS_SIZE = 2048; // taille de l'image Black Marble
const NIGHT_COLOR = [3, 6, 22] as const;
const NIGHT_MAX_ALPHA = 0.8;
const DEG = Math.PI / 180;

/** Hauteur du soleil (°) où l'ombre commence / atteint son maximum. */
const SHADE_START = 0.8;
const SHADE_FULL = -12;
/** Hauteur du soleil (°) où les lumières s'allument / sont à fond. */
const LIGHTS_ON = -1;
const LIGHTS_FULL = -7;

/** Recalcul de l'ombre de référence quand la déclinaison a bougé de plus de… (°). */
const DEC_EPSILON = 0.02;
/** Décalage minimal du soleil avant de redessiner l'ombre (°) : ~1/20 de pixel. */
const LON_EPSILON = 0.03;
/** Les lumières (grande image) sont recomposées au plus toutes les… (ms). */
const LIGHTS_INTERVAL_MS = 100;

export class DayNight {
  // Ombre et masque « de référence » (soleil à la longitude 0).
  private shadeBase = document.createElement('canvas');
  private maskBase = document.createElement('canvas');
  private baseDec = Number.NaN;

  // Ce qui est réellement affiché.
  private shadeCanvas = document.createElement('canvas');
  private lightsMaskCanvas = document.createElement('canvas');
  private lightsCanvas = document.createElement('canvas');
  private lightsSource: HTMLCanvasElement | null = null;

  private shadeLon = Number.NaN;
  private lightsLon = Number.NaN;
  private lightsUpdatedAt = 0;
  private sun: SubsolarPoint;
  private detail: NightLightsDetail;
  private raf = 0;

  // Précalculs par ligne (latitude) du canvas d'ombre.
  private rowSin = new Float32Array(SHADE_SIZE);
  private rowCos = new Float32Array(SHADE_SIZE);

  constructor(
    private map: MapLibreMap,
    private clock: GameClock,
  ) {
    for (const c of [this.shadeCanvas, this.lightsMaskCanvas]) {
      c.width = c.height = SHADE_SIZE;
    }
    // Les références sont deux fois plus larges (motif répété) : un seul dessin
    // décalé suffit, sans raccord visible.
    for (const c of [this.shadeBase, this.maskBase]) {
      c.width = 2 * SHADE_SIZE;
      c.height = SHADE_SIZE;
    }
    this.detail = new NightLightsDetail(map);
    this.lightsCanvas.width = this.lightsCanvas.height = LIGHTS_SIZE;
    for (let y = 0; y < SHADE_SIZE; y++) {
      const mercY = Math.PI * (1 - (2 * (y + 0.5)) / SHADE_SIZE);
      const lat = Math.atan(Math.sinh(mercY));
      this.rowSin[y] = Math.sin(lat);
      this.rowCos[y] = Math.cos(lat);
    }
    this.sun = subsolarPoint(clock.now());
  }

  async install(): Promise<void> {
    const map = this.map;
    this.drawBase(this.sun.lat);
    this.shift(this.shadeBase, this.shadeCanvas, this.sun.lon);

    map.addSource('night-shade', { type: 'canvas', canvas: this.shadeCanvas, coordinates: COORDS, animate: false });
    map.addLayer(
      {
        id: 'night-shade',
        type: 'raster',
        source: 'night-shade',
        paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      },
      SLOT.night,
    );

    // Calottes polaires : au-delà de 85° de latitude, le globe prolonge le bord
    // des tuiles jusqu'au pôle, mais pas l'ombre (image hors tuiles). Deux petites
    // tuiles transparentes dont seule la rangée du bord est colorée « nuit »
    // assombrissent ces calottes ; leur opacité suit la nuit au pôle.
    for (const pole of ['north', 'south'] as const) {
      map.addSource(`night-pole-${pole}`, {
        type: 'raster',
        tiles: [new URL(`${import.meta.env.BASE_URL}geo/pole-${pole}.png`, location.href).href],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 0,
      });
      map.addLayer(
        {
          id: `night-pole-${pole}`,
          type: 'raster',
          source: `night-pole-${pole}`,
          maxzoom: 6,
          paint: { 'raster-fade-duration': 0, 'raster-opacity': 0, 'raster-resampling': 'nearest' },
        },
        SLOT.night,
      );
    }

    map.addSource('night-lights', { type: 'canvas', canvas: this.lightsCanvas, coordinates: COORDS, animate: false });
    map.addLayer(
      {
        id: 'night-lights',
        type: 'raster',
        source: 'night-lights',
        maxzoom: 5,
        paint: {
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
          // Vue de loin seulement : en zoomant, les images détaillées prennent le relais en fondu.
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 3.3, 1, 4.5, 0],
        },
      },
      SLOT.night,
    );

    // Lumières détaillées (images NASA nettes selon le zoom), pour les vues rapprochées.
    await this.detail.install();

    // De près, la nuit, les rues s'éclairent (lampadaires).
    map.addLayer(
      {
        id: 'night-streets',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 8.5,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffc870',
          'line-blur': 1.5,
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 0.6, 13, 2, 17, 10],
          'line-opacity': 0,
        },
      },
      SLOT.night,
    );
    let streetsQueued = false;
    map.on('move', () => {
      if (streetsQueued) return;
      streetsQueued = true;
      requestAnimationFrame(() => {
        streetsQueued = false;
        this.updateStreets();
      });
    });

    // Les lumières ne sont pas recomposées de près : on les remet à jour en dézoomant.
    map.on('zoomend', () => (this.lightsLon = Number.NaN));

    // Les données « lourdes » arrivent en arrière-plan, la carte s'affiche sans attendre.
    void this.loadLights();

    this.tick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Force un recalcul immédiat (par ex. après un saut dans le temps). */
  refresh(): void {
    this.shadeLon = Number.NaN;
    this.lightsLon = Number.NaN;
    this.lightsUpdatedAt = 0;
  }

  private tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    const sun = subsolarPoint(this.clock.now());
    this.sun = sun;

    let baseChanged = false;
    if (!(Math.abs(sun.lat - this.baseDec) < DEC_EPSILON)) {
      this.drawBase(sun.lat);
      baseChanged = true;
    }

    // Ombre : à chaque image si le soleil a bougé.
    if (baseChanged || !(lonDelta(sun.lon, this.shadeLon) < LON_EPSILON)) {
      this.shift(this.shadeBase, this.shadeCanvas, sun.lon);
      this.shadeLon = sun.lon;
      this.uploadCanvas('night-shade');
      this.updateStreets();
      this.updatePoles(sun);
    }

    // Lumières : grande image, donc un peu moins souvent.
    const now = performance.now();
    if (
      (baseChanged || !(lonDelta(sun.lon, this.lightsLon) < LON_EPSILON)) &&
      now - this.lightsUpdatedAt >= LIGHTS_INTERVAL_MS
    ) {
      this.lightsUpdatedAt = now;
      this.lightsLon = sun.lon;
      this.shift(this.maskBase, this.lightsMaskCanvas, sun.lon);
      // Inutile de recomposer la grande image quand elle n'est pas affichée (zoom proche).
      if (this.lightsSource && this.map.getZoom() < 5) {
        this.composeLights();
        this.uploadCanvas('night-lights');
      }
      this.detail.update(sun);
    }
  };

  /** Calcule l'ombre et le masque des lumières pour un soleil à la longitude 0. */
  private drawBase(declination: number): void {
    this.baseDec = declination;
    const n = SHADE_SIZE;
    const shadeCtx = this.shadeBase.getContext('2d')!;
    const maskCtx = this.maskBase.getContext('2d')!;
    const shade = shadeCtx.createImageData(n, n);
    const mask = maskCtx.createImageData(n, n);
    const sd = Math.sin(declination * DEG);
    const cd = Math.cos(declination * DEG);

    const colCos = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      const lon = ((x + 0.5) / n) * 360 - 180;
      colCos[x] = Math.cos(lon * DEG);
    }

    const shadeA = Math.sin(SHADE_START * DEG);
    const shadeB = Math.sin(SHADE_FULL * DEG);
    const lightA = Math.sin(LIGHTS_ON * DEG);
    const lightB = Math.sin(LIGHTS_FULL * DEG);

    let i = 0;
    for (let y = 0; y < n; y++) {
      const a = this.rowSin[y] * sd;
      const b = this.rowCos[y] * cd;
      for (let x = 0; x < n; x++, i += 4) {
        const sinAlt = a + b * colCos[x];
        const t = smooth((shadeA - sinAlt) / (shadeA - shadeB));
        shade.data[i] = NIGHT_COLOR[0];
        shade.data[i + 1] = NIGHT_COLOR[1];
        shade.data[i + 2] = NIGHT_COLOR[2];
        shade.data[i + 3] = t * NIGHT_MAX_ALPHA * 255;
        mask.data[i + 3] = smooth((lightA - sinAlt) / (lightA - lightB)) * 255;
      }
    }
    shadeCtx.putImageData(shade, 0, 0);
    shadeCtx.putImageData(shade, n, 0);
    maskCtx.putImageData(mask, 0, 0);
    maskCtx.putImageData(mask, n, 0);
  }

  /** Copie `src` (soleil à la longitude 0) dans `dst`, décalée pour un soleil à `sunLon`. */
  private shift(src: HTMLCanvasElement, dst: HTMLCanvasElement, sunLon: number): void {
    const n = SHADE_SIZE;
    let dx = (sunLon / 360) * n;
    dx = ((dx % n) + n) % n;
    const ctx = dst.getContext('2d')!;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(src, dx - n, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Lumières = image Black Marble × masque de nuit. */
  private composeLights(): void {
    const ctx = this.lightsCanvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.lightsSource!, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.lightsMaskCanvas, 0, 0, LIGHTS_SIZE, LIGHTS_SIZE);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Une image en niveaux de gris devient des lumières orangées sur fond transparent. */
  private async loadLights(): Promise<void> {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}geo/night-lights.jpg`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = LIGHTS_SIZE;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, LIGHTS_SIZE, LIGHTS_SIZE);
    const data = ctx.getImageData(0, 0, LIGHTS_SIZE, LIGHTS_SIZE);
    const px = data.data;
    // L'image contient les lumières en couleur sur fond noir : la luminosité
    // devient la transparence, la couleur est conservée.
    for (let i = 0; i < px.length; i += 4) {
      const m = Math.max(px[i], px[i + 1], px[i + 2]);
      if (m === 0) {
        px[i + 3] = 0;
        continue;
      }
      const k = 255 / m;
      px[i] = Math.min(255, px[i] * k);
      px[i + 1] = Math.min(255, px[i + 1] * k);
      px[i + 2] = Math.min(255, px[i + 2] * k);
      px[i + 3] = Math.min(255, m * 1.15);
    }
    ctx.putImageData(data, 0, 0);
    this.lightsSource = c;
    this.refresh();
  }

  /** Opacité des calottes polaires : la hauteur du soleil au pôle vaut ± sa déclinaison. */
  private updatePoles(sun: SubsolarPoint): void {
    const a = Math.sin(SHADE_START * DEG);
    const b = Math.sin(SHADE_FULL * DEG);
    const sd = Math.sin(sun.lat * DEG);
    for (const [pole, sinAlt] of [
      ['north', sd],
      ['south', -sd],
    ] as const) {
      const id = `night-pole-${pole}`;
      if (!this.map.getLayer(id)) continue;
      const alpha = Math.round(smooth((a - sinAlt) / (a - b)) * NIGHT_MAX_ALPHA * 100) / 100;
      if (this.map.getPaintProperty(id, 'raster-opacity') !== alpha) this.map.setPaintProperty(id, 'raster-opacity', alpha);
    }
  }

  /** Rues éclairées : intensité selon la nuit au centre de l'écran. */
  private updateStreets(): void {
    if (this.map.getZoom() < 8 || !this.map.getLayer('night-streets')) return;
    const c = this.map.getCenter();
    const sinAlt = sunAltitudeSin(c.lat, c.lng, this.sun);
    const t = smooth((Math.sin(LIGHTS_ON * DEG) - sinAlt) / (Math.sin(LIGHTS_ON * DEG) - Math.sin(LIGHTS_FULL * DEG)));
    const target = Math.round(t * 0.55 * 100) / 100;
    if (target === this.streetsAlpha) return;
    this.streetsAlpha = target;
    this.map.setPaintProperty('night-streets', 'line-opacity', ['interpolate', ['linear'], ['zoom'], 8.8, 0, 10.5, target]);
  }
  private streetsAlpha = -1;

  /** Envoie le contenu du canvas au GPU (une seule fois, pas à chaque image). */
  private uploadCanvas(sourceId: string): void {
    const src = this.map.getSource(sourceId) as CanvasSource | undefined;
    if (!src || typeof src.play !== 'function') return;
    src.play();
    src.pause();
  }
}

function smooth(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Écart de longitude en degrés (NaN si pas encore dessiné). */
function lonDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}
