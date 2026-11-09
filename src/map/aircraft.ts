import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { Feature, Point } from 'geojson';
import type { GameClock } from '../core/clock';
import { loadWorldData, type WorldData } from '../flights/data';
import { RealTraffic } from '../flights/realTraffic';
import type { Flight, FlightProvider } from '../flights/types';
import { bearing, greatCirclePath, hashUnit, interpolate, lateralOffset, toVec, angleBetween, type Vec3 } from '../flights/geo';
import { accentId, addAircraftIcons, iconId, iconKindFor, liveryOf } from './aircraftIcons';
import { SLOT } from './layerSlots';

/**
 * Calque des avions en vol.
 *
 * - Trafic réel : ~100 000 vols par jour des vraies compagnies, sur leurs vraies
 *   lignes (data/traffic.json), synchronisés sur l'horloge du jeu.
 * - Vols du joueur : ajoutés par `addProvider()` (fil « mécaniques de jeu »).
 *
 * Chaque avion est dessiné à sa taille (envergure du modèle), à la couleur de sa
 * compagnie, orienté selon son cap sur l'arc de grand cercle. Toucher un avion
 * le sélectionne : sa trajectoire s'affiche et la fiche du vol s'ouvre.
 */

const SRC = 'aircraft';
const SRC_TRACK = 'flight-track';
const LAYER = 'aircraft-icons';
const LAYER_LABELS = 'aircraft-labels';
const LAYER_ACCENT = 'aircraft-accents';

/** Taille des avions : envergure réelle du modèle, puis grossie avec le zoom. */
const ICON_SIZE = [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  1,
  ['*', ['get', 'size'], 0.32],
  4,
  ['*', ['get', 'size'], 0.5],
  7,
  ['*', ['get', 'size'], 0.8],
  10,
  ['*', ['get', 'size'], 1.3],
  14,
  ['*', ['get', 'size'], 3],
  
] as ExpressionSpecification;
const LAYER_SELECTED = 'aircraft-selected';

/** Nombre maximal d'avions dessinés à la fois (au-delà, on en montre un échantillon stable). */
const MAX_FEATURES = matchMedia('(pointer: coarse)').matches ? 2500 : 5000;

type Listener = (flight: Flight | null) => void;

/** Avion sélectionné : soit un vol du trafic réel (index + départ), soit un vol fourni. */
type Selection = { kind: 'real'; i: number; depMs: number } | { kind: 'provided'; id: string };

interface PlaneProps {
  /** Identifiant de l'avion dans la source (pour retrouver le vol au toucher). */
  key: string;
  icon: string;
  /** Silhouette des accents (dérive, moteurs, bouts d'ailes). */
  accentIcon: string;
  color: string;
  /** Couleur des accents (livrée de la compagnie). */
  accent: string;
  size: number;
  rot: number;
  label: string;
  player: number;
}

export class AircraftLayer {
  private world: WorldData | null = null;
  /** Livrée de chaque compagnie (calculée une fois). */
  private liveries = new Map<string, { from: string; body: string; accent: string }>();
  private real: RealTraffic | null = null;
  private providers = new Set<FlightProvider>();
  private listeners = new Set<Listener>();
  private selection: Selection | null = null;
  private following = false;
  private visible = true;
  /** Dernier lot de vols fournis (pour retrouver un vol touché). */
  private provided = new Map<string, Flight>();
  private lastUpdate = 0;
  private dirty = true;
  /** Fraction du trafic réel affichée (ajustée pour rester sous MAX_FEATURES). */
  private sample = 1;
  private airborneCount = 0;
  private readonly p: [number, number] = [0, 0];
  private readonly q: [number, number] = [0, 0];

