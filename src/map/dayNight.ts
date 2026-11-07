import type { CanvasSource, ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { GameClock } from '../core/clock';
import { subsolarPoint, sunAltitudeSin, type SubsolarPoint } from '../core/sun';
import { SLOT } from './layerSlots';

/**
 * Cycle jour / nuit.
 *
 * - Une ombre bleu nuit couvre la face non éclairée de la Terre, avec un
 *   dégradé pour le crépuscule (calcul pixel par pixel sur un petit canvas).
 * - Vue de loin, les lumières des villes viennent de l'image « Black Marble »
 *   de la NASA, affichée seulement là où il fait nuit.
 * - En zoomant, ce sont des points lumineux par ville (Natural Earth), dont la
 *   taille dépend de la population, qui prennent le relais.
 *
 * Tout suit l'horloge du jeu : en accéléré, on voit la nuit avancer.
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
/** Zooms entre lesquels l'ombre « globe » laisse la place à la teinte uniforme. */
const NEAR_ZOOM_START = 6.5;
const NEAR_ZOOM_END = 7.5;

/** Hauteur du soleil (°) où l'ombre commence / atteint son maximum. */
const SHADE_START = 0.8;
const SHADE_FULL = -12;
/** Hauteur du soleil (°) où les lumières s'allument / sont à fond. */
const LIGHTS_ON = -1;
const LIGHTS_FULL = -7;

/** Intervalle minimal entre deux recalculs (ms réelles). */
const MIN_UPDATE_MS = 400;
/** Déplacement minimal du soleil avant recalcul (degrés). */
const MIN_SUN_MOVE = 0.08;

export class DayNight {
  private shadeCanvas = document.createElement('canvas');
  private lightsCanvas = document.createElement('canvas');
  private lightsMaskCanvas = document.createElement('canvas');
  private lightsSource: HTMLCanvasElement | null = null;
  private lastSun: SubsolarPoint | null = null;
  private lastUpdate = 0;
  private raf = 0;

  // Précalculs par ligne (latitude) du canvas d'ombre.
  private rowSin = new Float32Array(SHADE_SIZE);
  private rowCos = new Float32Array(SHADE_SIZE);

  constructor(
    private map: MapLibreMap,
    private clock: GameClock,
  ) {
    this.shadeCanvas.width = this.shadeCanvas.height = SHADE_SIZE;
    this.lightsMaskCanvas.width = this.lightsMaskCanvas.height = SHADE_SIZE;
    this.lightsCanvas.width = this.lightsCanvas.height = LIGHTS_SIZE;
    for (let y = 0; y < SHADE_SIZE; y++) {
      const mercY = Math.PI * (1 - (2 * (y + 0.5)) / SHADE_SIZE);
      const lat = Math.atan(Math.sinh(mercY));
      this.rowSin[y] = Math.sin(lat);
      this.rowCos[y] = Math.cos(lat);
    }
  }

  async install(): Promise<void> {
    const map = this.map;
    this.drawShade(subsolarPoint(this.clock.now()));

    map.addSource('night-shade', { type: 'canvas', canvas: this.shadeCanvas, coordinates: COORDS, animate: false });
    map.addLayer(
      {
        id: 'night-shade',
        type: 'raster',
        source: 'night-shade',
        maxzoom: NEAR_ZOOM_END,
        paint: {
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], NEAR_ZOOM_START, 1, NEAR_ZOOM_END, 0],
        },
      },
      SLOT.night,
    );

    // De près, l'écran ne couvre que quelques degrés : une teinte uniforme,
    // calculée pour le centre de la vue, suffit et reste nette à tous les zooms.
    map.addSource('night-shade-near', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer(
      {
        id: 'night-shade-near',
        type: 'fill',
        source: 'night-shade-near',
        minzoom: NEAR_ZOOM_START,
        paint: {
          'fill-color': `rgb(${NIGHT_COLOR.join(',')})`,
          'fill-antialias': false,
          'fill-opacity': 0,
        },
      },
      SLOT.night,
    );
    // De près, la nuit, les rues s'éclairent (lampadaires).
    map.addLayer(
      {
        id: 'night-streets',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 9,
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
    map.on('moveend', () => this.updateNearShade());

    map.addSource('night-lights', { type: 'canvas', canvas: this.lightsCanvas, coordinates: COORDS, animate: false });
    map.addLayer(
      {
        id: 'night-lights',
        type: 'raster',
        source: 'night-lights',
        maxzoom: 6,
        paint: {
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.95, 6, 0],
        },
      },
      SLOT.night,
    );

    map.addSource('city-lights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer(
      {
        id: 'city-lights',
        type: 'circle',
        source: 'city-lights',
        minzoom: 3,
        paint: {
          'circle-color': '#ffd68a',
          'circle-blur': 1,
          'circle-pitch-alignment': 'map',
          'circle-radius': [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            4,
            ['interpolate', ['linear'], ['sqrt', ['get', 'p']], 140, 1.2, 4000, 6],
            10,
            ['interpolate', ['linear'], ['sqrt', ['get', 'p']], 140, 25, 4000, 160],
          ],
          'circle-opacity': 0,
        },
      },
      SLOT.night,
    );

    // Les données « lourdes » arrivent en arrière-plan, la carte s'affiche sans attendre.
    void this.loadLights();
    void this.loadCityPoints();

    this.tick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Force un recalcul immédiat (par ex. après un saut dans le temps). */
  refresh(): void {
    this.lastSun = null;
    this.lastUpdate = 0;
  }

  private tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    const realNow = performance.now();
    if (realNow - this.lastUpdate < MIN_UPDATE_MS) return;
    const sun = subsolarPoint(this.clock.now());
    if (this.lastSun && angularDistance(sun, this.lastSun) < MIN_SUN_MOVE) return;
    this.lastUpdate = realNow;
    this.lastSun = sun;
    this.update(sun);
  };

  private update(sun: SubsolarPoint): void {
    this.drawShade(sun);
    this.uploadCanvas('night-shade');
    if (this.lightsSource) {
      this.composeLights();
      this.uploadCanvas('night-lights');
    }
    this.updateCityPoints(sun);
    this.updateNearShade(sun);
  }

  /** Teinte de nuit uniforme pour les vues rapprochées (centre de l'écran). */
  private updateNearShade(sun = this.lastSun ?? subsolarPoint(this.clock.now())): void {
    if (this.map.getZoom() < NEAR_ZOOM_START - 0.5) return;
    const c = this.map.getCenter();
    // Un rectangle autour de la vue (un polygone couvrant toute la Terre est
    // mal découpé par le rendu en globe et s'affiche en partie sous la surface).
    const b = this.map.getBounds();
    const padLng = (b.getEast() - b.getWest()) * 1.5 + 1;
    const padLat = (b.getNorth() - b.getSouth()) * 1.5 + 1;
    const w = Math.max(-180, b.getWest() - padLng);
    const e = Math.min(180, b.getEast() + padLng);
    const sth = Math.max(-MERC_MAX_LAT, b.getSouth() - padLat);
    const nth = Math.min(MERC_MAX_LAT, b.getNorth() + padLat);
    (this.map.getSource('night-shade-near') as GeoJSONSource).setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[w, sth], [e, sth], [e, nth], [w, nth], [w, sth]]] },
    });
    const sinAlt = sunAltitudeSin(c.lat, c.lng, sun);
    const t = smooth((Math.sin(SHADE_START * DEG) - sinAlt) / (Math.sin(SHADE_START * DEG) - Math.sin(SHADE_FULL * DEG)));
    const alpha = Math.round(t * NIGHT_MAX_ALPHA * 1000) / 1000;
    this.map.setPaintProperty('night-shade-near', 'fill-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      NEAR_ZOOM_START,
      0,
      NEAR_ZOOM_END,
      alpha,
    ]);
    this.map.setPaintProperty('night-streets', 'line-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      9,
      0,
      11,
      Math.round(t * 0.55 * 1000) / 1000,
    ]);
  }

  /** Calcule l'ombre et le masque des lumières pour la position du soleil donnée. */
  private drawShade(sun: SubsolarPoint): void {
    const n = SHADE_SIZE;
    const shadeCtx = this.shadeCanvas.getContext('2d')!;
    const maskCtx = this.lightsMaskCanvas.getContext('2d')!;
    const shade = shadeCtx.createImageData(n, n);
    const mask = maskCtx.createImageData(n, n);
    const sd = Math.sin(sun.lat * DEG);
    const cd = Math.cos(sun.lat * DEG);

    const colCos = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      const lon = ((x + 0.5) / n) * 360 - 180;
      colCos[x] = Math.cos((lon - sun.lon) * DEG);
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
    maskCtx.putImageData(mask, 0, 0);
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
    for (let i = 0; i < px.length; i += 4) {
      const l = px[i] / 255;
      // Orange chaud pour les lumières faibles, presque blanc pour les plus fortes.
      px[i] = 255;
      px[i + 1] = 190 + 60 * l;
      px[i + 2] = 110 + 130 * l * l;
      px[i + 3] = Math.min(255, Math.sqrt(l) * 330);
    }
    ctx.putImageData(data, 0, 0);
    this.lightsSource = c;
    this.refresh();
  }

  private async loadCityPoints(): Promise<void> {
    const res = await fetch(`${import.meta.env.BASE_URL}geo/city-lights.geojson`);
    const fc = (await res.json()) as CityLights;
    for (const f of fc.features) {
      const [lon, lat] = f.geometry.coordinates;
      Object.assign(f.properties, { lo: lon, sl: Math.sin(lat * DEG), cl: Math.cos(lat * DEG) });
    }
    (this.map.getSource('city-lights') as GeoJSONSource).setData(fc);
    this.refresh();
  }

  /**
   * L'opacité de chaque point dépend de la hauteur du soleil à cet endroit,
   * calculée directement par MapLibre (expression), sans recalcul en JS par ville.
   */
  private updateCityPoints(sun: SubsolarPoint): void {
    const sd = Math.sin(sun.lat * DEG);
    const cd = Math.cos(sun.lat * DEG);
    const sinAlt: ExpressionSpecification = [
      '+',
      ['*', ['get', 'sl'], sd],
      ['*', ['get', 'cl'], cd, ['cos', ['*', ['-', ['get', 'lo'], sun.lon], DEG]]],
    ];
    const nightness: ExpressionSpecification = [
      'interpolate',
      ['linear'],
      sinAlt,
      Math.sin(LIGHTS_FULL * DEG),
      0.85,
      Math.sin(LIGHTS_ON * DEG),
      0,
    ];
    this.map.setPaintProperty('city-lights', 'circle-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      3,
      0,
      5,
      nightness,
      11,
      nightness,
      13,
      0,
    ]);
  }

  /** Envoie le contenu du canvas au GPU (une seule fois, pas à chaque image). */
  private uploadCanvas(sourceId: string): void {
    const src = this.map.getSource(sourceId) as CanvasSource | undefined;
    if (!src || typeof src.play !== 'function') return;
    src.play();
    src.pause();
  }
}

interface CityLights {
  type: 'FeatureCollection';
  features: { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Record<string, unknown> }[];
}

function smooth(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function angularDistance(a: SubsolarPoint, b: SubsolarPoint): number {
  const dLon = Math.abs(((a.lon - b.lon + 540) % 360) - 180);
  return Math.max(Math.abs(a.lat - b.lat), dLon);
}
