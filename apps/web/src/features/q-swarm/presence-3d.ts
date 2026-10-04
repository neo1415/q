import type { PresenceSim } from "./presence-dynamics";
import { DEPTH_UNITS } from "./presence-figures";
import { presenceCounters, type Rgb } from "./presence-gl";
import type { PresenceUniforms } from "./presence-uniforms";

/**
 * Q's presence in 3D (ADR 0049), loaded with a dynamic import so it never
 * sits in the first-load bundle. Raw WebGL2, not three.js: the swarm is one
 * draw call of point sprites, which is all a scene graph would have done
 * for it, at about 4 KB instead of about 170 KB gzipped.
 *
 * The CPU keeps the swarm's dynamics (presence-dynamics.ts, unchanged):
 * where each particle is in the figure's own space. The vertex shader
 * turns that space towards the cursor, projects it in perspective and
 * sizes and lights each point by its depth -- nearer is larger and
 * brighter, the core whitens on a dark surface -- and the fragment shader
 * draws a soft disc. Blending is additive, so the core's density becomes
 * light and the draw order (depth) needs no sort.
 *
 * One WebGL2 context for the whole page, every surface drawn in turn and
 * copied onto its own 2D canvas, as before: a page with five Q surfaces
 * still holds one GPU context.
 */

const VERTEX = `#version 300 es
in vec4 aP;
in vec2 aS;
uniform vec2 uRes;
uniform float uUnit;
uniform float uPoint;
uniform vec2 uTurn;
uniform vec2 uShift;
uniform float uDepth;
uniform float uKeep;
uniform float uFade;
uniform float uScale;
out float vA;
out float vCore;
void main(){
  if(aS.y>uKeep){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vA=0.;vCore=0.;return;}
  // Flat figures get a hair of thickness, so they too have parallax.
  vec3 p=vec3(aP.x,aP.y,clamp(aP.z,-1.,1.)*uDepth+(aS.x-1.25)*.05);
  float cy=cos(uTurn.x),sy=sin(uTurn.x),cp=cos(uTurn.y),sp=sin(uTurn.y);
  p=vec3(p.x*cy+p.z*sy,p.y,-p.x*sy+p.z*cy);
  p=vec3(p.x,p.y*cp-p.z*sp,p.y*sp+p.z*cp);
  float s=4./(4.-p.z);
  vec2 q=p.xy*s+uShift;
  vec2 c=(uRes*.5+q*uUnit)/uRes*2.-1.;
  gl_Position=vec4(c.x,-c.y,0.,1.);
  float near=clamp(p.z/uDepth*.5+.5,0.,1.);
  gl_PointSize=uPoint*aS.x*(.6+.7*near)*s*uScale;
  float r=length(q)/.8;
  vCore=1.-smoothstep(0.,1.,r);
  vA=clamp((.38+.62*aP.w)*(.55+.45*near)*(.8+.6*vCore),0.,1.)*uFade;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in float vA;
in float vCore;
uniform vec3 uC;
uniform vec3 uW;
uniform float uWhite;
out vec4 o;
void main(){
  vec2 d=gl_PointCoord*2.-1.;
  float r2=dot(d,d);
  if(r2>1.)discard;
  // A small bright disc with a soft rim: crisp at a distance, never a square.
  float a=vA*(1.-smoothstep(.25,1.,r2)*.85);
  vec3 c=mix(uC,uW,clamp(pow(vCore,1.8)*.85,0.,1.)*uWhite);
  o=vec4(c*a,a);
}`;

type Gl = {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly points: WebGLBuffer;
  readonly seeds: WebGLBuffer;
  readonly vao: WebGLVertexArrayObject;
  readonly u: Readonly<Record<string, WebGLUniformLocation | null>>;
  seedCount: number;
};

const UNIFORMS = [
  "uRes",
  "uUnit",
  "uPoint",
  "uTurn",
  "uShift",
  "uDepth",
  "uKeep",
  "uFade",
  "uScale",
  "uC",
  "uW",
  "uWhite",
] as const;

let shared: Gl | null | undefined;
let lost = false;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function context(): Gl | null {
  if (shared !== undefined) return shared;
  shared = null;
  if (lost || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  if (gl === null) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (vs === null || fs === null) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return null;
  gl.useProgram(program);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const points = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, points);
  const aP = gl.getAttribLocation(program, "aP");
  gl.enableVertexAttribArray(aP);
  gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 0, 0);
  const seeds = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, seeds);
  const aS = gl.getAttribLocation(program, "aS");
  gl.enableVertexAttribArray(aS);
  gl.vertexAttribPointer(aS, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  // Additive: overlapping points add up to light, in any order.
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    // The 2D swarm from here on; a lost context is not fought over.
    lost = true;
    shared = null;
  });
  presenceCounters.contexts += 1;
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);
  shared = { canvas, gl, points, seeds, vao, u, seedCount: 0 };
  return shared;
}

/** True when the 3D renderer can draw (WebGL2 present, context not lost). */
export function presence3dAvailable(): boolean {
  return context() !== null;
}

/**
 * Per-particle constants: size (0.7..1.5, a few large) and a rank that
 * decides which particles the frame budget drops first. Deterministic, so
 * every surface and every screenshot is the same swarm.
 */
export function particleSeeds(count: number): Float32Array {
  const out = new Float32Array(count * 2);
  let state = 0x9e3779b9;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  for (let i = 0; i < count; i += 1) {
    const r = random();
    out[i * 2] = 0.7 + r * r * 0.8;
    out[i * 2 + 1] = random();
  }
  return out;
}

const seedCache = new Map<number, Float32Array>();
let points = new Float32Array(0);

