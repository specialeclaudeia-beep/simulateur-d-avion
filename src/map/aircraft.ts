import { LngLat, type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import type { Feature, Point } from 'geojson';
import type { GameClock } from '../core/clock';
import { settings } from '../core/settings';
import { loadWorldData, type WorldData } from '../flights/data';
import { RealTraffic } from '../flights/realTraffic';
import type { Flight, FlightProvider } from '../flights/types';
import { bearing, greatCirclePath, hashUnit, interpolate, lateralOffset, toVec, angleBetween } from '../flights/geo';
import { AircraftGl, INSTANCE_BYTES, iconScale } from './aircraftGl';
import { ICON_KINDS, iconKindFor, liveryOf } from './aircraftIcons';
import { mercX, mercY, unmerc } from './gl';
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
 *
 * Fluidité : les avions sont dessinés par la carte graphique (aircraftGl.ts).
 * Ici, le processeur ne calcule que de temps en temps (une fois par seconde en
 * temps réel) où est chaque avion et à quelle vitesse il avance ; entre deux
 * calculs, la carte graphique le fait glisser à chaque image. La carte n'est
 * redessinée que si les avions ont bougé d'une fraction de pixel : vue du globe
 * en temps réel, le téléphone ne travaille presque pas.
 */

const SRC_TRACK = 'flight-track';
const SRC_LABELS = 'aircraft-labels';
const LAYER_LABELS = 'aircraft-labels';

/** Zoom à partir duquel les numéros de vol s'affichent. */
const LABELS_ZOOM = 6.5;
const MAX_LABELS = 250;
/** Vitesse d'un avion de ligne (m/s), pour estimer son déplacement à l'écran. */
const PLANE_MS = 260;
const TWO_PI = 2 * Math.PI;
/** En dessous de ce zoom, on voit le globe (presque) entier : la zone visible est une calotte. */
const GLOBE_ZOOM = 3.2;

type Listener = (flight: Flight | null) => void;

/** Avion sélectionné : soit un vol du trafic réel (index + départ), soit un vol fourni. */
type Selection = { kind: 'real'; i: number; depMs: number } | { kind: 'provided'; id: string };

export class AircraftLayer {
  private world: WorldData | null = null;
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
  /** Fraction du trafic réel affichée (ajustée pour ne pas saturer l'écran). */
  private sample = 1;
  private airborneCount = 0;

  private gl = new AircraftGl();
  // ── Avions affichés : un bloc d'octets pour la carte graphique + de quoi les retrouver au toucher ──
  private capacity = 0;
  private f32 = new Float32Array(0);
  private u8 = new Uint8Array(0);
  private count = 0;
  /** Index du vol réel (-1 : vol fourni) et heure de départ. */
  private instReal = new Int32Array(0);
  private instDep = new Float64Array(0);
  private instFlight: (Flight | null)[] = [];
  /** Position Mercator à l'instant de référence, vitesse par seconde de jeu, début et fin de vie (s). */
  private ax = new Float64Array(0);
  private ay = new Float64Array(0);
  private vx = new Float64Array(0);
  private vy = new Float64Array(0);
  private life0 = new Float32Array(0);
  private life1 = new Float32Array(0);
  /** Instant de référence des positions (temps de jeu, ms) et point de référence (Mercator). */
  private baseT = 0;
  private refX = 0.5;
  private refY = 0.5;

  // ── Par compagnie et par modèle du trafic réel (calculé une fois) ──
  private livery: Uint8Array = new Uint8Array(0);
  private modelIcon: Uint8Array = new Uint8Array(0);
  private modelSize: Float32Array = new Float32Array(0);

  private labelsShown = false;
  private trackAt = 0;
  private trackKey = '';
  private selfMove = false;
  private hoverAt = 0;
  private readonly p: [number, number] = [0, 0];
  private readonly sel = new Uint8Array(INSTANCE_BYTES);

  constructor(
    private map: MapLibreMap,
    private clock: GameClock,
  ) {
    this.installLayers();
    // Les avions passent avant les pays : un toucher sur un avion ne sélectionne pas le pays dessous.
    map.on('click', this.onClick);
    map.on('mousemove', this.onHover);
    map.on('moveend', () => {
      if (!this.selfMove) this.dirty = true;
    });
    map.on('move', () => {
      // Pendant un long déplacement : rafraîchit la zone affichée quelques fois par seconde.
      if (!this.selfMove && performance.now() - this.lastUpdate > 180) this.dirty = true;
    });
    map.on('dragstart', () => this.stopFollowing());
    clock.onChange(() => (this.dirty = true));
    settings.onChange((_s, changed) => {
      if (changed.detail) {
        this.gl.trails = settings.get().detail === 'high';
        this.dirty = true;
      }
    });
    this.gl.trails = settings.get().detail === 'high';
    this.gl.now = () => (this.clock.now() - this.baseT) / 1000;

    loadWorldData()
      .then((world) => {
        this.world = world;
        this.real = new RealTraffic(world);
        this.prepareTraffic(this.real, world);
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
    const empty = { type: 'FeatureCollection' as const, features: [] };
    map.addSource(SRC_TRACK, { type: 'geojson', data: empty });
    map.addSource(SRC_LABELS, { type: 'geojson', data: empty });

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

    // Les avions eux-mêmes : un seul calque, dessiné par la carte graphique.
    map.addLayer(this.gl, SLOT.aircraft);

    // Numéro de vol à côté de l'avion, en zoomant.
    map.addLayer(
      {
        id: LAYER_LABELS,
        type: 'symbol',
        source: SRC_LABELS,
        minzoom: LABELS_ZOOM,
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

  /** Livrée de chaque compagnie, silhouette et taille de chaque modèle du trafic réel. */
  private prepareTraffic(real: RealTraffic, world: WorldData): void {
    this.livery = new Uint8Array(real.airlineCodes.length * 6);
    real.airlineCodes.forEach((code, i) => {
      const l = liveryOf(code, real.airlineColors[i]);
      this.livery.set([...rgb(l.body), ...rgb(l.accent)], i * 6);
    });
    this.modelIcon = new Uint8Array(real.modelIds.length);
    this.modelSize = new Float32Array(real.modelIds.length);
    real.modelIds.forEach((id, i) => {
      const model = world.aircraft.get(id);
      this.modelIcon[i] = ICON_KINDS.indexOf(iconKindFor(model));
      this.modelSize[i] = sizeOf(model?.wingspanM);
    });
  }

  // --- toucher ---------------------------------------------------------------

  /** Avion affiché le plus proche d'un point de l'écran (index, ou -1 si aucun à moins de `pad` pixels). */
  private pick(x: number, y: number, pad: number): number {
    const map = this.map;
    const dt = (this.clock.now() - this.baseT) / 1000;
    const zoom = map.getZoom();
    // Vue rapprochée : on ne projette que les avions proches du point touché.
    let near: [number, number, number] | null = null;
    if (zoom >= 4) {
      const ll = map.unproject([x, y]);
      near = [mercX(ll.lng), mercY(ll.lat), ((pad + 80) * 4) / (512 * 2 ** zoom)];
    }
    let best = -1;
    let bestD = pad * pad;
    for (let n = 0; n < this.count; n++) {
      if (dt < this.life0[n] || dt >= this.life1[n]) continue;
      const mx = this.ax[n] + this.vx[n] * dt;
      const my = this.ay[n] + this.vy[n] * dt;
      if (near) {
        let dx = mx - near[0];
        dx -= Math.round(dx);
        if (Math.abs(dx) > near[2] || Math.abs(my - near[1]) > near[2]) continue;
      }
      const [lon, lat] = unmerc(mx, my);
      const pt = map.project([lon, lat]);
      const d = (pt.x - x) ** 2 + (pt.y - y) ** 2;
      if (d < bestD && !this.occluded(lon, lat)) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Le point est-il caché derrière le globe ? */
  private occluded(lon: number, lat: number): boolean {
    const transform = (this.map as unknown as { transform?: { isLocationOccluded?: (l: LngLat) => boolean } }).transform;
    return transform?.isLocationOccluded?.(new LngLat(lon, lat)) ?? false;
  }

  private onClick = (e: MapMouseEvent): void => {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const pad = Math.max(coarse ? 20 : 11, 12 * iconScale(this.map.getZoom()));
    const n = this.pick(e.point.x, e.point.y, pad);
    if (n < 0) {
      if (this.selection) this.clearSelection();
      return;
    }
    e.preventDefault(); // le pays sous l'avion n'est pas sélectionné
    const f = this.instFlight[n];
    this.selection = f ? { kind: 'provided', id: f.id } : { kind: 'real', i: this.instReal[n], depMs: this.instDep[n] };
    this.dirty = true;
    this.emit();
  };

  /** Souris au-dessus d'un avion : curseur « main » (ordinateur). */
  private onHover = (e: MapMouseEvent): void => {
    const now = performance.now();
    if (now - this.hoverAt < 70) return;
    this.hoverAt = now;
    const hit = this.pick(e.point.x, e.point.y, Math.max(10, 11 * iconScale(this.map.getZoom()))) >= 0;
    this.map.getCanvasContainer().classList.toggle('plane-hover', hit);
  };

  // --- animation -------------------------------------------------------------

  private tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    if (this.dirty || now - this.lastUpdate >= this.updateInterval()) {
      this.lastUpdate = now;
      this.dirty = false;
      this.update();
    }
    this.updateSelection(now);

    // Redessine seulement si les avions ont bougé d'une fraction de pixel depuis le dernier dessin.
    if (this.count && !this.clock.paused) {
      const moved = (this.pixelsPerSecond() * (now - this.gl.lastRenderAt)) / 1000;
      if (moved >= 0.25) this.map.triggerRepaint();
    }
  };

  /** Déplacement à l'écran d'un avion de ligne, en pixels par seconde réelle. */
  private pixelsPerSecond(): number {
    const zoom = this.map.getZoom();
    const lat = this.map.getCenter().lat;
    const metersPerPixel = (40_075_016 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    return (PLANE_MS * this.clock.speed) / metersPerPixel;
  }

  /**
   * Temps entre deux calculs des positions (ms réelles). Entre deux calculs, la
   * carte graphique prolonge le mouvement en ligne droite : on recalcule avant
   * que l'écart avec la vraie trajectoire (courbe) ne se voie.
   */
  private updateInterval(): number {
    if (this.clock.paused) return Infinity;
    const px = this.pixelsPerSecond();
    // Avec les numéros de vol affichés (qui, eux, ne glissent pas), on recalcule plus souvent.
    const labels = this.labelsWanted(px);
    const reach = labels ? 3 : 24;
    return Math.min(1000, Math.max(labels ? 100 : 150, (1000 * reach) / px));
  }

  private labelsWanted(px: number): boolean {
    return this.map.getZoom() >= LABELS_ZOOM && px <= 30;
  }

  /**
   * Nombre d'avions du trafic réel à garder dans la zone surveillée (un peu plus
   * large que l'écran, voir viewTest) pour que la carte reste lisible : chaque
   * avion dispose de plusieurs fois sa propre surface.
   */
  private maxPlanes(): number {
    const detail = settings.get().detail;
    const zoom = this.map.getZoom();
    const canvas = this.map.getCanvas();
    let area = canvas.clientWidth * canvas.clientHeight;
    let margin = 1.96;
    if (zoom < GLOBE_ZOOM) {
      // Vue globe : seule la surface du disque compte.
      const g = this.globe();
      area = Math.min(area, Math.PI * g.disc * g.disc);
      margin = 1.3;
    }
    const [room, cap] = detail === 'low' ? [12, 500] : detail === 'medium' ? [8, 1100] : [5.5, 2200];
    const icon = 32 * iconScale(zoom);
    return Math.round(Math.min(cap, Math.max(120, area / (room * icon * icon))) * margin);
  }

  /**
   * Le globe vu par la caméra : rayon du globe (pixels), distance de la caméra à
   * la surface, rayon du disque à l'écran.
   */
  private globe(): { radius: number; focal: number; disc: number } {
    const map = this.map;
    const lat = (map.getCenter().lat * Math.PI) / 180;
    const radius = (512 * 2 ** map.getZoom()) / TWO_PI / Math.max(0.2, Math.cos(lat));
    const focal = 1.5 * map.getCanvas().clientHeight;
    const d = focal + radius;
    return { radius, focal, disc: (focal * radius) / Math.sqrt(d * d - radius * radius) };
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    const cap = Math.max(512, Math.ceil(n * 1.5));
    const buffer = new ArrayBuffer(cap * INSTANCE_BYTES);
    new Uint8Array(buffer).set(this.u8.subarray(0, this.count * INSTANCE_BYTES));
    this.f32 = new Float32Array(buffer);
    this.u8 = new Uint8Array(buffer);
    const grow = <T extends Float64Array | Float32Array | Int32Array>(old: T, make: (n: number) => T): T => {
      const next = make(cap);
      next.set(old.subarray(0, this.count));
      return next;
    };
    this.instReal = grow(this.instReal, (k) => new Int32Array(k));
    this.instDep = grow(this.instDep, (k) => new Float64Array(k));
    this.ax = grow(this.ax, (k) => new Float64Array(k));
    this.ay = grow(this.ay, (k) => new Float64Array(k));
    this.vx = grow(this.vx, (k) => new Float64Array(k));
    this.vy = grow(this.vy, (k) => new Float64Array(k));
    this.life0 = grow(this.life0, (k) => new Float32Array(k));
    this.life1 = grow(this.life1, (k) => new Float32Array(k));
    this.capacity = cap;
  }

  /** Ajoute un avion au bloc envoyé à la carte graphique. */
  private push(
    real: number,
    depMs: number,
    flight: Flight | null,
    ax: number,
    ay: number,
    vx: number,
    vy: number,
    life0: number,
    life1: number,
    size: number,
    colors: ArrayLike<number>,
    colorsAt: number,
    icon: number,
    player: boolean,
  ): void {
    const n = this.count;
    this.ensureCapacity(n + 1);
    this.instReal[n] = real;
    this.instDep[n] = depMs;
    this.instFlight[n] = flight;
    this.ax[n] = ax;
    this.ay[n] = ay;
    this.vx[n] = vx;
    this.vy[n] = vy;
    this.life0[n] = life0;
    this.life1[n] = life1;
    const f = n * (INSTANCE_BYTES / 4);
    let rx = ax - this.refX;
    rx -= Math.round(rx); // le plus court chemin autour du monde
    this.f32[f] = rx;
    this.f32[f + 1] = ay - this.refY;
    this.f32[f + 2] = vx;
    this.f32[f + 3] = vy;
    this.f32[f + 4] = life0;
    this.f32[f + 5] = life1;
    this.f32[f + 6] = size;
    const b = n * INSTANCE_BYTES + 28;
    this.u8[b] = colors[colorsAt];
    this.u8[b + 1] = colors[colorsAt + 1];
    this.u8[b + 2] = colors[colorsAt + 2];
    this.u8[b + 3] = player ? 255 : 0;
    this.u8[b + 4] = colors[colorsAt + 3];
    this.u8[b + 5] = colors[colorsAt + 4];
    this.u8[b + 6] = colors[colorsAt + 5];
    this.u8[b + 7] = icon;
    this.count = n + 1;
  }

  /** Recalcule où est chaque avion visible et à quelle vitesse il avance. */
  private update(): void {
    const map = this.map;
    const t = this.clock.now();
    const speed = this.clock.speed;
    const px = this.pixelsPerSecond();
    // Durée (temps de jeu) couverte jusqu'au prochain calcul, avec un peu de marge.
    const planned = speed > 0 ? Math.min(1000, this.updateInterval()) * speed * 1.15 : 0;
    const horizon = Math.max(20_000, planned);
    const center = map.getCenter();
    this.baseT = t;
    this.refX = mercX(center.lng);
    this.refY = mercY(center.lat);
    this.count = 0;
    const view = this.viewTest();
    const out = this.p;
    let airborne = 0;

    // Trafic réel d'abord : les avions du joueur sont dessinés par-dessus.
    const real = this.real;
    if (real && this.world) {
      const sel = this.selection?.kind === 'real' ? this.selection : null;
      const threshold = this.sample * 4294967296;
      const vec = real.airportVec;
      let shownInView = 0;
      real.forEachActive(t, t + horizon, (i, depMs) => {
        const dur = real.durMin[i] * 60_000;
        const arrMs = depMs + dur;
        if (depMs <= t && t < arrMs) airborne++;
        const isSel = sel !== null && sel.i === i && sel.depMs === depMs;
        if (!isSel && (!this.visible || real.seed[i] > threshold)) return;
        // Début et fin du tronçon parcouru d'ici le prochain calcul.
        const t1 = Math.min(t + horizon, arrMs);
        let t0 = Math.max(t, depMs);
        if (t1 - t0 < 1000) t0 = Math.max(depMs, t1 - Math.max(1000, dur * 0.002));
        const ia = real.from[i] * 3;
        const ib = real.to[i] * 3;
        const omega = real.omega[i];
        const lateral = real.lateral(i, depMs);
        slerpMerc(vec, ia, ib, omega, (t0 - depMs) / dur, lateral, out);
        const x0 = out[0];
        const y0 = out[1];
        if (!isSel && !view(x0, y0)) return;
        shownInView++;
        slerpMerc(vec, ia, ib, omega, (t1 - depMs) / dur, lateral, out);
        let dx = out[0] - x0;
        dx -= Math.round(dx);
        const dts = (t1 - t0) / 1000;
        const vx = dx / dts;
        const vy = (out[1] - y0) / dts;
        const lead = (t0 - t) / 1000;
        const m = real.model[i];
        this.push(
          i,
          depMs,
          null,
          x0 - vx * lead,
          y0 - vy * lead,
          vx,
          vy,
          Math.max(-1e6, (depMs - t) / 1000),
          Math.min(1e6, (arrMs - t) / 1000),
          this.modelSize[m],
          this.livery,
          real.airline[i] * 6,
          this.modelIcon[m],
          false,
        );
      });
      // Échantillon stable : on garde toujours les mêmes avions quand on dézoome.
      if (this.visible) {
        const max = this.maxPlanes();
        const inView = shownInView / this.sample;
        const wanted = inView > max ? max / inView : 1;
        if (Math.abs(wanted - this.sample) > this.sample * 0.08 || (wanted === 1 && this.sample !== 1)) {
          this.sample = wanted;
          this.dirty = true; // un second passage avec le bon échantillon
        }
      }
    }

    // Vols fournis (joueur) : toujours affichés.
    this.provided.clear();
    if (this.world) {
      for (const provider of this.providers) {
        for (const f of provider(t)) {
          this.provided.set(f.id, f);
          if (t < f.depMs || t >= f.arrMs) continue;
          const a = this.world.airports.get(f.from);
          const b = this.world.airports.get(f.to);
          if (!a || !b) continue;
          airborne++;
          const va = toVec(a.lon, a.lat);
          const vb = toVec(b.lon, b.lat);
          const omega = angleBetween(va, vb);
          const lateral = lateralOf(f, omega);
          const dur = f.arrMs - f.depMs;
          const t1 = Math.min(t + horizon, f.arrMs);
          let t0 = t;
          if (t1 - t0 < 1000) t0 = Math.max(f.depMs, t1 - Math.max(1000, dur * 0.002));
          const ends = [va.x, va.y, va.z, vb.x, vb.y, vb.z];
          slerpMerc(ends, 0, 3, omega, (t0 - f.depMs) / dur, lateral, out);
          const x0 = out[0];
          const y0 = out[1];
          slerpMerc(ends, 0, 3, omega, (t1 - f.depMs) / dur, lateral, out);
          let dx = out[0] - x0;
          dx -= Math.round(dx);
          const dts = (t1 - t0) / 1000;
          const vx = dx / dts;
          const vy = (out[1] - y0) / dts;
          const lead = (t0 - t) / 1000;
          const model = this.world.aircraft.get(f.aircraftId);
          const colors = f.player ? [...rgb(f.color), 255, 255, 255] : [...rgb(f.color), ...rgb('#ffffff')];
          this.push(
            -1,
            f.depMs,
            f,
            x0 - vx * lead,
            y0 - vy * lead,
            vx,
            vy,
            (f.depMs - t) / 1000,
            (f.arrMs - t) / 1000,
            sizeOf(model?.wingspanM) * (f.player ? 1.25 : 1),
            colors,
            0,
            ICON_KINDS.indexOf(iconKindFor(model)),
            f.player === true,
          );
        }
      }
    }
    this.instFlight.length = this.count;
    this.airborneCount = airborne;
    this.gl.setInstances(this.u8, this.count, this.refX, this.refY);
    this.updateLabels(px, planned);
  }

  /** Numéros de vol (de près seulement, et quand les avions ne filent pas à l'écran). */
  private updateLabels(px: number, planned: number): void {
    const src = this.map.getSource(SRC_LABELS) as GeoJSONSource | undefined;
    if (!src) return;
    if (!this.labelsWanted(px) || !this.real) {
      if (this.labelsShown) src.setData({ type: 'FeatureCollection', features: [] });
      this.labelsShown = false;
      return;
    }
    const features: Feature<Point, { label: string }>[] = [];
    // À mi-chemin du prochain calcul : l'étiquette ne s'écarte jamais de plus d'un pixel ou deux.
    const mid = planned / 2000;
    const real = this.real;
    for (let n = 0; n < this.count && features.length < MAX_LABELS; n++) {
      if (this.life0[n] > 0) continue;
      const f = this.instFlight[n];
      const i = this.instReal[n];
      const label = f ? f.callsign : `${real.airlineCodes[real.airline[i]]} ${real.numbers[i]}`;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: unmerc(this.ax[n] + this.vx[n] * mid, this.ay[n] + this.vy[n] * mid) },
        properties: { label },
      });
    }
    src.setData({ type: 'FeatureCollection', features });
    this.labelsShown = true;
  }

  /**
   * Filtre « est-ce dans la zone visible ? » sur des coordonnées Mercator
   * (large, pour ne rien rater au bord ni pendant un déplacement).
   */
  private viewTest(): (x: number, y: number) => boolean {
    const map = this.map;
    const zoom = map.getZoom();
    if (zoom < GLOBE_ZOOM) {
      // Vue globe : la calotte que la caméra peut voir (elle dépend de l'inclinaison de la vue)…
      const c = map.getCenter();
      const vc = toVec(c.lng, c.lat);
      const g = this.globe();
      const k = g.focal / g.radius;
      const pitch = (map.getPitch() * Math.PI) / 180;
      const bearingRad = (map.getBearing() * Math.PI) / 180;
      const lon = (c.lng * Math.PI) / 180;
      const lat = (c.lat * Math.PI) / 180;
      // Direction « vers l'avant » de la vue, sur le sol, au centre de la carte.
      const hx = -Math.sin(lat) * Math.cos(lon) * Math.cos(bearingRad) - Math.sin(lon) * Math.sin(bearingRad);
      const hy = -Math.sin(lat) * Math.sin(lon) * Math.cos(bearingRad) + Math.cos(lon) * Math.sin(bearingRad);
      const hz = Math.cos(lat) * Math.cos(bearingRad);
      const up = 1 + k * Math.cos(pitch);
      const back = k * Math.sin(pitch);
      let ux = vc.x * up - hx * back;
      let uy = vc.y * up - hy * back;
      let uz = vc.z * up - hz * back;
      const dist = Math.hypot(ux, uy, uz);
      ux /= dist;
      uy /= dist;
      uz /= dist;
      const horizon = 1 / dist - 0.12;
      // … et, vue de dessus, seulement la partie du globe qui tient dans l'écran.
      let screen = -1;
      if (pitch < 0.02) {
        const canvas = map.getCanvas();
        const reach = 0.5 * Math.hypot(canvas.clientWidth, canvas.clientHeight);
        const sin = (reach * (g.focal + g.radius)) / (g.radius * Math.hypot(g.focal, reach));
        if (sin < 1) screen = Math.cos(Math.min(Math.PI, (Math.asin(sin) - Math.atan(reach / g.focal)) * 1.15 + 0.1));
      }
      return (x, y) => {
        const l = (x - 0.5) * TWO_PI;
        const e = Math.exp(Math.PI * (1 - 2 * y));
        const cosLat = (2 * e) / (e * e + 1);
        const sinLat = (e * e - 1) / (e * e + 1);
        const px = cosLat * Math.cos(l);
        const py = cosLat * Math.sin(l);
        if (px * ux + py * uy + sinLat * uz < horizon) return false;
        return px * vc.x + py * vc.y + sinLat * vc.z >= screen;
      };
    }
    const b = map.getBounds();
    const north = mercY(Math.min(89, b.getNorth()));
    const south = mercY(Math.max(-89, b.getSouth()));
    const padY = (south - north) * 0.2;
    const top = north - padY;
    const bottom = south + padY;
    const half = ((b.getEast() - b.getWest()) / 360) * 0.7;
    const cx = this.refX;
    if (half >= 0.5) return (_x, y) => y >= top && y <= bottom;
    return (x, y) => {
      if (y < top || y > bottom) return false;
      let dx = x - cx;
      dx -= Math.round(dx);
      return Math.abs(dx) <= half;
    };
  }

  /** Anneau et trajectoire de l'avion sélectionné, caméra qui suit : à chaque image, à la position exacte. */
  private updateSelection(now: number): void {
    const map = this.map;
    if (!this.selection) {
      if (this.trackKey) this.clearTrack();
      return;
    }
    const t = this.clock.now();
    const f = this.selectedFlight();
    const pos = f ? this.positionOf(f, t) : null;
    if (!f || !pos || !this.world) {
      this.clearTrack();
      if (f && t >= f.arrMs) this.clearSelection(); // posé : fin du suivi
      return;
    }

    // Anneau : une instance immobile à la position exacte de l'avion.
    const s = new Float32Array(this.sel.buffer);
    let rx = mercX(pos.lonLat[0]) - this.refX;
    rx -= Math.round(rx);
    s[0] = rx;
    s[1] = mercY(pos.lonLat[1]) - this.refY;
    s[2] = 0;
    s[3] = -1e-9;
    s[4] = -1;
    s[5] = 1;
    s[6] = 1;
    this.gl.setSelected(this.sel);

    // Trajectoire : quelques fois par seconde suffisent.
    const key = this.selection.kind === 'real' ? `r:${this.selection.i}:${this.selection.depMs}` : `p:${f.id}`;
    if (key !== this.trackKey || now - this.trackAt > 150) {
      this.trackKey = key;
      this.trackAt = now;
      const a = this.world.airports.get(f.from)!;
      const b = this.world.airports.get(f.to)!;
      const lat = lateralOf(f, angleBetween(toVec(a.lon, a.lat), toVec(b.lon, b.lat)));
      const done = greatCirclePath(a.lon, a.lat, b.lon, b.lat, 0, pos.progress, lat);
      const todo = greatCirclePath(a.lon, a.lat, b.lon, b.lat, pos.progress, 1, lat);
      // Raccorde les deux morceaux sans saut de longitude.
      const shift = done[done.length - 1][0] - todo[0][0];
      for (const pt of todo) pt[0] += shift;
      const props = { color: f.color };
      (map.getSource(SRC_TRACK) as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'LineString', coordinates: done }, properties: { ...props, part: 'done' } },
          { type: 'Feature', geometry: { type: 'LineString', coordinates: todo }, properties: { ...props, part: 'todo' } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: props },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [b.lon, b.lat] }, properties: props },
        ],
      });
    }

    if (this.following && !map.isMoving()) {
      // Déplacement « à nous » : il ne doit pas relancer un calcul complet à chaque image.
      this.selfMove = true;
      map.jumpTo({ center: pos.lonLat });
      this.selfMove = false;
    }
  }

  private clearTrack(): void {
    this.gl.setSelected(null);
    if (!this.trackKey) return;
    this.trackKey = '';
    (this.map.getSource(SRC_TRACK) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
    this.map.triggerRepaint();
  }
}

