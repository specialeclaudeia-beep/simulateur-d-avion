import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { ATLAS_COLS, SDF_CELL, buildAircraftAtlas } from './aircraftIcons';
import { Programs, setProjection } from './gl';

/**
 * Les avions, dessinés par la carte graphique.
 *
 * Chaque avion est une « instance » : sa position à un instant de référence,
 * sa vitesse, sa taille, ses couleurs. À chaque image, la carte graphique le
 * fait avancer le long de sa trajectoire et l'oriente dans le sens de la marche :
 * le mouvement est continu à 60 images par seconde alors que le processeur ne
 * recalcule les positions que de temps en temps (voir aircraft.ts).
 *
 * Trois passes avec le même programme : les traînées, les avions, l'anneau de
 * l'avion sélectionné.
 */

/** Octets par avion : position (2 × 4), vitesse (2 × 4), vie (2 × 4), taille (4), couleurs (2 × 4). */
export const INSTANCE_BYTES = 36;

const VERTEX = `
in vec2 a_corner;
in vec2 a_pos;
in vec2 a_vel;
in vec2 a_life;
in float a_size;
in vec4 a_body;
in vec4 a_accent;
uniform float u_dt;
uniform vec2 u_viewport;
uniform float u_px;
uniform float u_eps;
uniform highp int u_mode;
uniform vec2 u_trail;
uniform float u_ring;
out vec2 v_uv;
out vec3 v_body;
out vec3 v_accent;
out float v_player;
out float v_scale;
out vec2 v_local;
void main() {
  v_uv = vec2(0.0);
  v_local = vec2(0.0);
  v_scale = 1.0;
  v_body = a_body.rgb;
  v_accent = a_accent.rgb;
  v_player = a_body.a;
  // Pas encore décollé, ou déjà posé : hors de l'écran.
  if (u_dt < a_life.x || u_dt >= a_life.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 p = a_pos + a_vel * u_dt;
  float speed = length(a_vel);
  vec2 dir = speed > 0.0 ? a_vel / speed : vec2(0.0, -1.0);
  vec4 c0 = projectTile(p);
  vec4 c1 = projectTile(p + dir * u_eps);
  // Sens de la marche à l'écran : juste sur le globe comme sur la carte plate, carte tournée ou inclinée.
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * u_viewport;
  float len = length(d);
  vec2 fwd = len > 1e-7 ? d / len : vec2(0.0, 1.0);
  vec2 right = vec2(fwd.y, -fwd.x);
  float halfSize = a_size * u_px;
  vec2 off;
  if (u_mode == 0) {
    off = (a_corner.x * right + a_corner.y * fwd) * halfSize;
    float icon = floor(a_accent.a * 255.0 + 0.5);
    vec2 cell = vec2(mod(icon, ${ATLAS_COLS}.0), floor(icon / ${ATLAS_COLS}.0));
    v_uv = (cell + vec2(a_corner.x * 0.5 + 0.5, 0.5 - a_corner.y * 0.5)) / ${ATLAS_COLS}.0;
    v_scale = halfSize * 2.0 / ${SDF_CELL}.0;
  } else if (u_mode == 1) {
    float along = 0.5 - a_corner.y * 0.5;
    off = right * a_corner.x * u_trail.y - fwd * (along * u_trail.x * a_size + halfSize * 0.5);
    v_local = vec2(a_corner.x, along);
  } else {
    off = a_corner * u_ring;
    v_local = a_corner;
  }
  gl_Position = vec4(c0.xy + off * 2.0 / u_viewport * c0.w, c0.z, c0.w);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform highp int u_mode;
uniform float u_alpha;
uniform float u_outline;
in vec2 v_uv;
in vec3 v_body;
in vec3 v_accent;
in float v_player;
in float v_scale;
in vec2 v_local;
out vec4 fragColor;
void main() {
  if (u_mode == 0) {
    vec4 t = texture(u_atlas, v_uv);
    // Contour d'épaisseur constante à l'écran : sombre, ou blanc pour les avions du joueur.
    float dist = (0.75 - t.b) * 8.0 * v_scale;
    float w = mix(0.9, 1.7, v_player) * u_outline;
    float edge = (1.0 - smoothstep(w - 0.6, w + 0.6, dist)) * mix(0.85, 1.0, v_player);
    vec3 edgeColor = mix(vec3(0.02, 0.04, 0.10), vec3(1.0), v_player);
    vec3 color = mix(v_body, v_accent, t.g);
    float a = max(t.r, t.g);
    fragColor = (vec4(color * a, a) + vec4(edgeColor * edge, edge) * (1.0 - a)) * u_alpha;
  } else if (u_mode == 1) {
    float fade = 1.0 - v_local.y;
    float a = fade * fade * 0.55 * (1.0 - abs(v_local.x));
    fragColor = vec4(a) * u_alpha;
  } else {
    float r = length(v_local);
    float ring = smoothstep(0.78, 0.84, r) * (1.0 - smoothstep(0.94, 1.0, r));
    float a = ring + (1.0 - smoothstep(0.78, 0.84, r)) * 0.13;
    fragColor = vec4(a) * u_alpha;
  }
}`;

