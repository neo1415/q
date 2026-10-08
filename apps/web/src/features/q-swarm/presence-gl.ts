import type { PresenceSim } from "./presence-dynamics";

/**
 * The 2D swarm (PRESENCE spec §6), now the fallback (ADR 0049): where
 * WebGL2 is missing, its context is lost, or the device asks for light
 * work (Save-Data, low memory, forced colours), the same particles are
 * drawn as soft Canvas2D sprites, flat, with depth only as size. The 3D
 * renderer (presence-3d.ts) is loaded on demand and draws everywhere
 * else. This module stays small: it is in every page that shows Q.
 */

/** Counters for the playground and the acceptance checks. */
export const presenceCounters: {
  contexts: number;
  frames: number;
  fallbackFrames: number;
  renderer: "3d" | "2d" | "none";
} = { contexts: 0, frames: 0, fallbackFrames: 0, renderer: "none" };

export function presenceStats(): {
  readonly contexts: number;
  readonly frames: number;
  readonly fallbackFrames: number;
  readonly webgl: boolean;
  readonly renderer: "3d" | "2d" | "none";
} {
  return {
    ...presenceCounters,
    webgl: presenceCounters.renderer === "3d",
  };
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
  const floor = 0.25;
  for (let i = 0; i < n; i += 1) {
    const depth = Math.max(-1, Math.min(1, sim.z[i] ?? 0));
    const light = Math.max(0, Math.min(1.3, sim.b[i] ?? 0));
    points[i * 4] = half + (sim.x[i] ?? 0) * unit;
    points[i * 4 + 1] = half + (sim.y[i] ?? 0) * unit;
    // Nearer is larger; brighter is a little larger (a glow).
    points[i * 4 + 2] = base * (2.1 + depth * 0.6 + light * 0.6);
    points[i * 4 + 3] = Math.min(1, (floor + light * (1 - floor)) * fade);
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

/** Draws the 2D swarm onto a surface's canvas (sized in device pixels). */
export function drawPresence(
  target: CanvasRenderingContext2D,
  sim: PresenceSim,
  options: DrawOptions,
): void {
  const size = options.pixels;
  const data = layoutPoints(sim, options);
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, size, size);
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
  presenceCounters.fallbackFrames += 1;
  presenceCounters.renderer = "2d";
}