  constructor(
    private map: MapLibreMap,
    private clock: GameClock,
  ) {
    this.installLayers();
    // Les avions passent avant les pays : un toucher sur un avion ne sélectionne pas le pays dessous.
    map.on('click', this.onClick);
    map.on('mouseenter', LAYER, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', LAYER, () => (map.getCanvas().style.cursor = ''));
    map.on('moveend', () => (this.dirty = true));
    map.on('dragstart', () => this.stopFollowing());
    clock.onChange(() => (this.dirty = true));

    loadWorldData()
      .then((world) => {
        this.world = world;
        this.real = new RealTraffic(world);
        this.dirty = true;
      })
      .catch((err: unknown) => console.error('Trafic aérien indisponible', err));

    requestAnimationFrame(this.tick);
  }

  /** Ajoute une source de vols (ex. les vols de la compagnie du joueur). */
  addProvider(fn: FlightProvider): () => void {
    this.providers.add(fn);
    this.dirty = true;
    return () => this.providers.delete(fn);
  }

  /** Prévient quand un avion est sélectionné (ou désélectionné : null). */
  onSelect(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Données réelles chargées (aéroports, modèles…), ou null pendant le chargement. */
  get data(): WorldData | null {
    return this.world;
  }

  /** Nombre d'avions en l'air (trafic réel + joueur) au dernier calcul. */
  get airborne(): number {
    return this.airborneCount;
  }

  /** Vols réels par jour (moyenne). */
  get flightsPerDay(): number {
    return this.real?.perDay ?? 0;
  }

  get showTraffic(): boolean {
    return this.visible;
  }

  /** Affiche ou masque le trafic des autres compagnies (les vols du joueur restent visibles). */
  setShowTraffic(on: boolean): void {
    this.visible = on;
    this.dirty = true;
  }

  get isFollowing(): boolean {
    return this.following;
  }

  /** La caméra suit l'avion sélectionné. */
  follow(on: boolean): void {
    this.following = on && this.selection !== null;
    if (this.following) {
      const f = this.selectedFlight();
      if (f) {
        const pos = this.positionOf(f, this.clock.now());
        if (pos) this.map.easeTo({ center: pos.lonLat, zoom: Math.max(this.map.getZoom(), 6), duration: 900 });
      }
    }
    this.emit();
  }

  /** Vol sélectionné, avec ses informations à jour. */
  selectedFlight(): Flight | null {
    const s = this.selection;
    if (!s) return null;
    if (s.kind === 'real') return this.real?.flight(s.i, s.depMs) ?? null;
    return this.provided.get(s.id) ?? null;
  }

  /** Position, cap, altitude et vitesse d'un vol à l'instant t (null s'il est au sol). */
  positionOf(f: Flight, t: number): FlightPosition | null {
    if (!this.world || t < f.depMs || t >= f.arrMs) return null;
    const a = this.world.airports.get(f.from);
    const b = this.world.airports.get(f.to);
    const model = this.world.aircraft.get(f.aircraftId);
    if (!a || !b) return null;
    const va = toVec(a.lon, a.lat);
    const vb = toVec(b.lon, b.lat);
    const omega = angleBetween(va, vb);
    const frac = (t - f.depMs) / (f.arrMs - f.depMs);
    const lat = lateralOf(f, omega);
    const p = interpolate(va, vb, omega, frac, [0, 0], lat);
    const ahead = interpolate(va, vb, omega, Math.min(1, frac + 0.002), [0, 0], lat);
    return {
      lonLat: [p[0], p[1]],
      heading: frac < 0.998 ? bearing(p[0], p[1], ahead[0], ahead[1]) : bearing(a.lon, a.lat, b.lon, b.lat),
      progress: frac,
      ...flightProfile(t - f.depMs, f.arrMs - t, model?.cruiseKmh ?? 830, model?.category ?? 'narrowbody'),
    };
  }

  /** Sélectionne un vol par programme (ex. depuis la liste des vols du joueur). */
  selectProvided(id: string): void {
    this.selection = { kind: 'provided', id };
    this.dirty = true;
    this.emit();
  }

  clearSelection(): void {
    if (!this.selection) return;
    this.selection = null;
    this.following = false;
    this.dirty = true;
    this.emit();
  }

  private stopFollowing(): void {
    if (this.following) {
      this.following = false;
      this.emit();
    }
  }

  private emit(): void {
    const f = this.selectedFlight();
    for (const fn of this.listeners) fn(f);
  }

  // --- calques ---------------------------------------------------------------

  private installLayers(): void {
    const map = this.map;
    addAircraftIcons(map);
    const empty = { type: 'FeatureCollection' as const, features: [] };
    map.addSource(SRC, { type: 'geojson', data: empty });
    map.addSource(SRC_TRACK, { type: 'geojson', data: empty });

    // Trajectoire de l'avion sélectionné : déjà parcourue (pleine) et restante (pointillés).
    map.addLayer(
      {
        id: 'flight-track-done',
        type: 'line',
        source: SRC_TRACK,
        filter: ['==', ['get', 'part'], 'done'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.9 },
      },
      SLOT.routes,
    );
    map.addLayer(
      {
        id: 'flight-track-todo',
        type: 'line',
        source: SRC_TRACK,
        filter: ['==', ['get', 'part'], 'todo'],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [2, 2] },
      },
      SLOT.routes,
    );
    map.addLayer(
      {
        id: 'flight-track-airports',
        type: 'circle',
        source: SRC_TRACK,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2.5,
        },
      },
      SLOT.airports,
    );

    // Halo autour de l'avion sélectionné.
    map.addLayer(
      {
        id: LAYER_SELECTED,
        type: 'circle',
        source: SRC,
        filter: ['==', ['get', 'key'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 9, 6, 16, 10, 26],
          'circle-color': 'rgba(255,255,255,0.12)',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-pitch-alignment': 'map',
        },
      },
      SLOT.aircraft,
    );

    map.addLayer(
      {
        id: LAYER,
        type: 'symbol',
        source: SRC,
        layout: {
          'icon-image': ['get', 'icon'],
          // Taille : envergure réelle du modèle, puis grossie avec le zoom.
          'icon-size': ICON_SIZE,
          'icon-rotate': ['get', 'rot'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'size'],
        },
        paint: {
          'icon-color': ['get', 'color'],
          'icon-halo-color': ['case', ['==', ['get', 'player'], 1], '#ffffff', 'rgba(5,10,25,0.85)'],
          'icon-halo-width': ['case', ['==', ['get', 'player'], 1], 1.6, 0.9],
          'icon-halo-blur': 0.3,
        },
      },
      SLOT.aircraft,
    );

    // Livrée : dérive, moteurs et bouts d'ailes dans la seconde couleur de la compagnie.
    map.addLayer(
      {
        id: LAYER_ACCENT,
        type: 'symbol',
        source: SRC,
        layout: {
          'icon-image': ['get', 'accentIcon'],
          'icon-size': ICON_SIZE,
          'icon-rotate': ['get', 'rot'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'size'],
        },
        paint: { 'icon-color': ['get', 'accent'] },
      },
      SLOT.aircraft,
    );

    // Numéro de vol à côté de l'avion, en zoomant.
    map.addLayer(
      {
        id: LAYER_LABELS,
        type: 'symbol',
        source: SRC,
        minzoom: 6.5,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-padding': 4,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(5,10,25,0.9)',
          'text-halo-width': 1.4,
        },
      },
      SLOT.aircraft,
    );
  }

  // --- toucher ---------------------------------------------------------------

  private onClick = (e: MapMouseEvent): void => {
    const pad = matchMedia('(pointer: coarse)').matches ? 18 : 10;
    const { x, y } = e.point;
    const hits = this.map.queryRenderedFeatures(
      [
        [x - pad, y - pad],
        [x + pad, y + pad],
      ],
      { layers: [LAYER] },
    );
    if (!hits.length) {
      if (this.selection) this.clearSelection();
      return;
    }
    // L'avion le plus proche du doigt.
    let best = hits[0];
    let bestD = Infinity;
    for (const h of hits) {
      if (h.geometry.type !== 'Point') continue;
      const pt = this.map.project(h.geometry.coordinates as [number, number]);
      const d = (pt.x - x) ** 2 + (pt.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    e.preventDefault(); // le pays sous l'avion n'est pas sélectionné
    const key = String(best.properties?.key ?? '');
    if (key.startsWith('r:')) {
      const [, i, dep] = key.split(':');
      this.selection = { kind: 'real', i: Number(i), depMs: Number(dep) };
    } else if (key.startsWith('p:')) {
      this.selection = { kind: 'provided', id: key.slice(2) };
    }
    this.dirty = true;
    this.emit();
  };

  // --- animation -------------------------------------------------------------

  private tick = (): void => {
    requestAnimationFrame(this.tick);
    const now = performance.now();
    const interval = this.updateInterval();
    if (!this.dirty && now - this.lastUpdate < interval) return;
    this.lastUpdate = now;
    this.dirty = false;
    this.update();
  };

  /**
   * Fréquence de mise à jour : assez souvent pour qu'un avion ne saute pas de plus
   * d'environ un pixel, sans recalculer inutilement (un avion à ×1 vu du globe
   * bouge d'un pixel toutes les dizaines de secondes).
   */
  private updateInterval(): number {
    const speed = this.clock.speed;
    if (speed === 0) return Infinity;
    const zoom = this.map.getZoom();
    const lat = this.map.getCenter().lat;
    const metersPerPixel = (40_075_016 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    const planeMs = 240 * speed; // ~870 km/h
    const min = this.following || this.selection ? 33 : MAX_FEATURES > 3000 ? 33 : 50;
    return Math.min(2000, Math.max(min, (1000 * metersPerPixel * 0.8) / planeMs));
  }

  private update(): void {
    const t = this.clock.now();
    const features: Feature<Point, PlaneProps>[] = [];
    const view = this.viewFilter();

    // Vols fournis (joueur) : toujours affichés.
    this.provided.clear();
    for (const provider of this.providers) {
      for (const f of provider(t)) {
        this.provided.set(f.id, f);
        const pos = this.positionOf(f, t);
        if (!pos) continue;
        features.push(this.feature(`p:${f.id}`, f.aircraftId, 'player', f.color, pos.lonLat, pos.heading, f.callsign, true));
      }
    }

    // Trafic réel.
    let airborne = features.length;
    let inView = 0;
    const real = this.real;
    if (real && this.world) {
      const sel = this.selection?.kind === 'real' ? this.selection : null;
      const sample = this.sample;
      const threshold = sample * 4294967296;
      const p = this.p;
      const q = this.q;
      const vA: Vec3 = { x: 0, y: 0, z: 0 };
      const vB: Vec3 = { x: 0, y: 0, z: 0 };
      real.forEachAirborne(t, (i, depMs) => {
        airborne++;
        if (!this.visible && !(sel && sel.i === i && sel.depMs === depMs)) return;
        const ia = real.from[i] * 3;
        const ib = real.to[i] * 3;
        vA.x = real.airportVec[ia];
        vA.y = real.airportVec[ia + 1];
        vA.z = real.airportVec[ia + 2];
        vB.x = real.airportVec[ib];
        vB.y = real.airportVec[ib + 1];
        vB.z = real.airportVec[ib + 2];
        const frac = real.progress(i, depMs, t);
        const lat = real.lateral(i, depMs);
        interpolate(vA, vB, real.omega[i], frac, p, lat);
        if (!view(p[0], p[1])) return;
        inView++;
        const isSel = sel !== null && sel.i === i && sel.depMs === depMs;
        if (!isSel && real.seed[i] > threshold) return;
        interpolate(vA, vB, real.omega[i], Math.min(1, frac + 0.002), q, lat);
        const rot = bearing(p[0], p[1], q[0], q[1]);
        const code = real.airlineCodes[real.airline[i]];
        features.push(
          this.feature(
            `r:${i}:${depMs}`,
            real.modelIds[real.model[i]],
            code,
            real.airlineColors[real.airline[i]],
            [p[0], p[1]],
            rot,
            `${code} ${real.numbers[i]}`,
            false,
          ),
        );
      });
      // Échantillon stable : on garde toujours les mêmes avions quand on dézoome.
      this.sample = inView > MAX_FEATURES ? MAX_FEATURES / inView : 1;
    }
    this.airborneCount = airborne;

    (this.map.getSource(SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    this.updateSelection(t);
  }

  private feature(
    key: string,
    modelId: string,
    airline: string,
    color: string,
    lonLat: [number, number],
    rot: number,
    label: string,
    player: boolean,
  ): Feature<Point, PlaneProps> {
    const model = this.world?.aircraft.get(modelId);
    const kind = iconKindFor(model);
    let livery = this.liveries.get(airline);
    if (!livery || livery.from !== color) {
      livery = { from: color, ...(airline === 'player' ? { body: color, accent: '#ffffff' } : liveryOf(airline, color)) };
      this.liveries.set(airline, livery);
    }
    // Taille relative à un A320 (36 m d'envergure) ; un peu plus gros pour le joueur.
    const span = model?.wingspanM ?? 36;
    const size = (0.55 + 0.45 * (span / 36)) * (player ? 1.25 : 1);
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: lonLat },
      properties: { key, icon: iconId(kind), accentIcon: accentId(kind), color: livery.body, accent: livery.accent, size, rot, label, player: player ? 1 : 0 },
    };
  }

  /** Filtre « est-ce dans la zone visible ? » (large, pour ne rien rater au bord). */
  private viewFilter(): (lon: number, lat: number) => boolean {
    const zoom = this.map.getZoom();
    if (zoom < 3.2) {
      // Vue globe : l'hémisphère tourné vers nous (produit scalaire avec le centre).
      const c = this.map.getCenter();
      const vc = toVec(c.lng, c.lat);
      return (lon, lat) => {
        const v = toVec(lon, lat);
        return v.x * vc.x + v.y * vc.y + v.z * vc.z > -0.15;
      };
    }
    const b = this.map.getBounds();
    const padLat = (b.getNorth() - b.getSouth()) * 0.15;
    const south = b.getSouth() - padLat;
    const north = b.getNorth() + padLat;
    let west = b.getWest();
    let east = b.getEast();
    const padLon = (east - west) * 0.15;
    west -= padLon;
    east += padLon;
    if (east - west >= 360) return (_lon, lat) => lat >= south && lat <= north;
    return (lon, lat) => {
      if (lat < south || lat > north) return false;
      let l = lon;
      while (l < west) l += 360;
      while (l > west + 360) l -= 360;
      return l <= east;
    };
  }

  /** Trajectoire et halo de l'avion sélectionné, caméra qui suit. */
  private updateSelection(t: number): void {
    const map = this.map;
    const track = map.getSource(SRC_TRACK) as GeoJSONSource | undefined;
    const f = this.selectedFlight();
    const pos = f ? this.positionOf(f, t) : null;
    if (!f || !pos || !this.world) {
      map.setFilter(LAYER_SELECTED, ['==', ['get', 'key'], '']);
      track?.setData({ type: 'FeatureCollection', features: [] });
      if (this.selection && f && t >= f.arrMs) this.clearSelection(); // posé : fin du suivi
      return;
    }
    const key = this.selection?.kind === 'real' ? `r:${this.selection.i}:${this.selection.depMs}` : `p:${f.id}`;
    map.setFilter(LAYER_SELECTED, ['==', ['get', 'key'], key]);

    const a = this.world.airports.get(f.from)!;
    const b = this.world.airports.get(f.to)!;
    const lat = lateralOf(f, angleBetween(toVec(a.lon, a.lat), toVec(b.lon, b.lat)));
    const done = greatCirclePath(a.lon, a.lat, b.lon, b.lat, 0, pos.progress, lat);
    const todo = greatCirclePath(a.lon, a.lat, b.lon, b.lat, pos.progress, 1, lat);
    // Raccorde les deux morceaux sans saut de longitude.
    const shift = done[done.length - 1][0] - todo[0][0];
    for (const pt of todo) pt[0] += shift;
    const props = { color: f.color };
    track?.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: done }, properties: { ...props, part: 'done' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: todo }, properties: { ...props, part: 'todo' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: props },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [b.lon, b.lat] }, properties: props },
      ],
    });

    if (this.following && !map.isMoving()) map.jumpTo({ center: pos.lonLat });
  }
}

