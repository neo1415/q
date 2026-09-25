import type { ApertureParams } from "./aperture-frame";

/**
 * The Q Aperture's light, drawn by one shared WebGL2 context (spec §5.4).
 *
 * Browsers cap live WebGL contexts, so every aperture on the page shares
 * this one. Each is drawn into the shared (never attached) canvas and
 * copied into its own 2D canvas in the same task. The copy keeps every
 * aperture in normal DOM order — under a sheet, inside a scroller, behind
 * a popover — which a single overlay canvas with scissor rects cannot do
 * without clipping maths per scroller; the contexts cap is what matters
 * and there is still exactly one.
 *
 * The ring is a signed distance field with a tail; the bloom is an
 * analytic falloff of that distance in the fragment shader, not a CSS
 * blur. Frames run only while some aperture is live (audio, work, a
 * state change) and the document is visible; at rest nothing is
 * scheduled at all. Loaded after first paint; the SVG ring stands in
 * until then and wherever this cannot run.
 */

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vP;
void main(){vP=aPos;gl_Position=vec4(aPos,0.,1.);}`;

// Coordinates: the mark's box is [-1,1] with y up; the tail points to the
// lower right, as the Q's does.
const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vP;
out vec4 o;
uniform float uHalf,uR,uW,uOpen,uBright,uSweepAmp,uSweepPhase,uProgress,uTail,uTailGlow,uFlash,uCore,uEmber,uBloom,uInk;
uniform vec3 cLight,cCore,cBloom,cEmber;
uniform float aBloom;
const float TAU=6.2831853;
float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
void main(){
  vec2 p=vP;
  float px=1./uHalf;
  float w=max(uW,1.5*px);
  float len=length(p);
  float ring=abs(len-uR)-w*.5;
  vec2 dir=vec2(.7071,-.7071);
  vec2 ta=dir*(uR-.1);
  vec2 tb=dir*(uR+.14*uTail);
  float tail=seg(p,ta,tb)-w*.5;
  float d=min(ring,tail);
  float stroke=1.-smoothstep(-px,px,d);
  float dd=max(d,0.);
  float k=mix(9.,20.,uInk);
  float glow=uBloom*exp(-dd*k)*(1.-stroke);
  float turn=fract((1.5707963-atan(p.y,p.x))/TAU);
  float near=exp(-max(ring,0.)*28.);
  float da=abs(fract(turn-uSweepPhase+.5)-.5);
  float head=uSweepAmp*exp(-da*da*160.)*near;
  float arc=uProgress>=0.?step(turn,uProgress)*near:0.;
  float fill=uOpen*(1.-smoothstep(uR*.15,uR,len))*.22;
  float beam=uTailGlow*exp(-seg(p,tb,tb+dir*.3)*12.)*.8;
  vec3 base=mix(cLight,cEmber,uEmber);
  float lift=clamp(head+arc*.55+uCore*.35+uFlash,0.,1.);
  // Light fades to nothing before the box edge, so no box is ever seen.
  float win=smoothstep(1.,.78,max(abs(p.x),abs(p.y)));
  float light=((glow+head*.9+arc*.5+beam)*(.7+.3*uBright)+uFlash*exp(-dd*6.)*.8)*win;
  vec3 rgb;float a;
  if(uInk>.5){
    // Ink and light on paper: a solid stroke that keeps its contrast, a
    // tight bloom, and a white inner line only where the light is.
    float inner=exp(-pow((len-uR)/(w*.2),2.))*stroke*lift;
    vec3 s=mix(base,cCore,inner*.8);
    float g=clamp((light+fill)*aBloom,0.,1.);
    rgb=s*stroke+cBloom*g*(1.-stroke);
    a=stroke+g*(1.-stroke);
  }else{
    // Additive light on a dark field.
    vec3 s=mix(base,cCore,lift*.75)*min(uBright,1.4);
    rgb=s*stroke+cBloom*(light*aBloom*1.3)+cLight*fill;
    a=clamp(stroke+(light*aBloom+fill)*.7,0.,1.);
  }
  o=vec4(min(rgb,vec3(1.)),a);
}`;