/** Écart latéral d'un vol : fourni par le trafic réel, sinon tiré de son identifiant. */
function lateralOf(f: Flight, omega: number): number {
  return f.lateral ?? lateralOffset(hashUnit(f.id), omega);
}

/** Taille relative à un A320 (36 m d'envergure). */
function sizeOf(wingspanM: number | undefined): number {
  return 0.55 + 0.45 * ((wingspanM ?? 36) / 36);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return Number.isNaN(n) ? [200, 200, 200] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Point à la fraction `f` du grand cercle entre deux positions 3D rangées dans
 * `vec` (aux index ia et ib), en coordonnées Mercator dans `out`. Même calcul
 * que `interpolate()` (flights/geo.ts), sans passer par les degrés.
 */
function slerpMerc(vec: ArrayLike<number>, ia: number, ib: number, omega: number, f: number, lateral: number, out: [number, number]): void {
  const ax = vec[ia];
  const ay = vec[ia + 1];
  const az = vec[ia + 2];
  let x = ax;
  let y = ay;
  let z = az;
  if (omega >= 1e-9) {
    const bx = vec[ib];
    const by = vec[ib + 1];
    const bz = vec[ib + 2];
    const s = Math.sin(omega);
    const ka = Math.sin((1 - f) * omega) / s;
    const kb = Math.sin(f * omega) / s;
    x = ka * ax + kb * bx;
    y = ka * ay + kb * by;
    z = ka * az + kb * bz;
    if (lateral !== 0) {
      const d = (lateral * Math.sin(Math.PI * f)) / s;
      x += (ay * bz - az * by) * d;
      y += (az * bx - ax * bz) * d;
      z += (ax * by - ay * bx) * d;
    }
  }
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  const sinLat = Math.max(-0.999999, Math.min(0.999999, z / len));
  out[0] = Math.atan2(y, x) / TWO_PI + 0.5;
  out[1] = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
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
