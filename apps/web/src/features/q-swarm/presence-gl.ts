import type { PresenceSim } from "./presence-dynamics";

/**
 * Drawing Q's particles (PRESENCE spec §6): one WebGL2 context for the
 * whole page, every particle a soft gaussian point in a single draw call,
 * the result copied onto each surface's own 2D canvas -- the same pattern
 * as the aperture renderer, so a page with five Q surfaces still holds one
 * GPU context. Where WebGL2 is missing or its context is lost, the same
 * frame is drawn with Canvas2D sprites.
 */

const VERTEX = `#version 300 es
in vec4 aP;
uniform vec2 uRes;
out float vA;
void main(){
  vec2 c=aP.xy/uRes*2.-1.;
  gl_Position=vec4(c.x,-c.y,0.,1.);
  gl_PointSize=aP.z;
  vA=aP.w;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in float vA;
uniform vec3 uC;
out vec4 o;
void main(){
  vec2 d=gl_PointCoord*2.-1.;
  float r2=dot(d,d);
  if(r2>1.)discard;
  float a=vA*(exp(-r2*9.)+exp(-r2*2.6)*.32);
  o=vec4(uC*a,a);
}`;

type Gl = {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly buffer: WebGLBuffer;
  readonly uRes: WebGLUniformLocation | null;
  readonly uC: WebGLUniformLocation | null;
};

let shared: Gl | null | undefined;
let lost = false;
const stats = { contexts: 0, frames: 0, fallbackFrames: 0 };

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
  const program = gl.createProgram();
  if (vs === null || fs === null) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const at = gl.getAttribLocation(program, "aP");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 4, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    // Canvas2D from here on; a lost context is not fought over.
    lost = true;
    shared = null;
  });
  stats.contexts += 1;
  shared = {
    canvas,
    gl,
    buffer,
    uRes: gl.getUniformLocation(program, "uRes"),
    uC: gl.getUniformLocation(program, "uC"),
  };
  return shared;
}

/** Counters for the playground and the acceptance checks. */
export function presenceStats(): {
  readonly contexts: number;
  readonly frames: number;
  readonly fallbackFrames: number;
  readonly webgl: boolean;
} {
  return { ...stats, webgl: shared !== null && shared !== undefined };
}

export type Rgb = readonly [number, number, number];

/** Any CSS colour (oklch, hex, rgb...) as 0..1 RGB, resolved by the browser. */
export function resolveColour(colour: string): Rgb {
  if (typeof document === "undefined") return [0.42, 0.66, 1];
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const g = probe.getContext("2d", { willReadFrequently: true });
  if (g === null) return [0.42, 0.66, 1];
  g.fillStyle = "#6aa8ff";
  g.fillStyle = colour;
  g.fillRect(0, 0, 1, 1);
  const data = g.getImageData(0, 0, 1, 1).data;
  return [
    (data[0] ?? 106) / 255,
    (data[1] ?? 168) / 255,
    (data[2] ?? 255) / 255,
  ];
}

/** Half the frame, in figure units: figures span about -1.15..1.15. */
const FRAME_HALF_UNITS = 1.15;

export type DrawOptions = {
  /** The surface's canvas size in device pixels. */
  readonly pixels: number;
  readonly colour: Rgb;
  readonly dim: boolean;
};

let points = new Float32Array(0);

/** Particle positions, sizes and alphas in device pixels. */
export function layoutPoints(
  sim: PresenceSim,
  options: DrawOptions,
): Float32Array {
  const n = sim.count;
  if (points.length < n * 4) points = new Float32Array(n * 4);
  const half = options.pixels / 2;
  const unit = half / FRAME_HALF_UNITS;
  // Small surfaces get relatively larger points, so they still read.
  const base = Math.max(1.6, options.pixels / 150);
  const fade = options.dim ? 0.45 : 1;
  for (let i = 0; i < n; i += 1) {
    const depth = Math.max(-1, Math.min(1, sim.z[i] ?? 0));
    const light = Math.max(0, Math.min(1.3, sim.b[i] ?? 0));
    points[i * 4] = half + (sim.x[i] ?? 0) * unit;
    points[i * 4 + 1] = half + (sim.y[i] ?? 0) * unit;
    // Nearer is larger; brighter is a little larger (a glow).
    points[i * 4 + 2] = base * (2.1 + depth * 0.6 + light * 0.6);
    points[i * 4 + 3] = Math.min(1, (0.25 + light * 0.75) * fade);
  }
  return points;
}

const sprites = new Map<string, HTMLCanvasElement>();

function spriteFor(colour: Rgb): HTMLCanvasElement {
  const key = colour.join(",");
  const cached = sprites.get(key);
  if (cached !== undefined) return cached;
  const sprite = document.createElement("canvas");
  sprite.width = 32;
  sprite.height = 32;
  const g = sprite.getContext("2d");
  if (g !== null) {
    const rgb = `${String(Math.round(colour[0] * 255))},${String(Math.round(colour[1] * 255))},${String(Math.round(colour[2] * 255))}`;
    const gradient = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, `rgba(${rgb},1)`);
    gradient.addColorStop(0.35, `rgba(${rgb},0.55)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gradient;
    g.fillRect(0, 0, 32, 32);
  }
  sprites.set(key, sprite);
  return sprite;
}

/** Draws the swarm onto a surface's canvas (sized in device pixels). */
export function drawPresence(
  target: CanvasRenderingContext2D,
  sim: PresenceSim,
  options: DrawOptions,
): void {
  const size = options.pixels;
  const data = layoutPoints(sim, options);
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, size, size);
  const g = context();
  if (g !== null) {
    const { canvas, gl } = g;
    if (canvas.width < size || canvas.height < size) {
      canvas.width = Math.max(canvas.width, size);
      canvas.height = Math.max(canvas.height, size);
    }
    // Drawn in the canvas's top-left square, which is what is copied.
    gl.viewport(0, canvas.height - size, size, size);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(g.uRes, size, size);
    gl.uniform3f(g.uC, options.colour[0], options.colour[1], options.colour[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      data.subarray(0, sim.count * 4),
      gl.STREAM_DRAW,
    );
    gl.drawArrays(gl.POINTS, 0, sim.count);
    target.drawImage(canvas, 0, 0, size, size, 0, 0, size, size);
    stats.frames += 1;
    return;
  }
  // Canvas2D: the same points as soft sprites.
  const sprite = spriteFor(options.colour);
  for (let i = 0; i < sim.count; i += 1) {
    const d = data[i * 4 + 2] ?? 2;
    target.globalAlpha = data[i * 4 + 3] ?? 0.5;
    target.drawImage(
      sprite,
      (data[i * 4] ?? 0) - d / 2,
      (data[i * 4 + 1] ?? 0) - d / 2,
      d,
      d,
    );
  }
  target.globalAlpha = 1;
  stats.fallbackFrames += 1;
}
