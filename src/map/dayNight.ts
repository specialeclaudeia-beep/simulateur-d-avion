import type { Map as MapLibreMap } from 'maplibre-gl';
import type { GameClock } from '../core/clock';
import { settings } from '../core/settings';
import { subsolarPoint, sunAltitudeSin, type SubsolarPoint } from '../core/sun';
import { SLOT } from './layerSlots';
import { NightGl } from './nightGl';
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
 * Fluidité : tout est calculé par la carte graphique (voir nightGl.ts). Ici, on
 * se contente de lui donner la position du soleil quand elle a assez changé
 * pour que cela se voie : quelques fois par minute en temps réel, à chaque
 * image en ×10 000.
 */

const LIGHTS_SIZE = 2048; // taille de l'image Black Marble
const DEG = Math.PI / 180;
/** Hauteur du soleil (°) où les lumières s'allument / sont à fond. */
const LIGHTS_ON = -1;
const LIGHTS_FULL = -7;
/** Déplacement du soleil (°) à partir duquel on redessine : en dessous, rien ne change à l'œil. */
const SUN_EPSILON = 0.02;

export class DayNight {
  private night = new NightGl();
  private detail: NightLightsDetail;
  private sun: SubsolarPoint;
  private shownLon = Number.NaN;
  private shownLat = Number.NaN;
  private raf = 0;
  private streetsAlpha = -1;

  constructor(
    private map: MapLibreMap,
    private clock: GameClock,
  ) {
    this.detail = new NightLightsDetail(map, this.night);
    this.sun = subsolarPoint(clock.now());
  }

  async install(): Promise<void> {
    const map = this.map;
    this.night.setSun(this.sun.lon, this.sun.lat);
    map.addLayer(this.night, SLOT.night);

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

    // Lumières détaillées (images NASA nettes selon le zoom), sauf en détail « faible ».
    const applyDetail = () => this.detail.setEnabled(settings.get().detail !== 'low');
    applyDetail();
    settings.onChange((_s, changed) => changed.detail && applyDetail());
    this.detail.install();

    // Les données « lourdes » arrivent en arrière-plan, la carte s'affiche sans attendre.
    void this.loadLights();

    this.tick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Force un recalcul immédiat (par ex. après un saut dans le temps). */
  refresh(): void {
    this.shownLon = Number.NaN;
  }

  private tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    const sun = subsolarPoint(this.clock.now());
    if (lonDelta(sun.lon, this.shownLon) < SUN_EPSILON && Math.abs(sun.lat - this.shownLat) < SUN_EPSILON) return;
    this.sun = sun;
    this.shownLon = sun.lon;
    this.shownLat = sun.lat;
    this.night.setSun(sun.lon, sun.lat);
    this.updateStreets();
  };

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
    this.night.setLights(c);
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