export type Draw3dOptions = {
  /** The surface's canvas size in device pixels. */
  readonly pixels: number;
  readonly colour: Rgb;
  /** The surface behind Q is dark: the core may whiten, the halo may show. */
  readonly dark: boolean;
  /** The halo behind the swarm (ADR 0017: glow on Q only). */
  readonly bloom: boolean;
  readonly uniforms: PresenceUniforms;
};

/** Half the frame, in figure units: figures span about -1.15..1.15. */
const FRAME_HALF_UNITS = 1.15;

/**
 * Draws one surface. Returns false when WebGL2 is unavailable, so the
 * caller draws the 2D swarm instead.
 */
export function drawPresence3d(
  target: CanvasRenderingContext2D,
  sim: PresenceSim,
  options: Draw3dOptions,
): boolean {
  const g = context();
  if (g === null) return false;
  const { gl, canvas } = g;
  const size = options.pixels;
  const n = sim.count;
  const u = options.uniforms;

  if (points.length < n * 4) points = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    points[i * 4] = sim.x[i] ?? 0;
    points[i * 4 + 1] = sim.y[i] ?? 0;
    points[i * 4 + 2] = sim.z[i] ?? 0;
    points[i * 4 + 3] = Math.max(0, Math.min(1.3, sim.b[i] ?? 0));
  }
  let seeds = seedCache.get(n);
  if (seeds === undefined) {
    seeds = particleSeeds(n);
    seedCache.set(n, seeds);
  }

  if (canvas.width < size || canvas.height < size) {
    canvas.width = Math.max(canvas.width, size);
    canvas.height = Math.max(canvas.height, size);
  }
  gl.bindVertexArray(g.vao);
  // Drawn in the canvas's top-left square, which is what is copied.
  gl.viewport(0, canvas.height - size, size, size);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const unit = size / 2 / FRAME_HALF_UNITS;
  const [r, gr, b] = options.colour;
  // On a light surface the core deepens rather than whitening: white
  // light on white paper is no light at all.
  const white = options.dark ? 1 : 0;
  gl.uniform2f(g.u["uRes"] ?? null, size, size);
  gl.uniform1f(g.u["uUnit"] ?? null, unit);
  // Point size follows the surface, so a dock swarm still reads.
  gl.uniform1f(g.u["uPoint"] ?? null, Math.max(1.5, size / 195));
  gl.uniform2f(g.u["uTurn"] ?? null, u.yaw, u.pitch);
  gl.uniform2f(g.u["uShift"] ?? null, u.shiftX, u.shiftY);
  gl.uniform1f(g.u["uDepth"] ?? null, DEPTH_UNITS);
  gl.uniform1f(g.u["uKeep"] ?? null, u.keep);
  gl.uniform1f(g.u["uFade"] ?? null, u.fade * (options.dark ? 1 : 1.25));
  gl.uniform1f(g.u["uScale"] ?? null, u.pointScale);
  gl.uniform3f(g.u["uC"] ?? null, r, gr, b);
  gl.uniform3f(g.u["uW"] ?? null, 1, 0.97, 0.91);
  gl.uniform1f(g.u["uWhite"] ?? null, white * Math.max(0.5, u.core));
  gl.bindBuffer(gl.ARRAY_BUFFER, g.points);
  gl.bufferData(gl.ARRAY_BUFFER, points.subarray(0, n * 4), gl.STREAM_DRAW);
  // Surfaces with different counts share the seed buffer: re-sent only
  // when the count changes between draws.
  if (g.seedCount !== n) {
    gl.bindBuffer(gl.ARRAY_BUFFER, g.seeds);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    g.seedCount = n;
  }
  gl.drawArrays(gl.POINTS, 0, n);

  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, size, size);
  if (options.bloom && u.glow > 0) halo(target, size, unit, options, u);
  target.drawImage(canvas, 0, 0, size, size, 0, 0, size, size);
  if (options.bloom && options.dark && u.glow > 0) core(target, size, unit, u);
  presenceCounters.frames += 1;
  presenceCounters.renderer = "3d";
  return true;
}

/** The soft light behind Q, in Q's own hue, fading to nothing at the edge. */
function halo(
  target: CanvasRenderingContext2D,
  size: number,
  unit: number,
  options: Draw3dOptions,
  u: PresenceUniforms,
): void {
  const half = size / 2;
  const x = half + u.shiftX * unit;
  const y = half + u.shiftY * unit;
  const [r, g, b] = options.colour.map((c) => Math.round(c * 255));
  const rgb = `${String(r)},${String(g)},${String(b)}`;
  const strength = (options.dark ? 0.24 : 0.1) * u.glow;
  const gradient = target.createRadialGradient(x, y, 0, x, y, half * 0.98);
  gradient.addColorStop(0, `rgba(${rgb},${String(strength)})`);
  gradient.addColorStop(0.35, `rgba(${rgb},${String(strength * 0.38)})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  target.fillStyle = gradient;
  target.fillRect(0, 0, size, size);
}

/** The near-white light at Q's centre, added over the points (dark surfaces only). */
function core(
  target: CanvasRenderingContext2D,
  size: number,
  unit: number,
  u: PresenceUniforms,
): void {
  const x = size / 2 + u.shiftX * unit;
  const y = size / 2 + u.shiftY * unit;
  const radius = unit * 0.36;
  const gradient = target.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(255,246,228,${String(0.42 * u.glow * u.core)})`);
  gradient.addColorStop(1, "rgba(255,246,228,0)");
  target.globalCompositeOperation = "lighter";
  target.fillStyle = gradient;
  target.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  target.globalCompositeOperation = "source-over";
}
