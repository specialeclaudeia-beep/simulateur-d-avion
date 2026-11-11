import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { Programs, setProjection, mercY } from './gl';

/**
 * La nuit, dessinée par la carte graphique.
 *
 * Un seul calque couvre la Terre entière (pôles compris). Pour chaque pixel, le
 * programme calcule la hauteur du soleil : ombre bleu nuit avec un crépuscule en
 * dégradé, et lumières des villes là où il fait nuit (image mondiale vue de
 * loin, images détaillées de la zone affichée en zoomant).
 *
 * Rien n'est recalculé ni renvoyé à la carte graphique quand le soleil bouge :
 * seule sa position change. La nuit reste donc fluide à toutes les vitesses du
 * temps, sans le moindre travail du processeur.
 */

const DEG = Math.PI / 180;
const COLS = 72;

const NIGHT_COLOR = [3 / 255, 6 / 255, 22 / 255] as const;
const NIGHT_MAX_ALPHA = 0.8;
/** Hauteur du soleil (°) où l'ombre commence / atteint son maximum. */
const SHADE_START = 0.8;
const SHADE_FULL = -12;
/** Hauteur du soleil (°) où les lumières s'allument / sont à fond. */
const LIGHTS_ON = -1;
const LIGHTS_FULL = -7;

const VERTEX = `
in vec2 a_pos;
uniform float u_shift;
out vec2 v_merc;
void main() {
  vec2 p = vec2(a_pos.x + u_shift, a_pos.y);
  v_merc = p;
  gl_Position = projectTile(p);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_merc;
uniform vec3 u_sun;
uniform vec4 u_edges;
uniform vec4 u_night;
uniform vec3 u_lightsAlpha;
uniform sampler2D u_lights;
uniform sampler2D u_detail;
uniform vec4 u_detailBounds;
out vec4 fragColor;
const float PI = 3.141592653589793;
void main() {
  float lon = (v_merc.x - 0.5) * 2.0 * PI;
  float t = exp(PI - v_merc.y * 2.0 * PI);
  float t2 = t * t;
  float sinLat = (t2 - 1.0) / (t2 + 1.0);
  float cosLat = 2.0 * t / (t2 + 1.0);
  // Sinus de la hauteur du soleil au-dessus de l'horizon.
  float s = sinLat * u_sun.z + cosLat * (cos(lon) * u_sun.x + sin(lon) * u_sun.y);
  float shade = (1.0 - smoothstep(u_edges.y, u_edges.x, s)) * u_night.a;
  float lit = 1.0 - smoothstep(u_edges.w, u_edges.z, s);
  // Lumières : image mondiale, recouverte par la zone détaillée là où elle existe.
  vec4 lights = texture(u_lights, v_merc) * u_lightsAlpha.x;
  vec2 uv = (v_merc - u_detailBounds.xy) / (u_detailBounds.zw - u_detailBounds.xy);
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 near = texture(u_detail, clamp(uv, 0.0, 1.0)) * inside;
  // De près, la lueur des villes éclaire le sol : il reste visible, sous une teinte chaude.
  float glow = near.a * lit * u_lightsAlpha.z;
  shade *= 1.0 - 0.6 * glow;
  vec4 warm = vec4(1.0, 0.68, 0.32, 1.0) * (0.14 * glow);
  vec4 color = warm + vec4(u_night.rgb * shade, shade) * (1.0 - warm.a);
  vec4 d = near * u_lightsAlpha.y;
  lights = (d + lights * (1.0 - d.a)) * lit;
  fragColor = lights + color * (1.0 - lights.a);
}`;

/** Lumières détaillées d'une zone : des tuiles (lumières sur fond transparent) posées côte à côte. */
export interface DetailLights {
  /** Zone couverte, en coordonnées Mercator : [x0, y0, x1, y1]. */
  bounds: [number, number, number, number];
  /** Taille de l'image entière, en pixels. */
  width: number;
  height: number;
  tiles: { x: number; y: number; image: HTMLCanvasElement }[];
}

export class NightGl implements CustomLayerInterface {
  readonly id = 'night-gl';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private map: MapLibreMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private programs: Programs | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private indexCount = 0;
  private sun: [number, number, number] = [1, 0, 0];

  private lightsTex: WebGLTexture | null = null;
  private detailTex: WebGLTexture | null = null;
  private pendingLights: HTMLCanvasElement | null = null;
  private pendingDetail: DetailLights | null | undefined = undefined;
  private detailBounds: [number, number, number, number] | null = null;
  private hasLights = false;
  /** Dernières images reçues (à renvoyer si la carte graphique est réinitialisée). */
  private lights: HTMLCanvasElement | null = null;
  private detail: DetailLights | null = null;
  private failed = false;
  /** Faux en détail « faible » : seules les lumières vues de loin sont dessinées. */
  detailEnabled = true;

