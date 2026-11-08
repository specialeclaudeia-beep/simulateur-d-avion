import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { greatCirclePath } from '../flights/geo';
import { SLOT } from './layerSlots';

/**
 * Réseau de la compagnie du joueur sur la carte : ses hubs (gros points à sa
 * couleur), les destinations desservies et ses lignes en arcs de grand cercle
 * (pleines si un avion y vole, en pointillés sinon).
 *
 * Un « aperçu » sert pendant les choix : hub candidat et ses vraies lignes,
 * nouvelle ligne envisagée…
 *
 * Toucher un hub ou une ligne prévient le jeu ; le pays dessous n'est alors
 * pas sélectionné (le calque doit être créé avant `Countries.install()`).
 */

export interface NetworkPlace {
  iata: string;
  lon: number;
  lat: number;
}

export interface NetworkLine {
  id: string;
  from: NetworkPlace;
  to: NetworkPlace;
  /** Au moins un avion programmé sur la ligne. */
  served: boolean;
}

export interface NetworkData {
  color: string;
  hubs: NetworkPlace[];
  dests: NetworkPlace[];
  lines: NetworkLine[];
}

export interface NetworkPreview {
  /** Aéroport mis en avant (hub candidat, destination envisagée…). */
  focus: NetworkPlace;
  /** Lignes à montrer depuis `origin` (par défaut depuis `focus`). */
  origin?: NetworkPlace;
  dests: NetworkPlace[];
}

const SRC_LINES = 'net-lines';
const SRC_POINTS = 'net-points';
const SRC_PREVIEW = 'net-preview';
const HIT_LINES = 'net-lines-hit';
const HUBS = 'net-hubs';
const PREVIEW_COLOR = '#ffd166';