const UNIFORMS = ['u_dt', 'u_viewport', 'u_px', 'u_eps', 'u_mode', 'u_trail', 'u_ring', 'u_atlas', 'u_alpha', 'u_outline'];
const ATTRIBUTES = ['a_corner', 'a_pos', 'a_vel', 'a_life', 'a_size', 'a_body', 'a_accent'];

/** Taille des avions selon le zoom (comme une interpolation exponentielle de base 1,6). */
const SIZE_STOPS: [number, number][] = [
  [1, 0.2],
  [3, 0.3],
  [5, 0.5],
  [7, 0.8],
  [10, 1.3],
  [14, 3],
];

export function iconScale(zoom: number): number {
  const s = SIZE_STOPS;
  if (zoom <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (zoom <= s[i][0]) {
      const [z0, v0] = s[i - 1];
      const [z1, v1] = s[i];
      const base = 1.6;
      const k = (base ** (zoom - z0) - 1) / (base ** (z1 - z0) - 1);
      return v0 + (v1 - v0) * k;
    }
  }
  return s[s.length - 1][1];
}

export class AircraftGl implements CustomLayerInterface {
  readonly id = 'aircraft-gl';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private map: MapLibreMap | null = null;
  private programs: Programs | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private atlas: WebGLTexture | null = null;
  private quad: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private vboBytes = 0;
  private selVao: WebGLVertexArrayObject | null = null;
  private selVbo: WebGLBuffer | null = null;

  // Données à dessiner (fournies par AircraftLayer).
  private data: Uint8Array = new Uint8Array(0);
  private count = 0;
  private pending = false;
  private refX = 0;
  private refY = 0;
  private selData = new Uint8Array(INSTANCE_BYTES);
  private selOn = false;

  /** Secondes de jeu écoulées depuis l'instant de référence des positions (fourni par AircraftLayer). */
  now: () => number = () => 0;
  /** Les traînées derrière les avions (détail élevé). */
  trails = false;
  /** Heure (performance.now) du dernier dessin : sert à ne redessiner que si quelque chose a bougé. */
  lastRenderAt = 0;
  private failed = false;

  /** Nouvelles positions (un bloc de INSTANCE_BYTES octets par avion), relatives au point (refX, refY). */
  setInstances(data: Uint8Array, count: number, refX: number, refY: number): void {
    this.data = data;
    this.count = count;
    this.refX = refX;
    this.refY = refY;
    this.pending = true;
    this.map?.triggerRepaint();
  }

  /** Avion sélectionné (une instance, relative au même point de référence), ou null. */
  setSelected(instance: Uint8Array | null): void {
    this.selOn = instance !== null;
    if (instance) this.selData.set(instance);
  }

  onAdd(map: MapLibreMap): void {
    this.map = map;
    map.on('webglcontextlost', this.forget);
  }

  onRemove(): void {
    this.map?.off('webglcontextlost', this.forget);
    const g = this.gl;
    if (g) {
      this.programs?.dispose();
      for (const b of [this.quad, this.vbo, this.selVbo]) if (b) g.deleteBuffer(b);
      for (const v of [this.vao, this.selVao]) if (v) g.deleteVertexArray(v);
      if (this.atlas) g.deleteTexture(this.atlas);
    }
    this.forget();
    this.map = null;
  }

  /** Carte graphique réinitialisée : tout sera recréé au prochain dessin. */
  private forget = (): void => {
    this.programs = null;
    this.gl = null;
    this.atlas = null;
    this.quad = this.vbo = this.selVbo = null;
    this.vao = this.selVao = null;
    this.vboBytes = 0;
    this.pending = true;
  };

