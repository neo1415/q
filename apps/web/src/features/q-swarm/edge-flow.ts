import type { QApertureState } from "../q-aperture/aperture-state";

/**
 * Presence while Q works (ADR 0062, Q room R7: "particles move around the
 * page while it creates"). Pure and deterministic: a particle's place is a
 * function of its index and the time Q has been working, never of random
 * state, so the same moment draws the same edge and a test can pin it.
 *
 * The particles travel the page's perimeter, inset a few pixels, at a
 * gentle pace. They show only while Q is thinking or working; under
 * reduced motion they never move (a still edge line stands in).
 */

export const EDGE_FLOW = {
  count: 96,
  insetPx: 7,
  /** Laps per second, slowest and fastest. */
  minLapsPerSecond: 0.012,
  maxLapsPerSecond: 0.03,
  minRadiusPx: 0.8,
  maxRadiusPx: 2.2,
} as const;

/** Whether the edge flows for this state. */
export function edgeFlowing(state: QApertureState): boolean {
  return state === "THINKING" || state === "WORKING";
}

/** A fixed pseudo-random number in [0, 1) for an index and a salt. */
function unit(index: number, salt: number): number {
  let x = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return ((x ^ (x >>> 15)) >>> 0) / 4_294_967_296;
}

/** A point `s` of the way (0..1) around a W x H rectangle's inset edge. */
export function edgePoint(
  s: number,
  width: number,
  height: number,
  inset: number = EDGE_FLOW.insetPx,
): readonly [number, number] {
  const w = Math.max(0, width - 2 * inset);
  const h = Math.max(0, height - 2 * inset);
  const perimeter = 2 * (w + h);
  if (perimeter === 0) return [inset, inset];
  let d = (((s % 1) + 1) % 1) * perimeter;
  if (d < w) return [inset + d, inset];
  d -= w;
  if (d < h) return [width - inset, inset + d];
  d -= h;
  if (d < w) return [width - inset - d, height - inset];
  d -= w;
  return [inset, height - inset - d];
}

export type EdgeParticle = {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
};

/**
 * Every particle at `elapsedMs` into the wait. `still` (reduced motion)
 * keeps each at its starting place with a steady alpha.
 */
export function edgeParticles(
  elapsedMs: number,
  width: number,
  height: number,
  still = false,
): readonly EdgeParticle[] {
  const F = EDGE_FLOW;
  const t = still ? 0 : Math.max(0, elapsedMs) / 1_000;
  return Array.from({ length: F.count }, (_, i) => {
    const start = unit(i, 1);
    const speed =
      F.minLapsPerSecond +
      unit(i, 2) * (F.maxLapsPerSecond - F.minLapsPerSecond);
    const phase = unit(i, 3) * Math.PI * 2;
    const [x, y] = edgePoint(start + speed * t, width, height);
    return {
      x,
      y,
      radius: F.minRadiusPx + unit(i, 4) * (F.maxRadiusPx - F.minRadiusPx),
      alpha: still ? 0.5 : 0.35 + 0.45 * Math.abs(Math.sin(phase + t)),
    };
  });
}