type Rgb = readonly [number, number, number];

export type ApertureColours = {
  readonly light: Rgb;
  readonly core: Rgb;
  readonly bloom: Rgb;
  readonly bloomAlpha: number;
  readonly ember: Rgb;
  readonly ink: boolean;
};

const UNIFORMS = [
  "uHalf",
  "uR",
  "uW",
  "uOpen",
  "uBright",
  "uSweepAmp",
  "uSweepPhase",
  "uProgress",
  "uTail",
  "uTailGlow",
  "uFlash",
  "uCore",
  "uEmber",
  "uBloom",
  "uInk",
  "cLight",
  "cCore",
  "cBloom",
  "cEmber",
  "aBloom",
] as const;
type UniformName = (typeof UNIFORMS)[number];

type Gl = {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly at: Readonly<Record<UniformName, WebGLUniformLocation | null>>;
};

let shared: Gl | null | undefined;
const stats = { contexts: 0, frames: 0, draws: 0, running: false };

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

/** The one context, created on first use; null where WebGL2 cannot run. */
function context(): Gl | null {
  if (shared !== undefined) return shared;
  shared = null;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (gl === null) return null;
  stats.contexts += 1;
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
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0, 0, 0, 0);
  const at = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<UniformName, WebGLUniformLocation | null>;
  canvas.addEventListener("webglcontextlost", () => {
    // Every aperture falls back to its SVG ring; nothing retries in a loop.
    shared = null;
    for (const slot of slots) slot.onLost();
  });
  shared = { canvas, gl, at };
  return shared;
}

/** True when this browser can draw the aperture's light. */
export function canRender(): boolean {
  return context() !== null;
}

/** Counters for the development gallery and the acceptance checks. */
export function apertureStats(): {
  readonly contexts: number;
  readonly frames: number;
  readonly draws: number;
  readonly running: boolean;
  readonly slots: number;
} {
  return { ...stats, slots: slots.size };
}

export function drawAperture(
  target: CanvasRenderingContext2D,
  size: number,
  params: ApertureParams,
  colours: ApertureColours,
): void {
  const g = context();
  if (g === null) return;
  const { canvas, gl, at } = g;
  if (canvas.width < size || canvas.height < size) {
    canvas.width = Math.max(canvas.width, size);
    canvas.height = Math.max(canvas.height, size);
  }
  gl.viewport(0, 0, size, size);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const f = (name: UniformName, value: number) => gl.uniform1f(at[name], value);
  const c = (name: UniformName, value: Rgb) =>
    gl.uniform3f(at[name], value[0], value[1], value[2]);
  f("uHalf", size / 2);
  f("uR", params.radius);
  f("uW", params.width);
  f("uOpen", params.open);
  f("uBright", params.bright);
  f("uSweepAmp", params.sweepAmp);
  f("uSweepPhase", params.sweepPhase);
  f("uProgress", params.progress);
  f("uTail", params.tail);
  f("uTailGlow", params.tailGlow);
  f("uFlash", params.flash);
  f("uCore", params.core);
  f("uEmber", params.ember);
  f("uBloom", params.bloom);
  f("uInk", colours.ink ? 1 : 0);
  c("cLight", colours.light);
  c("cCore", colours.core);
  c("cBloom", colours.bloom);
  c("cEmber", colours.ember);
  f("aBloom", colours.bloomAlpha);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  // The viewport is the canvas's lower-left corner; in image coordinates
  // that is its bottom rows.
  target.clearRect(0, 0, size, size);
  target.drawImage(
    canvas,
    0,
    canvas.height - size,
    size,
    size,
    0,
    0,
    size,
    size,
  );
  stats.draws += 1;
}

/**
 * Milliseconds per frame to draw one aperture of `size` device pixels,
 * waiting for the GPU to finish each frame (gl.finish), so it bounds the
 * GPU cost from above. For the development gallery's budget check (spec
 * §5.4: 1.5 ms at dock size, 4 ms at stage size on a mid-tier phone).
 */
