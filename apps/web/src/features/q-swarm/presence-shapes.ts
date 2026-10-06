import {
  clamp01,
  depthOf,
  gaussian,
  seeded,
  TAU,
  type Figure,
  type FigureKind,
} from "./presence-kit";

/**
 * Q's free shapes (K1, founder 2026-10-06: "freer... morphing into many
 * shapes... not stuck in a ball"), as approved in design B's presence
 * studio: a ring while Q works, a wave while it speaks without a face, a
 * spiral while it thinks, the Q mark in knots of light when an answer is
 * ready, and a ribbon while Q travels between the dock and the stage.
 *
 * Each shape is a pure function of time and the voice, with the same
 * per-particle seeds, so particle i keeps its character across shapes and
 * a change of shape is the dynamics' staggered flow, never a cut. Shapes
 * carry real state only: nothing here runs unless the presence machine
 * chose the shape from what Q is doing.
 *
 * Coordinates follow the figures' frame (x right, y down, about
 * -1.15..1.15 fills the frame); the studio drew y up at a slightly larger
 * scale, hence SCALE and the flipped y.
 */

/** The studio's units to the frame's: a little inside the edge. */
const SCALE = 0.92;

/** Seven seeds a particle keeps in every shape: four uniform, three normal. */
type Seeds = {
  readonly u0: Float32Array;
  readonly u1: Float32Array;
  readonly u2: Float32Array;
  readonly u3: Float32Array;
  readonly g0: Float32Array;
  readonly g1: Float32Array;
  readonly g2: Float32Array;
};

const seedCache = new Map<number, Seeds>();

function seedsFor(count: number): Seeds {
  const cached = seedCache.get(count);
  if (cached !== undefined) return cached;
  const random = seeded(7_919 + count);
  const make = (fill: () => number) => {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i += 1) out[i] = fill();
    return out;
  };
  const seeds: Seeds = {
    u0: make(random),
    u1: make(random),
    u2: make(random),
    u3: make(random),
    g0: make(() => gaussian(random)),
    g1: make(() => gaussian(random)),
    g2: make(() => gaussian(random)),
  };
  seedCache.set(count, seeds);
  return seeds;
}

/** One studio point (x, y up, z near) written into the frame's space. */
function put(
  out: { x: Float32Array; y: Float32Array; z: Float32Array; b: Float32Array },
  i: number,
  x: number,
  y: number,
  z: number,
  b: number,
): void {
  out.x[i] = x * SCALE;
  out.y[i] = -y * SCALE;
  out.z[i] = depthOf(z * SCALE);
  out.b[i] = b;
}

/** Working: a tilted ring, a brighter arc running round it. */
function ringFigure(count: number): Figure {
  const s = seedsFor(count);
  const tilt = 1.12;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return {
    kind: "RING",
    flow: 0.04,
    evaluate: ({ t, output }, out) => {
      for (let i = 0; i < count; i += 1) {
        const th = (i / count) * TAU + t * 0.6;
        const r =
          0.8 +
          (s.g0[i] ?? 0) * 0.035 +
          output * 0.06 * Math.sin(th * 6 - t * 6);
        const rx = Math.cos(th) * r;
        const ry = Math.sin(th) * r;
        const head = Math.max(0, Math.cos(th - t * 2.1)) ** 6;
        put(
          out,
          i,
          rx + (s.g1[i] ?? 0) * 0.02,
          ry * ct + (s.g2[i] ?? 0) * 0.02,
          ry * st,
          0.5 + head * 0.5,
        );
      }
    },
  };
}

/**
 * Speaking without a face: a sheet of light that rolls with Q's voice,
 * seen from a little above (the studio's camera pitch, baked in).
 */
function waveFigure(count: number): Figure {
  const s = seedsFor(count);
  const columns = 60;
  const rows = Math.max(2, Math.ceil(count / columns));
  const pitch = 0.42;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    kind: "WAVE",
    flow: 0.03,
    evaluate: ({ t, output }, out) => {
      for (let i = 0; i < count; i += 1) {
        const u = (i % columns) / (columns - 1);
        const v = Math.floor(i / columns) / (rows - 1);
        const x = (u - 0.5) * 2.1 + (s.g0[i] ?? 0) * 0.008;
        const z = (v - 0.5) * 1.2 + (s.g1[i] ?? 0) * 0.008;
        const y =
          (0.13 + 0.2 * output) * Math.sin(x * 2.6 + t * 1.9 + z * 1.6) +
          0.05 * Math.sin(z * 5 - t * 1.2);
        // Tipped towards the viewer so the roll reads as depth.
        put(out, i, x, y * cp - z * sp, y * sp + z * cp, 0.55 + 0.35 * v);
      }
    },
  };
}

