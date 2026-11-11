import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { Quality } from '../core/settings';
import { SLOT } from './layerSlots';

/**
 * Fond de carte du jeu : la Terre vue du ciel.
 *
 * - Images satellite sans nuages « Sentinel-2 cloudless » (EOX, données
 *   Copernicus) du globe entier jusqu'au détail des pistes d'aéroport : mers,
 *   déserts, forêts, montagnes et rivières sont les vrais.
 * - Par-dessus, les données OpenStreetMap servies par OpenFreeMap (gratuit,
 *   sans clé) : frontières, routes, pistes, et tous les noms en français.
 *
 * Le style est écrit ici (rien à télécharger avant d'afficher la carte) et ne
 * garde que ce qui sert au jeu : une quarantaine de calques au lieu de plus de
 * cent, la carte en est d'autant plus fluide.
 */

const SATELLITE_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
const VECTOR_TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const SRC = 'openmaptiles';

/** Nom affiché : français d'abord, puis nom latin, anglais, local. */
export const FRENCH_NAME: ExpressionSpecification = [
  'coalesce',
  ['get', 'name:fr'],
  ['get', 'name:latin'],
  ['get', 'name_en'],
  ['get', 'name'],
];

const HALO = 'rgba(3, 8, 20, 0.82)';
const TEXT = '#ffffff';
const WATER_TEXT = '#b9d4f5';

/** Niveau de détail minimal pour afficher un calque (voir applyDetail). */
const DETAIL_OF: Record<string, Quality> = {};
const need = (level: Quality, layer: LayerSpecification): LayerSpecification => {
  DETAIL_OF[layer.id] = level;
  return layer;
};

const emptySlot = (id: string): LayerSpecification => ({
  id,
  type: 'background',
  layout: { visibility: 'none' },
  paint: {},
});

const zoomed = (...stops: number[]): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], ...stops] as ExpressionSpecification;
const growing = (base: number, ...stops: number[]): ExpressionSpecification =>
  ['interpolate', ['exponential', base], ['zoom'], ...stops] as ExpressionSpecification;

const roadClass = (...classes: string[]): ExpressionSpecification => [
  'all',
  ['in', ['get', 'class'], ['literal', classes]],
  ['!=', ['get', 'brunnel'], 'tunnel'],
];

function place(
  id: string,
  filter: ExpressionSpecification,
  minzoom: number,
  size: ExpressionSpecification | number,
  extra: { maxzoom?: number; font?: string; color?: string; upper?: boolean; spacing?: number; padding?: number; opacity?: number } = {},
): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source: SRC,
    'source-layer': 'place',
    minzoom,
    ...(extra.maxzoom ? { maxzoom: extra.maxzoom } : {}),
    filter,
    layout: {
      'text-field': FRENCH_NAME,
      'text-font': [extra.font ?? 'Noto Sans Regular'],
      'text-size': size,
      'text-max-width': 8,
      'text-padding': extra.padding ?? 3,
      'text-letter-spacing': extra.spacing ?? 0,
      'text-transform': extra.upper ? 'uppercase' : 'none',
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
    },
    paint: {
      'text-color': extra.color ?? TEXT,
      'text-opacity': extra.opacity ?? 1,
      'text-halo-color': HALO,
      'text-halo-width': 1.3,
      'text-halo-blur': 0.4,
    },
  };
}