export function measureDraw(size: number, frames = 120): number | null {
  const g = context();
  if (g === null) return null;
  const scratch = document.createElement("canvas");
  scratch.width = size;
  scratch.height = size;
  const target = scratch.getContext("2d");
  if (target === null) return null;
  const params: ApertureParams = {
    radius: 0.52,
    width: 0.05,
    open: 0.4,
    bright: 1.1,
    sweepAmp: 1,
    sweepPhase: 0,
    progress: 0.4,
    tail: 1.6,
    tailGlow: 0.7,
    flash: 0,
    core: 0,
    ember: 0,
    bloom: 1,
  };
  const colours: ApertureColours = {
    light: [0.6, 0.75, 1],
    core: [1, 0.98, 0.95],
    bloom: [0.5, 0.65, 1],
    bloomAlpha: 0.6,
    ember: [0.5, 0.52, 0.58],
    ink: false,
  };
  drawAperture(target, size, params, colours);
  g.gl.finish();
  const start = performance.now();
  for (let i = 0; i < frames; i += 1) {
    drawAperture(target, size, { ...params, sweepPhase: i / frames }, colours);
    g.gl.finish();
  }
  stats.draws -= frames + 1;
  return (performance.now() - start) / frames;
}

/** One aperture, as the scheduler sees it. */
export type Slot = {
  /** Draw now; true while the aperture still needs frames. */
  readonly render: (now: number) => boolean;
  readonly onLost: () => void;
};

const slots = new Set<Slot>();
const dirty = new Set<Slot>();
const live = new Set<Slot>();
let frame = 0;

function tick(now: number): void {
  frame = 0;
  if (document.visibilityState === "hidden") {
    stats.running = false;
    return;
  }
  stats.frames += 1;
  const due = new Set([...dirty, ...live]);
  dirty.clear();
  for (const slot of due) {
    if (!slots.has(slot)) continue;
    if (slot.render(now)) live.add(slot);
    else live.delete(slot);
  }
  schedule();
}

function schedule(): void {
  const wanted = dirty.size > 0 || live.size > 0;
  stats.running = live.size > 0;
  if (!wanted || frame !== 0 || document.visibilityState === "hidden") return;
  frame = window.requestAnimationFrame(tick);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    for (const slot of live) dirty.add(slot);
    schedule();
  }
});

export function register(slot: Slot): () => void {
  slots.add(slot);
  return () => {
    slots.delete(slot);
    dirty.delete(slot);
    live.delete(slot);
    schedule();
  };
}

/** Ask for one frame for this aperture (a state, size or colour change). */
export function invalidate(slot: Slot): void {
  if (!slots.has(slot)) return;
  dirty.add(slot);
  schedule();
}

// Colours come from the --cq-q-* tokens on the aperture's own element, so
// the light follows the theme and the stage without a hex of its own. A
// 1×1 2D canvas turns any CSS colour (oklch included) into sRGB bytes.
let probe: CanvasRenderingContext2D | null = null;
const parsed = new Map<string, readonly [number, number, number, number]>();

function rgba(css: string): readonly [number, number, number, number] {
  const known = parsed.get(css);
  if (known !== undefined) return known;
  if (probe === null) {
    probe = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true });
  }
  if (probe === null) return [0, 0, 0, 1];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  const value = [
    (d[0] ?? 0) / 255,
    (d[1] ?? 0) / 255,
    (d[2] ?? 0) / 255,
    (d[3] ?? 255) / 255,
  ] as const;
  parsed.set(css, value);
  return value;
}

export function readColours(element: Element): ApertureColours {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const rgb = (name: string): Rgb => {
    const [r, g, b] = rgba(token(name));
    return [r, g, b];
  };
  const bloom = rgba(token("--cq-q-bloom"));
  return {
    light: rgb("--cq-q-light"),
    core: rgb("--cq-q-core"),
    bloom: [bloom[0], bloom[1], bloom[2]],
    bloomAlpha: bloom[3],
    ember: rgb("--cq-q-ember"),
    ink: token("--cq-q-ink") === "1",
  };
}