type LineProps = { id: string; served: number };
type PointProps = { iata: string; kind: 'hub' | 'dest' };

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export class NetworkLayer {
  private hubListeners = new Set<(iata: string) => void>();
  private lineListeners = new Set<(id: string) => void>();
  private lastKey = '';

  constructor(private map: MapLibreMap) {
    this.install();
    map.on('click', this.onClick);
    for (const layer of [HUBS, HIT_LINES]) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  }

  private install(): void {
    const map = this.map;
    map.addSource(SRC_LINES, { type: 'geojson', data: empty() });
    map.addSource(SRC_POINTS, { type: 'geojson', data: empty() });
    map.addSource(SRC_PREVIEW, { type: 'geojson', data: empty() });

    // Sous les étiquettes de la carte : les arcs.
    map.addLayer(
      {
        id: 'net-preview-lines',
        type: 'line',
        source: SRC_PREVIEW,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': PREVIEW_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1, 6, 2],
          'line-opacity': 0.75,
          'line-dasharray': [2, 1.5],
        },
      },
      SLOT.routes,
    );
    map.addLayer(
      {
        id: 'net-lines-selected',
        type: 'line',
        source: SRC_LINES,
        filter: ['==', ['get', 'id'], ''],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 9], 'line-opacity': 0.35, 'line-blur': 2 },
      },
      SLOT.routes,
    );
    map.addLayer(
      {
        id: 'net-lines-unserved',
        type: 'line',
        source: SRC_LINES,
        filter: ['==', ['get', 'served'], 0],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2.2],
          'line-opacity': 0.6,
          'line-dasharray': [1.5, 1.5],
        },
      },
      SLOT.routes,
    );
    map.addLayer(
      {
        id: 'net-lines',
        type: 'line',
        source: SRC_LINES,
        filter: ['==', ['get', 'served'], 1],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#4da3ff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 6, 3, 9, 4],
          'line-opacity': 0.9,
        },
      },
      SLOT.routes,
    );
    // Zone de toucher large et invisible (une ligne fine est difficile à viser au doigt).
    map.addLayer(
      {
        id: HIT_LINES,
        type: 'line',
        source: SRC_LINES,
        paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0 },
      },
      SLOT.routes,
    );

    // Au-dessus des étiquettes : les aéroports.
    map.addLayer(
      {
        id: 'net-preview-points',
        type: 'circle',
        source: SRC_PREVIEW,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          // « zoom » doit rester au premier niveau de l'expression (règle de MapLibre).
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            1,
            ['case', ['==', ['get', 'focus'], 1], 7, 3],
            8,
            ['case', ['==', ['get', 'focus'], 1], 12, 4],
          ],
          'circle-color': ['case', ['==', ['get', 'focus'], 1], 'rgba(255,209,102,0.25)', PREVIEW_COLOR],
          'circle-stroke-color': PREVIEW_COLOR,
          'circle-stroke-width': ['case', ['==', ['get', 'focus'], 1], 2.5, 0],
          'circle-pitch-alignment': 'map',
        },
      },
      SLOT.airports,
    );
    map.addLayer(
      {
        id: 'net-dests',
        type: 'circle',
        source: SRC_POINTS,
        filter: ['==', ['get', 'kind'], 'dest'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.5, 7, 5],
          'circle-color': '#ffffff',
          'circle-stroke-color': '#4da3ff',
          'circle-stroke-width': 1.5,
        },
      },
      SLOT.airports,
    );
    map.addLayer(
      {
        id: HUBS,
        type: 'circle',
        source: SRC_POINTS,
        filter: ['==', ['get', 'kind'], 'hub'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 8, 10, 11],
          'circle-color': '#4da3ff',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      SLOT.airports,
    );
    map.addLayer(
      {
        id: 'net-labels',
        type: 'symbol',
        source: SRC_POINTS,
        minzoom: 3,
        layout: {
          'text-field': ['get', 'iata'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['case', ['==', ['get', 'kind'], 'hub'], 12, 10],
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(5,10,25,0.9)', 'text-halo-width': 1.4 },
      },
      SLOT.airports,
    );
  }

  // ── Données ──

  /** Affiche le réseau du joueur (null pour l'effacer). */
  setNetwork(data: NetworkData | null): void {
    const key = data ? JSON.stringify(data) : '';
    if (key === this.lastKey) return;
    this.lastKey = key;
    const lines: Feature<LineString, LineProps>[] = [];
    const points: Feature<Point, PointProps>[] = [];
    if (data) {
      for (const l of data.lines) {
        lines.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: greatCirclePath(l.from.lon, l.from.lat, l.to.lon, l.to.lat) },
          properties: { id: l.id, served: l.served ? 1 : 0 },
        });
      }
      for (const d of data.dests) points.push(pointFeature(d, 'dest'));
      for (const h of data.hubs) points.push(pointFeature(h, 'hub'));
      for (const id of ['net-lines', 'net-dests']) {
        this.map.setPaintProperty(id, id === 'net-lines' ? 'line-color' : 'circle-stroke-color', data.color);
      }
      this.map.setPaintProperty(HUBS, 'circle-color', data.color);
    }
    this.source(SRC_LINES)?.setData({ type: 'FeatureCollection', features: lines });
    this.source(SRC_POINTS)?.setData({ type: 'FeatureCollection', features: points });
  }

  /** Aperçu temporaire (hub candidat, ligne envisagée…) ; null pour l'effacer. */
  setPreview(p: NetworkPreview | null): void {
    const features: Feature[] = [];
    if (p) {
      const o = p.origin ?? p.focus;
      for (const d of p.dests) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: greatCirclePath(o.lon, o.lat, d.lon, d.lat) },
          properties: {},
        });
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [d.lon, d.lat] }, properties: { focus: 0 } });
      }
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.focus.lon, p.focus.lat] }, properties: { focus: 1 } });
    }
    this.source(SRC_PREVIEW)?.setData({ type: 'FeatureCollection', features });
  }

  /** Met une ligne en surbrillance (null : aucune). */
  setSelectedLine(id: string | null): void {
    this.map.setFilter('net-lines-selected', ['==', ['get', 'id'], id ?? '']);
  }

  onHubClick(fn: (iata: string) => void): () => void {
    this.hubListeners.add(fn);
    return () => this.hubListeners.delete(fn);
  }

  onLineClick(fn: (id: string) => void): () => void {
    this.lineListeners.add(fn);
    return () => this.lineListeners.delete(fn);
  }

  // ── Toucher ──

  private onClick = (e: MapMouseEvent): void => {
    if (e.defaultPrevented) return; // un avion a été touché
    const pad = matchMedia('(pointer: coarse)').matches ? 16 : 8;
    const { x, y } = e.point;
    const box: [[number, number], [number, number]] = [
      [x - pad, y - pad],
      [x + pad, y + pad],
    ];
    const hub = this.map.queryRenderedFeatures(box, { layers: [HUBS] })[0];
    if (hub && this.hubListeners.size) {
      e.preventDefault();
      for (const fn of this.hubListeners) fn(String(hub.properties.iata));
      return;
    }
    const line = this.map.queryRenderedFeatures(e.point, { layers: [HIT_LINES] })[0];
    if (line && this.lineListeners.size) {
      e.preventDefault();
      for (const fn of this.lineListeners) fn(String(line.properties.id));
    }
  };

  private source(id: string): GeoJSONSource | undefined {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }
}

function pointFeature(p: NetworkPlace, kind: PointProps['kind']): Feature<Point, PointProps> {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { iata: p.iata, kind } };
}