  /** Prépare programmes, géométrie et atlas (au premier dessin, voir nightGl.ts). */
  private init(g: WebGL2RenderingContext): void {
    this.gl = g;
    this.programs = new Programs(g, VERTEX, FRAGMENT, UNIFORMS, ATTRIBUTES);

    this.quad = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, this.quad);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);

    this.vbo = g.createBuffer();
    this.vao = this.makeVao(g, this.vbo!);
    this.selVbo = g.createBuffer();
    this.selVao = this.makeVao(g, this.selVbo!);
    g.bindBuffer(g.ARRAY_BUFFER, this.selVbo);
    g.bufferData(g.ARRAY_BUFFER, INSTANCE_BYTES, g.DYNAMIC_DRAW);

    const atlas = buildAircraftAtlas();
    this.atlas = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, this.atlas);
    g.pixelStorei(g.UNPACK_ALIGNMENT, 4);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, atlas.size, atlas.size, 0, g.RGBA, g.UNSIGNED_BYTE, atlas.data);
    g.generateMipmap(g.TEXTURE_2D);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  }

  private makeVao(g: WebGL2RenderingContext, instances: WebGLBuffer): WebGLVertexArrayObject {
    const vao = g.createVertexArray()!;
    g.bindVertexArray(vao);
    g.bindBuffer(g.ARRAY_BUFFER, this.quad);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, instances);
    const attr = (loc: number, size: number, type: number, normalized: boolean, offset: number) => {
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, size, type, normalized, INSTANCE_BYTES, offset);
      g.vertexAttribDivisor(loc, 1);
    };
    attr(1, 2, g.FLOAT, false, 0); // position
    attr(2, 2, g.FLOAT, false, 8); // vitesse
    attr(3, 2, g.FLOAT, false, 16); // début et fin de vie
    attr(4, 1, g.FLOAT, false, 24); // taille
    attr(5, 4, g.UNSIGNED_BYTE, true, 28); // fuselage + joueur
    attr(6, 4, g.UNSIGNED_BYTE, true, 32); // accent + silhouette
    g.bindVertexArray(null);
    return vao;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const g = gl as WebGL2RenderingContext;
    const map = this.map;
    if (!map) return;
    if (this.failed) return;
    try {
      if (!this.programs) this.init(g);
      if (!this.programs || !this.vao || !this.selVao) return;
      this.draw(g, map, args, this.programs, this.vao, this.selVao);
    } catch (err) {
      // Carte graphique incompatible : on le dit une fois, la carte reste utilisable sans les avions.
      this.failed = true;
      console.error('Affichage des avions indisponible', err);
    }
  }

  private draw(
    g: WebGL2RenderingContext,
    map: MapLibreMap,
    args: CustomRenderMethodInput,
    programs: Programs,
    vao: WebGLVertexArrayObject,
    selVao: WebGLVertexArrayObject,
  ): void {
    this.lastRenderAt = performance.now();

    if (this.pending) {
      this.pending = false;
      g.bindBuffer(g.ARRAY_BUFFER, this.vbo);
      const bytes = this.count * INSTANCE_BYTES;
      if (bytes > this.vboBytes) {
        // Un peu de marge : le tampon n'est pas recréé à chaque avion de plus.
        this.vboBytes = Math.ceil((bytes * 1.25) / 1024) * 1024;
        g.bufferData(g.ARRAY_BUFFER, this.vboBytes, g.DYNAMIC_DRAW);
      }
      if (bytes) g.bufferSubData(g.ARRAY_BUFFER, 0, this.data, 0, bytes);
    }
    if (!this.count && !this.selOn) return;

    const zoom = map.getZoom();
    const dpr = map.getPixelRatio();
    const v = programs.get(args);
    g.useProgram(v.program);
    setProjection(g, v, args, this.refX, this.refY);
    g.uniform1f(v.u.u_dt, this.now());
    g.uniform2f(v.u.u_viewport, g.drawingBufferWidth, g.drawingBufferHeight);
    const scale = iconScale(zoom);
    g.uniform1f(v.u.u_px, 16 * scale * dpr);
    // Petit pas « vers l'avant » pour trouver le sens de la marche : ~8 pixels, borné.
    g.uniform1f(v.u.u_eps, Math.min(4e-5, Math.max(2e-6, 8 / (512 * 2 ** zoom))));
    g.uniform1f(v.u.u_outline, dpr);
    g.uniform1f(v.u.u_alpha, 1);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.atlas);
    g.uniform1i(v.u.u_atlas, 0);

    g.disable(g.DEPTH_TEST);
    g.disable(g.CULL_FACE);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);

    if (this.count) {
      g.bindVertexArray(vao);
      const trailAlpha = this.trails ? Math.min(1, Math.max(0, zoom - 4.6)) : 0;
      if (trailAlpha > 0) {
        g.uniform1i(v.u.u_mode, 1);
        g.uniform2f(v.u.u_trail, 30 * scale * dpr, 1.1 * dpr);
        g.uniform1f(v.u.u_alpha, trailAlpha);
        g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, this.count);
        g.uniform1f(v.u.u_alpha, 1);
      }
      g.uniform1i(v.u.u_mode, 0);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, this.count);
    }

    if (this.selOn) {
      g.bindBuffer(g.ARRAY_BUFFER, this.selVbo);
      g.bufferSubData(g.ARRAY_BUFFER, 0, this.selData);
      g.bindVertexArray(selVao);
      g.uniform1i(v.u.u_mode, 2);
      g.uniform1f(v.u.u_dt, 0);
      g.uniform1f(v.u.u_ring, Math.max(13, 15 * scale + 7) * dpr);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, 1);
    }
    g.bindVertexArray(null);
  }
}
