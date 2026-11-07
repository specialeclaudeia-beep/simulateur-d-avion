import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { SLOT } from './layerSlots';

/**
 * Fond de carte : style « Liberty » d'OpenFreeMap (gratuit, sans clé, données
 * OpenStreetMap / OpenMapTiles). On le télécharge puis on l'adapte au jeu :
 * étiquettes en français, relief ombré, sommets, emplacements pour les calques du jeu.
 */
const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Relief mondial gratuit (AWS Terrain Tiles, format Terrarium). */
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Nom affiché : français d'abord, puis nom latin, anglais, local. */
const FRENCH_NAME = [
  'coalesce',
  ['get', 'name:fr'],
  ['get', 'name:latin'],
  ['get', 'name_en'],
  ['get', 'name'],
] as const;

const emptySlot = (id: string): LayerSpecification => ({
  id,
  type: 'background',
  layout: { visibility: 'none' },
  paint: {},
});

export async function loadBaseStyle(): Promise<StyleSpecification> {
  const res = await fetch(BASE_STYLE_URL);
  if (!res.ok) throw new Error(`Fond de carte indisponible (${res.status})`);
  const style = (await res.json()) as StyleSpecification;
  return patchStyle(style);
}

function patchStyle(style: StyleSpecification): StyleSpecification {
  const layers: LayerSpecification[] = [];

  style.sources['terrain-dem'] = {
    type: 'raster-dem',
    tiles: [TERRAIN_TILES],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 14,
    attribution: '<a href="https://registry.opendata.aws/terrain-tiles/">Relief : Mapzen / AWS Terrain Tiles</a>',
  };

  // Les étiquettes commencent après le dernier calque « dessiné » (pas symbol).
  let lastDrawnIndex = -1;
  style.layers.forEach((l, i) => {
    if (l.type !== 'symbol') lastDrawnIndex = i;
  });

  style.layers.forEach((layer, index) => {
    // Étiquettes en français.
    if (layer.type === 'symbol' && layer.layout?.['text-field'] && !layer.id.includes('shield')) {
      const isNameLabel = JSON.stringify(layer.layout['text-field']).includes('name');
      if (isNameLabel) {
        layer.layout['text-field'] = FRENCH_NAME as unknown as string;
      }
    }

    // Le relief ombré passe sous l'eau : la mer reste unie.
    if (layer.id === 'waterway_tunnel') {
      layers.push({
        id: 'relief-hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        minzoom: 3,
        paint: {
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 3, 0, 5, 0.35, 10, 0.5],
          'hillshade-shadow-color': 'rgba(60, 50, 40, 0.55)',
          'hillshade-highlight-color': 'rgba(255, 255, 245, 0.35)',
          'hillshade-accent-color': 'rgba(60, 50, 40, 0.2)',
        },
      });
    }

    layers.push(layer);

    // Juste après le dernier élément dessiné et avant les étiquettes : la nuit
    // puis les lignes aériennes, pour que les noms restent lisibles par-dessus.
    if (index === lastDrawnIndex) {
      layers.push(emptySlot(SLOT.night), emptySlot(SLOT.routes));
    }
  });

  // Sommets des montagnes (nom + altitude) quand on zoome.
  layers.push({
    id: 'mountain-peaks',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'mountain_peak',
    minzoom: 9,
    filter: ['all', ['has', 'name'], ['>', ['coalesce', ['get', 'ele'], 0], 500]],
    layout: {
      'icon-image': 'mountain_11',
      'text-field': ['format', FRENCH_NAME, {}, '\n', {}, ['concat', ['to-string', ['get', 'ele']], ' m'], { 'font-scale': 0.8 }] as never,
      'text-font': ['Noto Sans Italic'],
      'text-size': 11,
      'text-offset': [0, 0.6],
      'text-anchor': 'top',
      'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ele'], 0]],
    },
    paint: {
      'text-color': '#6b4f2a',
      'text-halo-color': 'rgba(255,255,255,0.85)',
      'text-halo-width': 1.2,
    },
  });

  layers.push(emptySlot(SLOT.airports), emptySlot(SLOT.aircraft), emptySlot(SLOT.overlay));

  style.layers = layers;
  style.projection = { type: 'globe' };
  style.sky = {
    'sky-color': '#0a1a3f',
    'horizon-color': '#3f6fb8',
    'fog-color': '#a9c8f0',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.8,
    // Halo bleuté autour du globe quand on est loin, qui disparaît en zoomant.
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
  };
  return style;
}
