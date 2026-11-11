import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { pixelRatioFor, settings } from '../core/settings';
import { addBaseImages, applyDetail, baseStyle } from './baseStyle';

/** Vue de départ : le globe entier, centré sur l'Europe / l'Afrique. */
export const START_CENTER: [number, number] = [10, 30];

/** Zoom pour que le globe occupe ~85 % du plus petit côté de l'écran (téléphone ou ordinateur). */
export function globeZoom(): number {
  const minSide = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(0.6, Math.log2((0.85 * minSide) / 420) + 1.4);
}

// MapLibre décode les tuiles dans un « worker » : on lui indique le fichier
// copié par Vite dans le build.
maplibregl.setWorkerUrl(workerUrl);

export async function createMap(container: HTMLElement): Promise<MapLibreMap> {
  const s = settings.get();
  const map = new maplibregl.Map({
    container,
    style: baseStyle(),
    center: START_CENTER,
    zoom: globeZoom(),
    minZoom: 0.6,
    // Au-delà, l'image satellite (10 m par pixel) devient trop floue.
    maxZoom: 15,
    maxPitch: 60,
    attributionControl: { compact: true },
    // Netteté selon la qualité choisie dans les paramètres (plafonnée : la mémoire d'un téléphone est limitée).
    pixelRatio: pixelRatioFor(s.graphics),
    fadeDuration: s.graphics === 'low' ? 0 : 150,
    // Les touches du clavier sont gérées par le jeu (réglables dans les paramètres).
    keyboard: false,
  });

  map.touchZoomRotate.enableRotation();
  map.touchPitch.disable(); // le geste à deux doigts vertical gêne le pincer-zoomer sur mobile
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  // Images des étiquettes (sommets, aéroports) : dessinées ici, prêtes avant les premières tuiles.
  map.once('styledata', () => addBaseImages(map));
  map.on('styleimagemissing', () => addBaseImages(map));

  await new Promise<void>((resolve) => map.once('load', () => resolve()));
  applyDetail(map, s.detail);

  settings.onChange((next, changed) => {
    if (changed.graphics) map.setPixelRatio(pixelRatioFor(next.graphics));
    if (changed.detail) applyDetail(map, next.detail);
  });
  return map;
}
