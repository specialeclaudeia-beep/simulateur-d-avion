import type { CustomRenderMethodInput } from 'maplibre-gl';

/**
 * Petits outils WebGL pour les calques dessinés par le jeu lui-même (avions,
 * nuit). MapLibre fournit le code de projection (globe ou carte plate) : on le
 * colle en tête de nos programmes, un programme par variante de projection.
 */

export interface Variant {
  program: WebGLProgram;
  /** Emplacements des variables du programme (null si absente de cette variante). */
  u: Record<string, WebGLUniformLocation | null>;
  /** La variante « globe » a besoin de plus d'informations que la carte plate. */
  globe: boolean;
}

const PROJECTION_UNIFORMS = [
  'u_projection_matrix',
  'u_projection_fallback_matrix',
  'u_projection_tile_mercator_coords',
  'u_projection_clipping_plane',
  'u_projection_transition',
];

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Programme graphique invalide : ${log}`);
  }
  return shader;
}

export class Programs {
  private variants = new Map<string, Variant>();

  /**
   * @param vertexBody suite du programme de sommets (après le code de projection de MapLibre)
   * @param fragment programme de couleur complet
   * @param uniforms variables propres au calque
   * @param attributes noms des attributs, dans l'ordre de leurs emplacements (0, 1, 2…)
   */
  constructor(
    private gl: WebGL2RenderingContext,
    private vertexBody: string,
    private fragment: string,
    private uniforms: string[],
    private attributes: string[],
  ) {}

  /** Programme adapté à la projection en cours (compilé au premier besoin). */
  get(args: CustomRenderMethodInput): Variant {
    const name = args.shaderData.variantName;
    let v = this.variants.get(name);
    if (v) return v;
    const gl = this.gl;
    const vs = compileShader(
      gl,
      gl.VERTEX_SHADER,
      `#version 300 es\n${args.shaderData.vertexShaderPrelude}\n${args.shaderData.define}\n${this.vertexBody}`,
    );
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, this.fragment);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    this.attributes.forEach((a, i) => gl.bindAttribLocation(program, i, a));
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Programme graphique invalide : ${gl.getProgramInfoLog(program)}`);
    }
    const u: Variant['u'] = {};
    for (const n of [...PROJECTION_UNIFORMS, ...this.uniforms]) u[n] = gl.getUniformLocation(program, n);
    v = { program, u, globe: u.u_projection_tile_mercator_coords !== null };
    this.variants.set(name, v);
    return v;
  }

  dispose(): void {
    for (const v of this.variants.values()) this.gl.deleteProgram(v.program);
    this.variants.clear();
  }
}

const scratch = new Float32Array(16);
const main = new Float32Array(16);

/** m × translation(x, y) : les positions envoyées au programme sont relatives au point (x, y). */
function translated(m: ArrayLike<number>, x: number, y: number): Float32Array {
  for (let i = 0; i < 12; i++) scratch[i] = m[i];
  scratch[12] = m[0] * x + m[4] * y + m[12];
  scratch[13] = m[1] * x + m[5] * y + m[13];
  scratch[14] = m[2] * x + m[6] * y + m[14];
  scratch[15] = m[3] * x + m[7] * y + m[15];
  return scratch;
}

/**
 * Règle la projection du programme actif. Les positions (coordonnées Mercator,
 * 0 à 1 sur le monde entier) sont données relativement au point de référence
 * (refX, refY) : c'est ce qui garde la précision au niveau de la rue.
 */
export function setProjection(gl: WebGL2RenderingContext, v: Variant, args: CustomRenderMethodInput, refX = 0, refY = 0): void {
  const p = args.defaultProjectionData;
  if (v.globe) {
    main.set(p.mainMatrix as ArrayLike<number>);
    gl.uniformMatrix4fv(v.u.u_projection_matrix, false, main);
    gl.uniformMatrix4fv(v.u.u_projection_fallback_matrix, false, translated(p.fallbackMatrix as ArrayLike<number>, refX, refY));
    gl.uniform4f(v.u.u_projection_tile_mercator_coords, refX, refY, 1, 1);
    const c = p.clippingPlane as ArrayLike<number>;
    gl.uniform4f(v.u.u_projection_clipping_plane, c[0], c[1], c[2], c[3]);
    gl.uniform1f(v.u.u_projection_transition, p.projectionTransition);
  } else {
    gl.uniformMatrix4fv(v.u.u_projection_matrix, false, translated(p.mainMatrix as ArrayLike<number>, refX, refY));
  }
}

const DEG = Math.PI / 180;

/** Longitude (°) → x Mercator (0 à 1). */
export function mercX(lon: number): number {
  return lon / 360 + 0.5;
}

/** Latitude (°) → y Mercator (0 au nord à 85,05°, 1 au sud ; au-delà près des pôles). */
export function mercY(lat: number): number {
  const l = Math.max(-89.99, Math.min(89.99, lat)) * DEG;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + l / 2)) / (2 * Math.PI);
}

/** x, y Mercator → [longitude, latitude] en degrés. */
export function unmerc(x: number, y: number): [number, number] {
  const lon = (x - Math.floor(x) - 0.5) * 360;
  const lat = (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - Math.PI / 2) / DEG;
  return [lon, lat];
}
