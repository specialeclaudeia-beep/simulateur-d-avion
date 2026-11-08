import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { SLOT } from './layerSlots';

/**
 * Pays cliquables.
 *
 * Contours Natural Earth 1:50m (domaine public) avec noms français, repris du
 * jeu simulateur-mss. Un toucher / clic sur un pays le met en surbrillance et
 * prévient le jeu (ce sera la base de « choisir le pays de sa compagnie »).
 */

export interface CountryInfo {
  /** Code ISO 3166-1 alpha-2 (FR, US…). */
  iso: string;
  /** Nom en français. */
  nom: string;
  /** Centre approximatif (pour centrer la vue). */
  lon: number;
  lat: number;
}

type Listener = (country: CountryInfo | null) => void;

export class Countries {
  private selectedId: number | string | null = null;
  private listeners = new Set<Listener>();

  constructor(private map: MapLibreMap) {}

  async install(): Promise<void> {
    const map = this.map;
    map.addSource('countries', {
      type: 'geojson',
      data: `${import.meta.env.BASE_URL}geo/countries.geojson`,
      tolerance: 0.6,
    });

    // Surface invisible : sert seulement à savoir quel pays est sous le doigt.
    map.addLayer(
      { id: 'countries-hit', type: 'fill', source: 'countries', paint: { 'fill-opacity': 0, 'fill-color': '#000' } },
      SLOT.routes,
    );
    map.addLayer(
      {
        id: 'countries-selected-fill',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': '#4da3ff',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.18, 0],
        },
      },
      SLOT.routes,
    );
    map.addLayer(
      {
        id: 'countries-selected-line',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': '#4da3ff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 6, 3],
          'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
        },
      },
      SLOT.routes,
    );

    map.on('click', this.onClick);
    map.on('mousemove', 'countries-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'countries-hit', () => (map.getCanvas().style.cursor = ''));
  }

  onSelect(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  clearSelection(): void {
    this.setSelected(null);
    for (const fn of this.listeners) fn(null);
  }

  private onClick = (e: MapMouseEvent): void => {
    if (e.defaultPrevented) return; // un avion a été touché
    const f = this.map.queryRenderedFeatures(e.point, { layers: ['countries-hit'] })[0];
    if (!f || f.id === undefined) {
      this.clearSelection();
      return;
    }
    this.setSelected(f.id);
    const info = f.properties as CountryInfo;
    for (const fn of this.listeners) fn(info);
  };

  private setSelected(id: number | string | null): void {
    if (!this.map.getSource('countries')) return;
    const src = 'countries';
    if (this.selectedId !== null) this.map.setFeatureState({ source: src, id: this.selectedId }, { selected: false });
    this.selectedId = id;
    if (id !== null) this.map.setFeatureState({ source: src, id }, { selected: true });
  }

  /** Accès à la source (pour d'éventuelles mises à jour). */
  get source(): GeoJSONSource | undefined {
    return this.map.getSource('countries') as GeoJSONSource | undefined;
  }
}

/** Drapeau emoji à partir du code ISO (FR → 🇫🇷). */
export function flagEmoji(iso: string): string {
  if (!/^[A-Z]{2}$/.test(iso)) return '🏳️';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