  /** Position du soleil (point subsolaire, en degrés). */
  setSun(lon: number, lat: number): void {
    const c = Math.cos(lat * DEG);
    this.sun = [c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG)];
    this.map?.triggerRepaint();
  }

  /** Lumières du monde entier (image Mercator sur fond transparent), envoyées à la carte graphique au prochain dessin. */
  setLights(img: HTMLCanvasElement): void {
    this.lights = img;
    this.pendingLights = img;
    this.map?.triggerRepaint();
  }

  /** Lumières détaillées de la zone affichée (null : aucune). */
  setDetail(img: DetailLights | null): void {
    this.detail = img;
    this.pendingDetail = img;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap): void {
    this.map = map;
    // Carte graphique reprise par le système (appli longtemps en arrière-plan) : tout est à refaire.
    map.on('webglcontextlost', this.forget);
  }

  private forget = (): void => {
    this.programs = null;
    this.vao = null;
    this.lightsTex = null;
    this.detailTex = null;
    this.hasLights = false;
    this.detailBounds = null;
    this.pendingLights = this.lights;
    this.pendingDetail = this.detail ?? undefined;
  };

  /**
   * Prépare programmes, grille et textures. Fait au premier dessin et non dans
   * onAdd : MapLibre remet alors lui-même la carte graphique dans l'état qu'il attend.
   */
  private init(g: WebGL2RenderingContext): void {
    this.gl = g;
    this.programs = new Programs(
      g,
      VERTEX,
      FRAGMENT,
      ['u_shift', 'u_sun', 'u_edges', 'u_night', 'u_lightsAlpha', 'u_lights', 'u_detail', 'u_detailBounds'],
      ['a_pos'],
    );

    // Grille couvrant le monde : colonnes régulières, rangées plus serrées près des pôles.
    const lats: number[] = [89.95, 89.5, 88, 86];
    for (let lat = 84; lat >= -84; lat -= 3) lats.push(lat);
    lats.push(-86, -88, -89.5, -89.95);
    const rows = lats.length;
    const verts = new Float32Array((COLS + 1) * rows * 2);
    let o = 0;
    for (let r = 0; r < rows; r++) {
      const y = mercY(lats[r]);
      for (let c = 0; c <= COLS; c++) {
        verts[o++] = c / COLS;
        verts[o++] = y;
      }
    }
    const idx = new Uint16Array(COLS * (rows - 1) * 6);
    o = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c;
        const b = a + COLS + 1;
        idx[o++] = a;
        idx[o++] = b;
        idx[o++] = a + 1;
        idx[o++] = a + 1;
        idx[o++] = b;
        idx[o++] = b + 1;
      }
    }
    this.indexCount = idx.length;

    this.vao = g.createVertexArray();
    g.bindVertexArray(this.vao);
    const vbo = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, vbo);
    g.bufferData(g.ARRAY_BUFFER, verts, g.STATIC_DRAW);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    const ibo = g.createBuffer();
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, idx, g.STATIC_DRAW);
    g.bindVertexArray(null);

    // Textures : un pixel transparent en attendant les images.
    this.lightsTex = this.texture(g, true, 1, 1);
    this.detailTex = this.texture(g, false, 1, 1);
  }

  onRemove(): void {
    this.map?.off('webglcontextlost', this.forget);
    const g = this.gl;
    if (g) {
      this.programs?.dispose();
      if (this.vao) g.deleteVertexArray(this.vao);
      if (this.lightsTex) g.deleteTexture(this.lightsTex);
      if (this.detailTex) g.deleteTexture(this.detailTex);
    }
    this.map = null;
    this.gl = null;
    this.programs = null;
    this.vao = null;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const g = gl as WebGL2RenderingContext;
    const map = this.map;
    if (!map) return;
    if (this.failed) return;
    try {
      if (!this.programs) this.init(g);
      if (!this.programs || !this.vao) return;
      this.upload(g);
      this.draw(g, map, args, this.programs, this.vao);
    } catch (err) {
      // Carte graphique incompatible : on le dit une fois, la carte reste utilisable sans la nuit.
      this.failed = true;
      console.error('Affichage de la nuit indisponible', err);
    }
  }

  private draw(g: WebGL2RenderingContext, map: MapLibreMap, args: CustomRenderMethodInput, programs: Programs, vao: WebGLVertexArrayObject): void {

    const zoom = map.getZoom();
    const v = programs.get(args);
    g.useProgram(v.program);
    // Une largeur de monde centrée sur la vue : toute la sphère en globe, la zone visible en carte plate.
    const shift = map.getCenter().lng / 360;
    setProjection(g, v, args);
    g.uniform1f(v.u.u_shift, shift);
    g.uniform3f(v.u.u_sun, this.sun[0], this.sun[1], this.sun[2]);
    g.uniform4f(
      v.u.u_edges,
      Math.sin(SHADE_START * DEG),
      Math.sin(SHADE_FULL * DEG),
      Math.sin(LIGHTS_ON * DEG),
      Math.sin(LIGHTS_FULL * DEG),
    );
    g.uniform4f(v.u.u_night, NIGHT_COLOR[0], NIGHT_COLOR[1], NIGHT_COLOR[2], NIGHT_MAX_ALPHA);

    // Vue de loin : image mondiale. En zoomant, les images détaillées prennent le relais en fondu.
    const detailReady = this.detailEnabled && this.detailBounds !== null;
    const detailAlpha = detailReady ? ramp(zoom, [3, 0], [4.2, 1], [6.5, 0.85], [8, 0.6], [9.6, 0]) : 0;
    const worldAlpha = !this.hasLights
      ? 0
      : detailReady
        ? ramp(zoom, [3.3, 1], [4.5, 0])
        : ramp(zoom, [3.3, 1], [6, 0.7], [9, 0]);
    // De près, les lumières deviennent une lueur qui laisse voir le sol (villes, aéroports).
    const glow = detailReady ? ramp(zoom, [7.5, 0], [9.5, 1]) : 0;
    g.uniform3f(v.u.u_lightsAlpha, worldAlpha, detailAlpha, glow);
    const b = this.detailBounds ?? [0, 0, 1, 1];
    // Même monde que la vue (la zone détaillée est donnée pour le monde « principal »).
    const turn = Math.round(shift + 0.5 - (b[0] + b[2]) / 2);
    g.uniform4f(v.u.u_detailBounds, b[0] + turn, b[1], b[2] + turn, b[3]);

    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.lightsTex);
    g.uniform1i(v.u.u_lights, 0);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, this.detailTex);
    g.uniform1i(v.u.u_detail, 1);

    g.disable(g.DEPTH_TEST);
    g.disable(g.CULL_FACE);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.bindVertexArray(vao);
    g.drawElements(g.TRIANGLES, this.indexCount, g.UNSIGNED_SHORT, 0);
    g.bindVertexArray(null);
    g.activeTexture(g.TEXTURE0);
  }

  /** Envoie à la carte graphique les images arrivées depuis le dernier dessin. */
  private upload(g: WebGL2RenderingContext): void {
    if (!this.pendingLights && this.pendingDetail === undefined) return;
    g.pixelStorei(g.UNPACK_ALIGNMENT, 4);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    // Les images viennent de canvas : leurs couleurs sont envoyées déjà multipliées par la transparence.
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (this.pendingLights) {
      const img = this.pendingLights;
      this.pendingLights = null;
      if (this.lightsTex) g.deleteTexture(this.lightsTex);
      this.lightsTex = this.texture(g, true, img.width, img.height, img);
      this.hasLights = true;
    }
    if (this.pendingDetail !== undefined) {
      const img = this.pendingDetail;
      this.pendingDetail = undefined;
      if (this.detailTex) g.deleteTexture(this.detailTex);
      const max = g.getParameter(g.MAX_TEXTURE_SIZE) as number;
      if (img && img.width <= max && img.height <= max) {
        this.detailTex = this.texture(g, false, img.width, img.height);
        for (const t of img.tiles) g.texSubImage2D(g.TEXTURE_2D, 0, t.x, t.y, g.RGBA, g.UNSIGNED_BYTE, t.image);
        this.detailBounds = img.bounds;
      } else {
        this.detailTex = this.texture(g, false, 1, 1);
        this.detailBounds = null;
      }
    }
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /** Crée une texture transparente de la taille voulue, ou à partir d'une image. */
  private texture(g: WebGL2RenderingContext, world: boolean, w: number, h: number, image?: HTMLCanvasElement): WebGLTexture {
    const tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, tex);
    if (image) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
    else g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    // L'image mondiale se répète d'est en ouest ; la zone détaillée s'arrête à ses bords.
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, world ? g.REPEAT : g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    if (world && image) {
      g.generateMipmap(g.TEXTURE_2D);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    } else {
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    }
    return tex;
  }
}

/** Valeur interpolée entre des paliers [zoom, valeur] (constante avant le premier et après le dernier). */
function ramp(z: number, ...stops: [number, number][]): number {
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (z <= stops[i][0]) {
      const [z0, v0] = stops[i - 1];
      const [z1, v1] = stops[i];
      return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
  }
  return stops[stops.length - 1][1];
}