export function baseStyle(): StyleSpecification {
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#04070f' } },
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      paint: {
        'raster-fade-duration': 180,
        'raster-resampling': 'linear',
        // Un peu plus de couleur et de contraste que l'image brute : la Terre « de jeu ».
        'raster-saturation': 0.12,
        'raster-contrast': 0.06,
      },
    },

    // ── Ce que l'image ne montre pas assez : pistes, routes, bâtiments ──
    need('medium', {
      id: 'runways',
      type: 'line',
      source: SRC,
      'source-layer': 'aeroway',
      minzoom: 8.5,
      maxzoom: 13.5,
      filter: ['==', ['get', 'class'], 'runway'],
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': '#eef2fb',
        'line-width': growing(1.5, 8.5, 0.8, 11, 2.2, 13, 5),
        'line-opacity': zoomed(8.5, 0, 9.2, 0.75, 12, 0.6, 13.4, 0),
      },
    }),
    need('medium', {
      id: 'roads-minor',
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 12.5,
      filter: roadClass('tertiary', 'minor', 'service'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': growing(1.5, 12.5, 0.4, 16, 3),
        'line-opacity': zoomed(12.5, 0, 13.2, 0.22),
      },
    }),
    {
      id: 'roads-main',
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: roadClass('primary', 'secondary'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': growing(1.5, 9, 0.35, 13, 1.3, 16, 4.5),
        'line-opacity': zoomed(9, 0, 9.8, 0.3),
      },
    },
    {
      id: 'roads-motorway',
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 6,
      filter: roadClass('motorway', 'trunk'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffe0a3',
        'line-width': growing(1.5, 6, 0.4, 10, 1.1, 13, 2, 16, 6),
        'line-opacity': zoomed(6, 0, 7, 0.5),
      },
    },
    need('high', {
      id: 'railways',
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: {
        'line-color': '#1c2230',
        'line-width': growing(1.5, 11, 0.5, 16, 2),
        'line-opacity': 0.55,
        'line-dasharray': [4, 2],
      },
    }),
    need('high', {
      id: 'buildings',
      type: 'fill',
      source: SRC,
      'source-layer': 'building',
      minzoom: 14.5,
      paint: {
        'fill-color': '#0c1220',
        'fill-opacity': zoomed(14.5, 0, 15.2, 0.28),
        'fill-outline-color': 'rgba(255,255,255,0.35)',
      },
    }),

    // ── Frontières ──
    {
      id: 'boundary-state',
      type: 'line',
      source: SRC,
      'source-layer': 'boundary',
      minzoom: 3.5,
      filter: ['all', ['in', ['get', 'admin_level'], ['literal', [3, 4]]], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-opacity': zoomed(3.5, 0, 4.5, 0.28),
        'line-width': zoomed(4, 0.5, 9, 1),
        'line-dasharray': [3, 2.5],
      },
    },
    {
      id: 'boundary-country-case',
      type: 'line',
      source: SRC,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#02050c',
        'line-opacity': 0.35,
        'line-width': zoomed(0, 1.6, 4, 2.4, 9, 4),
        'line-blur': 1,
      },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: SRC,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-opacity': zoomed(0, 0.45, 4, 0.6, 9, 0.7),
        'line-width': zoomed(0, 0.5, 4, 0.9, 9, 1.6),
      },
    },
    {
      id: 'boundary-disputed',
      type: 'line',
      source: SRC,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['==', ['get', 'disputed'], 1]],
      paint: {
        'line-color': '#ffffff',
        'line-opacity': 0.5,
        'line-width': zoomed(0, 0.5, 4, 0.9, 9, 1.4),
        'line-dasharray': [2, 2],
      },
    },

    // La nuit puis les lignes aériennes passent ici, sous les noms.
    emptySlot(SLOT.night),
    emptySlot(SLOT.routes),

    // ── Noms : eaux ──
    need('medium', {
      id: 'waterway-name',
      type: 'symbol',
      source: SRC,
      'source-layer': 'waterway',
      minzoom: 9.5,
      filter: ['has', 'name'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 420,
        'text-field': FRENCH_NAME,
        'text-font': ['Noto Sans Italic'],
        'text-size': zoomed(9.5, 10, 14, 12.5),
        'text-letter-spacing': 0.08,
        'text-max-angle': 28,
      },
      paint: { 'text-color': WATER_TEXT, 'text-halo-color': 'rgba(3, 10, 26, 0.7)', 'text-halo-width': 1.1 },
    }),
    {
      id: 'water-name-lake',
      type: 'symbol',
      source: SRC,
      'source-layer': 'water_name',
      minzoom: 5.5,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'lake']],
      layout: {
        'text-field': FRENCH_NAME,
        'text-font': ['Noto Sans Italic'],
        'text-size': zoomed(5.5, 10, 12, 13),
        'text-max-width': 6,
        'text-letter-spacing': 0.06,
      },
      paint: { 'text-color': WATER_TEXT, 'text-halo-color': 'rgba(3, 10, 26, 0.7)', 'text-halo-width': 1.1 },
    },
    {
      id: 'water-name-sea',
      type: 'symbol',
      source: SRC,
      'source-layer': 'water_name',
      minzoom: 2.6,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'class'], ['literal', ['sea', 'bay', 'strait', 'gulf']]]],
      layout: {
        'text-field': FRENCH_NAME,
        'text-font': ['Noto Sans Italic'],
        'text-size': zoomed(2.6, 10, 7, 13.5),
        'text-max-width': 6,
        'text-letter-spacing': 0.12,
      },
      paint: { 'text-color': WATER_TEXT, 'text-opacity': 0.9, 'text-halo-color': 'rgba(3, 10, 26, 0.6)', 'text-halo-width': 1 },
    },
    {
      id: 'water-name-ocean',
      type: 'symbol',
      source: SRC,
      'source-layer': 'water_name',
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'ocean']],
      layout: {
        'text-field': FRENCH_NAME,
        'text-font': ['Noto Sans Italic'],
        'text-size': zoomed(0, 10.5, 4, 15),
        'text-max-width': 6,
        'text-letter-spacing': 0.22,
        'text-transform': 'uppercase',
      },
      paint: { 'text-color': WATER_TEXT, 'text-opacity': 0.8, 'text-halo-color': 'rgba(3, 10, 26, 0.5)', 'text-halo-width': 1 },
    },

    // ── Noms : relief ──
    need('medium', {
      id: 'mountain-peaks',
      type: 'symbol',
      source: SRC,
      'source-layer': 'mountain_peak',
      minzoom: 8.5,
      filter: ['all', ['has', 'name'], ['>', ['coalesce', ['get', 'ele'], 0], 500]],
      layout: {
        'icon-image': 'peak',
        'icon-size': 0.5,
        'text-field': ['format', FRENCH_NAME, {}, '\n', {}, ['concat', ['to-string', ['get', 'ele']], ' m'], { 'font-scale': 0.82 }],
        'text-font': ['Noto Sans Italic'],
        'text-size': 11,
        'text-offset': [0, 0.7],
        'text-anchor': 'top',
        'text-optional': true,
        'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ele'], 0]],
      },
      paint: { 'text-color': '#f4e3c3', 'text-halo-color': HALO, 'text-halo-width': 1.2 },
    }),
    // ── Noms : lieux habités, du quartier au pays ──
    // Régions et États : discrets, et toujours moins prioritaires que les villes et les aéroports.
    place(
      'place-state-large',
      ['all', ['==', ['get', 'class'], 'state'], ['<=', ['coalesce', ['get', 'rank'], 9], 2]],
      4.4,
      zoomed(4.4, 9.5, 7, 12.5),
      { maxzoom: 8.5, upper: true, spacing: 0.14, opacity: 0.7, padding: 10 },
    ),
    place('place-state', ['all', ['==', ['get', 'class'], 'state'], ['>', ['coalesce', ['get', 'rank'], 9], 2]], 5.8, zoomed(5.8, 9.5, 7, 12), {
      maxzoom: 8.5,
      upper: true,
      spacing: 0.14,
      opacity: 0.66,
      padding: 10,
    }),
    need('high', place('place-suburb', ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'quarter']]], 12, 10.5, {
      upper: true,
      spacing: 0.1,
      opacity: 0.8,
    })),
    need('medium', place('place-village', ['in', ['get', 'class'], ['literal', ['village', 'hamlet']]], 10.5, zoomed(10.5, 10.5, 15, 13))),
    place('place-town', ['==', ['get', 'class'], 'town'], 7.2, zoomed(7.2, 10.5, 13, 14), { padding: 4 }),
    // Les aéroports (code IATA) passent avant les petites villes : c'est un jeu d'aviation.
    {
      id: 'airport-label',
      type: 'symbol',
      source: SRC,
      'source-layer': 'aerodrome_label',
      minzoom: 7.5,
      filter: ['has', 'iata'],
      layout: {
        'icon-image': 'airport',
        'icon-size': zoomed(7.5, 0.42, 12, 0.6),
        'text-field': [
          'step',
          ['zoom'],
          ['get', 'iata'],
          10,
          ['format', ['get', 'iata'], {}, '\n', {}, FRENCH_NAME, { 'font-scale': 0.8 }],
        ],
        'text-font': ['Noto Sans Bold'],
        'text-size': zoomed(7.5, 10.5, 12, 12.5),
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
        'symbol-sort-key': ['match', ['get', 'class'], 'international', 0, 1],
      },
      paint: { 'text-color': '#ffd98a', 'text-halo-color': HALO, 'text-halo-width': 1.3 },
    },

    place('place-city', ['all', ['==', ['get', 'class'], 'city'], ['>', ['coalesce', ['get', 'rank'], 9], 5]], 5.4, zoomed(5.4, 11, 12, 17), {
      font: 'Noto Sans Bold',
      padding: 4,
    }),
    place(
      'place-city-large',
      ['all', ['==', ['get', 'class'], 'city'], ['<=', ['coalesce', ['get', 'rank'], 9], 5], ['>', ['coalesce', ['get', 'rank'], 9], 2]],
      3.6,
      zoomed(3.6, 10.5, 6, 12.5, 12, 19),
      { font: 'Noto Sans Bold', padding: 5 },
    ),
    place('place-city-major', ['all', ['==', ['get', 'class'], 'city'], ['<=', ['coalesce', ['get', 'rank'], 9], 2]], 2.4, zoomed(2.4, 10, 6, 13.5, 12, 20), {
      font: 'Noto Sans Bold',
      padding: 6,
    }),
    place('place-country-small', ['all', ['==', ['get', 'class'], 'country'], ['>', ['coalesce', ['get', 'rank'], 6], 3]], 3, zoomed(3, 10, 7, 15), {
      maxzoom: 9,
      font: 'Noto Sans Bold',
      upper: true,
      spacing: 0.1,
      padding: 6,
    }),
    place(
      'place-country-medium',
      ['all', ['==', ['get', 'class'], 'country'], ['<=', ['coalesce', ['get', 'rank'], 6], 3], ['>', ['coalesce', ['get', 'rank'], 6], 1]],
      1.8,
      zoomed(1.8, 9.5, 6, 16),
      { maxzoom: 8, font: 'Noto Sans Bold', upper: true, spacing: 0.1, padding: 6 },
    ),
    place('place-country-large', ['all', ['==', ['get', 'class'], 'country'], ['<=', ['coalesce', ['get', 'rank'], 6], 1]], 0, zoomed(0, 9.5, 5, 17), {
      maxzoom: 7,
      font: 'Noto Sans Bold',
      upper: true,
      spacing: 0.12,
      padding: 6,
    }),

    emptySlot(SLOT.airports),
    emptySlot(SLOT.aircraft),
    emptySlot(SLOT.overlay),
  ];

  return {
    version: 8,
    name: 'Simulateur de compagnie aérienne',
    glyphs: GLYPHS,
    projection: { type: 'globe' },
    sources: {
      satellite: {
        type: 'raster',
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 14,
        attribution:
          '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> par <a href="https://eox.at" target="_blank" rel="noopener">EOX</a> (données Copernicus Sentinel 2020)',
      },
      [SRC]: { type: 'vector', url: VECTOR_TILES },
    },
    sky: {
      'sky-color': '#071433',
      'horizon-color': '#4f86d6',
      'fog-color': '#b6d0f5',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.8,
      // Halo bleuté autour du globe quand on est loin, qui disparaît en zoomant.
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
    layers,
  };
}