/** Thinking: two arms turning, dense at the centre, tipped towards the viewer. */
function spiralFigure(count: number): Figure {
  const s = seedsFor(count);
  const tilt = 0.95;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return {
    kind: "SPIRAL",
    flow: 0.035,
    evaluate: ({ t }, out) => {
      for (let i = 0; i < count; i += 1) {
        const rho = 0.06 + 0.92 * Math.sqrt(s.u0[i] ?? 0);
        const arm = i % 2;
        const phi =
          arm * Math.PI +
          rho * 5.4 +
          t * 0.45 +
          (s.g0[i] ?? 0) * 0.22 * (1.1 - rho);
        const px = rho * Math.cos(phi);
        const pz = rho * Math.sin(phi);
        const py = (s.g1[i] ?? 0) * 0.045 * (1.3 - rho);
        put(
          out,
          i,
          px,
          py * ct - pz * st,
          py * st + pz * ct,
          0.5 + 0.45 * (1 - rho),
        );
      }
    },
  };
}

/** Eleven knots round the Q's bowl and two along its tail. */
const KNOTS: readonly (readonly [number, number, number])[] = [
  ...Array.from({ length: 11 }, (_, k) => {
    const a = -Math.PI / 2 + (k / 11) * TAU;
    return [
      Math.cos(a) * 0.68,
      Math.sin(a) * 0.68,
      (k % 3) * 0.05 - 0.05,
    ] as const;
  }),
  [0.62, -0.62, 0.05],
  [0.86, -0.86, 0.1],
];

/**
 * An answer is ready: the Q mark drawn in knots of light, with no
 * connecting lines (Q is not a network diagram), and a faint bowl.
 */
function constellationFigure(count: number): Figure {
  const s = seedsFor(count);
  return {
    kind: "CONSTELLATION",
    flow: 0.015,
    evaluate: ({ t }, out) => {
      for (let i = 0; i < count; i += 1) {
        const knot =
          KNOTS[Math.floor((s.u0[i] ?? 0) * KNOTS.length)] ?? KNOTS[0];
        let x: number;
        let y: number;
        let z: number;
        let b: number;
        if (knot !== undefined && (s.u1[i] ?? 0) < 0.74) {
          const sigma = 0.035 + 0.02 * (s.u2[i] ?? 0);
          x = knot[0] + (s.g0[i] ?? 0) * sigma;
          y = knot[1] + (s.g1[i] ?? 0) * sigma;
          z = knot[2] + (s.g2[i] ?? 0) * sigma;
          b = 0.85;
        } else {
          const a = (s.u2[i] ?? 0) * TAU;
          x = Math.cos(a) * 0.68 + (s.g0[i] ?? 0) * 0.012;
          y = Math.sin(a) * 0.68 + (s.g1[i] ?? 0) * 0.012;
          z = (s.g2[i] ?? 0) * 0.02;
          b = 0.45;
        }
        y += 0.012 * Math.sin(t * 1.3 + (s.u3[i] ?? 0) * TAU);
        put(out, i, x, y, z, b);
      }
    },
  };
}

/** Moving: a twisted ribbon of light, flowing along itself. */
function ribbonFigure(count: number): Figure {
  const s = seedsFor(count);
  return {
    kind: "RIBBON",
    flow: 0.03,
    evaluate: ({ t }, out) => {
      for (let i = 0; i < count; i += 1) {
        const along = (s.u0[i] ?? 0) * TAU + t * 0.22;
        const w = ((s.u1[i] ?? 0) - 0.5) * 0.3;
        const cx = 1.12 * Math.sin(along);
        const cy = 0.3 * Math.sin(2 * along) + 0.08 * Math.sin(3 * along - t);
        const cz = 0.45 * Math.cos(along);
        const twist = along * 1.5 + t * 0.4;
        put(
          out,
          i,
          cx,
          cy + w * Math.cos(twist),
          cz + w * Math.sin(twist),
          0.55 + 0.3 * clamp01(1 - Math.abs(w) / 0.15),
        );
      }
    },
  };
}

/** The free shapes this module builds. */
export type FreeShape = Extract<
  FigureKind,
  "RING" | "WAVE" | "SPIRAL" | "CONSTELLATION" | "RIBBON"
>;

export function buildShape(kind: FreeShape, count: number): Figure {
  switch (kind) {
    case "RING":
      return ringFigure(count);
    case "WAVE":
      return waveFigure(count);
    case "SPIRAL":
      return spiralFigure(count);
    case "CONSTELLATION":
      return constellationFigure(count);
    case "RIBBON":
      return ribbonFigure(count);
  }
}
