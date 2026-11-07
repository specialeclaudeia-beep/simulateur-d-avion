import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { loadBaseStyle } from './baseStyle';

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
  const style = await loadBaseStyle();

  const map = new maplibregl.Map({
    container,
    style,
    center: START_CENTER,
    zoom: globeZoom(),
    minZoom: 0.6,
    maxZoom: 17,
    maxPitch: 60,
    attributionControl: { compact: true },
    // Écrans haute densité (téléphones) : rendu net sans exploser la mémoire.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    fadeDuration: 150,
  });

  map.touchZoomRotate.enableRotation();
  map.touchPitch.disable(); // le geste à deux doigts vertical gêne le pincer-zoomer sur mobile
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  await new Promise<void>((resolve) => map.once('load', () => resolve()));
  return map;
}