const RANK: Record<Quality, number> = { low: 0, medium: 1, high: 2 };

/** Affiche ou masque les calques selon le niveau de détail choisi dans les paramètres. */
export function applyDetail(map: MapLibreMap, detail: Quality): void {
  for (const [id, level] of Object.entries(DETAIL_OF)) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, 'visibility', RANK[detail] >= RANK[level] ? 'visible' : 'none');
  }
}

/** Petites images dessinées au démarrage (sommets, aéroports) : rien à télécharger. */
export function addBaseImages(map: MapLibreMap): void {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Sommet : petit triangle clair.
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.moveTo(16, 7);
  ctx.lineTo(26, 25);
  ctx.lineTo(6, 25);
  ctx.closePath();
  ctx.fillStyle = '#f4e3c3';
  ctx.strokeStyle = 'rgba(3, 8, 20, 0.85)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fill();
  if (!map.hasImage('peak')) map.addImage('peak', ctx.getImageData(0, 0, size, size));

  // Aéroport : pastille ambre avec un avion.
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(16, 16, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#ffb627';
  ctx.strokeStyle = 'rgba(3, 8, 20, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1a1200';
  ctx.beginPath();
  // Fuselage, ailes et empennage (nez en haut).
  ctx.moveTo(16, 5.5);
  ctx.quadraticCurveTo(18, 8, 18, 12.5);
  ctx.lineTo(26, 18);
  ctx.lineTo(26, 20.5);
  ctx.lineTo(18, 17.8);
  ctx.lineTo(17.6, 23);
  ctx.lineTo(20.5, 25.2);
  ctx.lineTo(20.5, 26.8);
  ctx.lineTo(16, 25.6);
  ctx.lineTo(11.5, 26.8);
  ctx.lineTo(11.5, 25.2);
  ctx.lineTo(14.4, 23);
  ctx.lineTo(14, 17.8);
  ctx.lineTo(6, 20.5);
  ctx.lineTo(6, 18);
  ctx.lineTo(14, 12.5);
  ctx.quadraticCurveTo(14, 8, 16, 5.5);
  ctx.fill();
  if (!map.hasImage('airport')) map.addImage('airport', ctx.getImageData(0, 0, size, size));
}