/** Écart latéral d'un vol : fourni par le trafic réel, sinon tiré de son identifiant. */
function lateralOf(f: Flight, omega: number): number {
  return f.lateral ?? lateralOffset(hashUnit(f.id), omega);
}

export interface FlightPosition {
  lonLat: [number, number];
  /** Cap en degrés (0 = nord). */
  heading: number;
  /** Fraction du trajet effectuée (0 → 1). */
  progress: number;
  /** Altitude en pieds. */
  altitudeFt: number;
  /** Vitesse sol en km/h. */
  speedKmh: number;
  phase: 'montée' | 'croisière' | 'descente';
}

/**
 * Profil de vol simplifié : montée pendant ~20 min, croisière, descente sur les
 * ~25 dernières minutes. Les turbopropulseurs volent plus bas.
 */
function flightProfile(
  sinceDepMs: number,
  untilArrMs: number,
  cruiseKmh: number,
  category: string,
): Pick<FlightPosition, 'altitudeFt' | 'speedKmh' | 'phase'> {
  const cruiseFt = category === 'regional_turboprop' ? 24_000 : category === 'regional_jet' ? 35_000 : 37_000;
  const climb = 20 * 60_000;
  const descent = 25 * 60_000;
  const total = sinceDepMs + untilArrMs;
  // Vol très court : pas de vraie croisière, on monte puis on redescend.
  const k = Math.min(1, total / (climb + descent));
  const up = Math.min(1, sinceDepMs / (climb * k));
  const down = Math.min(1, untilArrMs / (descent * k));
  const level = Math.min(up, down) * (k < 1 ? 0.4 + 0.6 * k : 1);
  const altitudeFt = Math.round((cruiseFt * level) / 100) * 100;
  const speedKmh = Math.round(cruiseKmh * (0.45 + 0.55 * Math.min(up, down) ** 0.6));
  const phase = up < 1 && up <= down ? 'montée' : down < 1 ? 'descente' : 'croisière';
  return { altitudeFt, speedKmh, phase };
}
