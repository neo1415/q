import { faceFigure } from "./presence-face";
import {
  createFigureFrame,
  DEPTH_UNITS,
  gaussian,
  seeded,
  TAU,
  type Figure,
  type FigureFrame,
  type FigureInput,
  type FigureKind,
} from "./presence-kit";
import { buildShape } from "./presence-shapes";

export {
  createFigureFrame,
  DEPTH_UNITS,
  type Figure,
  type FigureFrame,
  type FigureInput,
  type FigureKind,
};

/**
 * What Q's particles can form (PRESENCE spec §3-4; K1-K2, ADR 0051), as
 * pure functions of time and the voice: a cloud on its own current, the
 * cloud leaning in to listen, the free shapes (ring, wave, spiral, the Q
 * mark in knots of light, a ribbon; presence-shapes.ts), a warm human face
 * while Q speaks on the Q page (presence-face.ts), and the gestures an
 * answer asks for -- ? ! $ buildings, a rising chart, clapping hands,
 * hands that explain.
 *
 * Every figure has the same number of points, so a change of figure is a
 * flow rather than a scramble. Coordinates are in one frame-wide unit
 * (about -1.15..1.15 fills the frame) for every figure: there is no
 * per-figure scale jump to snap to.
 */

export const FIGURE_KINDS: readonly FigureKind[] = [
  "CLOUD",
  "ATTENTIVE",
  "RING",
  "WAVE",
  "SPIRAL",
  "CONSTELLATION",
  "RIBBON",
  "FACE",
  "QUESTION",
  "EXCLAIM",
  "MONEY",
  "BUILDINGS",
  "CHART_UP",
  "CLAP",
  "HANDS",
];

/** Figures that show Q's face: only the speaking face (ADR 0051). */
export const FACE_FIGURES: ReadonlySet<FigureKind> = new Set(["FACE"]);

/** Figures that show Q's hands. */
export const HAND_FIGURES: ReadonlySet<FigureKind> = new Set(["CLAP", "HANDS"]);

/**
 * Figures drawn fine: smaller points and a dark floor, so painted tone
 * (the face) reads as light and shade rather than as a lit blob.
 */
export const FINE_FIGURES: ReadonlySet<FigureKind> = new Set(["FACE"]);

// ---------------------------------------------------------------------------
// Point sets
// ---------------------------------------------------------------------------

/** Parts of a point, for the hands and the glyphs to move on their own. */
const P = {
  FIELD: 0,
  HAND_LEFT: 1,
  HAND_RIGHT: 2,
  LINE: 3,
  WINDOW: 4,
} as const;
type Part = (typeof P)[keyof typeof P];

type PointSet = {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly part: Uint8Array;
  /** A per-point parameter (finger position, line position, phase). */
  readonly u: Float32Array;
  readonly b: Float32Array;
};

type RawPoint = {
  x: number;
  y: number;
  z: number;
  part: Part;
  u: number;
  b: number;
};

/**
 * The polar order every figure shares: particle i sits at about the same
 * angle around the centre in every figure, so changing figure is a short
 * flow. Ties broken by radius.
 */
function toPointSet(points: RawPoint[], count: number): PointSet {
  const random = seeded(points.length * 31 + count);
  // Exactly `count` points: repeat (with a hair of jitter) or thin evenly.
  const picked: RawPoint[] = [];
  if (points.length === 0) {
    for (let i = 0; i < count; i += 1) {
      picked.push({ x: 0, y: 0, z: 0, part: P.FIELD, u: 0, b: 0.5 });
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      const at = points[Math.floor((i * points.length) / count)];
      if (at === undefined) continue;
      const again = count > points.length && i % 2 === 1;
      picked.push(
        again
          ? {
              ...at,
              x: at.x + (random() - 0.5) * 0.012,
              y: at.y + (random() - 0.5) * 0.012,
            }
          : at,
      );
    }
  }
  picked.sort((a, b) => {
    const da = Math.atan2(a.y, a.x);
    const db = Math.atan2(b.y, b.x);
    return da === db ? Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) : da - db;
  });
  const set: PointSet = {
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count),
    part: new Uint8Array(count),
    u: new Float32Array(count),
    b: new Float32Array(count),
  };
  picked.forEach((point, i) => {
    set.x[i] = point.x;
    set.y[i] = point.y;
    set.z[i] = point.z;
    set.part[i] = point.part;
    set.u[i] = point.u;
    set.b[i] = point.b;
  });
  return set;
}

/** Points along polylines, evenly by length, with a little thickness. */
function strokes(
  lines: readonly (readonly (readonly [number, number])[])[],
  count: number,
  random: () => number,
  thickness: number,
  part: Part = P.LINE,
): RawPoint[] {
  const segments: {
    a: readonly [number, number];
    b: readonly [number, number];
    len: number;
    at: number;
  }[] = [];
  let total = 0;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i];
      const b = line[i + 1];
      if (a === undefined || b === undefined) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segments.push({ a, b, len, at: total });
      total += len;
    }
  }
  const out: RawPoint[] = [];
  if (total === 0) return out;
  for (let i = 0; i < count; i += 1) {
    const d = ((i + random() * 0.5) / count) * total;
    const seg =
      segments.find((s) => d >= s.at && d <= s.at + s.len) ??
      segments[segments.length - 1];
    if (seg === undefined) continue;
    const f = seg.len === 0 ? 0 : (d - seg.at) / seg.len;
    out.push({
      x: seg.a[0] + (seg.b[0] - seg.a[0]) * f + gaussian(random) * thickness,
      y: seg.a[1] + (seg.b[1] - seg.a[1]) * f + gaussian(random) * thickness,
      z: 0,
      part,
      u: d / total,
      b: 0.85,
    });
  }
  return out;
}

/** A filled disc of points. */
function disc(
  cx: number,
  cy: number,
  r: number,
  count: number,
  random: () => number,
): RawPoint[] {
  return Array.from({ length: count }, () => {
    const a = random() * TAU;
    const d = Math.sqrt(random()) * r;
    return {
      x: cx + Math.cos(a) * d,
      y: cy + Math.sin(a) * d,
      z: 0,
      part: P.LINE,
      u: 1,
      b: 0.95,
    };
  });
}

function arc(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  steps = 24,
): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

/**
 * One open hand, palm towards the person: a palm and four fingers, the
 * thumb out to the side. `u` is how far along a finger a point is (0 on
 * the palm), so the hand can open and close.
 */
function handPoints(
  count: number,
  side: -1 | 1,
  random: () => number,
): RawPoint[] {
  const fingers = [
    { dx: -0.075, len: 0.2, lean: -0.14 },
    { dx: -0.025, len: 0.25, lean: -0.05 },
    { dx: 0.025, len: 0.24, lean: 0.05 },
    { dx: 0.072, len: 0.19, lean: 0.14 },
  ];
  const part = side < 0 ? P.HAND_LEFT : P.HAND_RIGHT;
  return Array.from({ length: count }, (_, i) => {
    const pick = i % 12;
    let x: number;
    let y: number;
    let u = 0;
    if (pick < 4) {
      const a = random() * TAU;
      // A filled palm, a little denser at its edge.
      const r = Math.sqrt(random()) ** 0.7;
      x = Math.cos(a) * r * 0.1;
      y = Math.sin(a) * r * 0.095;
    } else if (pick < 10) {
      const finger = fingers[(pick - 4) % 4] ?? { dx: 0, len: 0.2, lean: 0 };
      u = random();
      x = finger.dx + u * finger.len * finger.lean + (random() - 0.5) * 0.014;
      y = -0.085 - u * finger.len;
    } else {
      u = random();
      x = 0.1 + u * 0.1;
      y = 0.02 - u * 0.1;
    }
    return { x: x * side, y, z: 0.3, part, u, b: 0.9 };
  });
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------
/** The cloud's radius in frame units: room for the voice to swell it and for perspective. */
const CLOUD_RADIUS = 0.88;

/**
 * The resting cloud: a soft sphere of light, denser at its core, turning
 * slowly on a current that shears it -- inner and outer shells turn at
 * different rates and a lobe wanders round -- so it is never the same
 * twice. Real depth (ADR 0049): z is the sphere's, not a shading trick.
 */
function cloudFigure(count: number): Figure {
  const random = seeded(113);
  const raw: RawPoint[] = Array.from({ length: count }, () => {
    const theta = random() * TAU;
    const phi = Math.acos(2 * random() - 1);
    // pow < 1 feathers the edge; the projection of a ball piles up its core.
    const r = random() ** 0.55 * (0.75 + 0.25 * random()) * CLOUD_RADIUS;
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi) * 0.92,
      z: r * Math.sin(phi) * Math.sin(theta),
      part: P.FIELD,
      u: random(),
      b: 0.55 + random() * 0.3,
    };
  });
  const set = toPointSet(raw, count);
  return {
    kind: "CLOUD",
    flow: 0.12,
    evaluate: ({ t, output, input }, out) => {
      const swell = 1 + output * 0.16 + input * 0.1;
      for (let i = 0; i < count; i += 1) {
        const bx = set.x[i] ?? 0;
        const by = set.y[i] ?? 0;
        const bz = set.z[i] ?? 0;
        const ring = Math.hypot(bx, bz) / CLOUD_RADIUS;
        // Turning about the vertical, the shells sheared against each other.
        const a = t * 0.16 + ring * Math.sin(t * 0.21) * 1.1;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const x = bx * ca + bz * sa;
        const z = -bx * sa + bz * ca;
        // One slow lobe that wanders round: smoke, not a star.
        const stretch =
          1 + 0.18 * Math.sin(t * 0.29 + Math.atan2(by, x) + ring * 3.1);
        out.x[i] = x * stretch * swell;
        out.y[i] = by * (2 - stretch) * swell;
        out.z[i] = Math.max(-1, Math.min(1, (z * swell) / DEPTH_UNITS));
        // A spark now and then: never quite still.
        const spark =
          Math.max(0, Math.sin(t * 0.8 + (set.u[i] ?? 0) * 19)) ** 40;
        out.b[i] = (set.b[i] ?? 0.6) + spark * 0.5;
      }
    },
  };
}

/** Listening: the cloud gathers and leans towards the person, rippling with their voice. */
function attentiveFigure(count: number): Figure {
  const base = cloudFigure(count);
  return {
    kind: "ATTENTIVE",
    flow: 0.07,
    evaluate: (input, out) => {
      base.evaluate({ ...input, output: 0, input: 0 }, out);
      const level = input.input;
      for (let i = 0; i < count; i += 1) {
        const x = (out.x[i] ?? 0) * 0.82;
        const y = (out.y[i] ?? 0) * 0.82;
        const z = (out.z[i] ?? 0) * 0.82;
        const r = Math.hypot(x, y, z * DEPTH_UNITS);
        const ripple =
          1 + level * (0.28 + 0.08 * Math.sin(r * 14 - input.t * 9));
        out.x[i] = x * ripple;
        // Leaning in: forward and a little down, towards whoever speaks.
        out.y[i] = y * ripple + 0.1 + level * 0.04;
        out.z[i] = Math.max(-1, Math.min(1, z * ripple + 0.12 + level * 0.1));
        out.b[i] = (out.b[i] ?? 0.6) * (0.85 + level * 0.5);
      }
    },
  };
}

/** A static glyph that breathes. */
function glyphFigure(kind: FigureKind, raw: RawPoint[], count: number): Figure {
  const set = toPointSet(raw, count);
  return {
    kind,
    flow: 0.022,
    evaluate: ({ t, output }, out) => {
      const breathe = 1 + Math.sin(t * 1.6) * 0.025 + output * 0.05;
      const sway = Math.sin(t * 0.9) * 0.04;
      for (let i = 0; i < count; i += 1) {
        const x = (set.x[i] ?? 0) * breathe;
        const y = (set.y[i] ?? 0) * breathe;
        out.x[i] = x + y * sway;
        out.y[i] = y;
        out.z[i] = 0;
        const part = set.part[i];
        const u = set.u[i] ?? 0;
        out.b[i] =
          part === P.WINDOW
            ? 0.5 + 0.5 * Math.max(0, Math.sin(t * 2 + u * 40)) ** 3
            : part === P.LINE && kind === "CHART_UP"
              ? 0.65 +
                0.35 * Math.max(0, Math.cos((u - ((t * 0.5) % 1)) * 9)) ** 4
              : (set.b[i] ?? 0.85);
      }
    },
  };
}

function questionPoints(count: number, random: () => number): RawPoint[] {
  const dot = Math.floor(count * 0.14);
  return [
    ...strokes(
      [
        [
          ...arc(0, -0.36, 0.3, Math.PI * 1.08, Math.PI * 2.32, 30),
          [0, -0.02],
          [0, 0.2],
        ],
      ],
      count - dot,
      random,
      0.035,
    ),
    ...disc(0, 0.46, 0.08, dot, random),
  ];
}

function exclaimPoints(count: number, random: () => number): RawPoint[] {
  const dot = Math.floor(count * 0.16);
  const bar = count - dot;
  const out: RawPoint[] = [];
  for (let i = 0; i < bar; i += 1) {
    const u = random();
    const y = -0.68 + u * 0.9;
    const half = 0.1 - u * 0.055;
    out.push({
      x: (random() * 2 - 1) * half,
      y,
      z: 0,
      part: P.LINE,
      u,
      b: 0.9,
    });
  }
  return [...out, ...disc(0, 0.43, 0.085, dot, random)];
}

function moneyPoints(count: number, random: () => number): RawPoint[] {
  // The S: an upper bowl drawn the long way round, a lower bowl the other.
  const upper = arc(0, -0.2, 0.23, -0.35, -Math.PI * 1.5, 28);
  const lower = arc(0, 0.26, 0.23, -Math.PI * 0.5, Math.PI * 0.85, 28);
  const bar = Math.floor(count * 0.22);
  return [
    ...strokes([[...upper, ...lower]], count - bar, random, 0.032),
    ...strokes(
      [
        [
          [0, -0.66],
          [0, 0.72],
        ],
      ],
      bar,
      random,
      0.022,
    ),
  ];
}

function buildingPoints(count: number, random: () => number): RawPoint[] {
  const ground = 0.62;
  const towers: [number, number, number][] = [
    [-0.82, -0.52, -0.05],
    [-0.46, -0.12, -0.7],
    [-0.06, 0.24, -0.35],
    [0.3, 0.56, -0.9],
    [0.62, 0.86, -0.2],
  ];
  const outline = Math.floor(count * 0.62);
  const lines = towers.map(([x0, x1, top]) => [
    [x0, ground] as const,
    [x0, top] as const,
    [x1, top] as const,
    [x1, ground] as const,
  ]);
  const windows: RawPoint[] = [];
  const perWindow = count - outline;
  for (let i = 0; i < perWindow; i += 1) {
    const tower = towers[i % towers.length] ?? towers[0];
    if (tower === undefined) continue;
    const [x0, x1, top] = tower;
    const cols = 2;
    const col = Math.floor(random() * cols);
    const rows = Math.max(2, Math.round((ground - top) / 0.14));
    const row = Math.floor(random() * rows);
    windows.push({
      x: x0 + ((x1 - x0) * (col + 0.5)) / cols + (random() - 0.5) * 0.04,
      y:
        top +
        0.08 +
        row * ((ground - top - 0.12) / rows) +
        (random() - 0.5) * 0.02,
      z: 0,
      part: P.WINDOW,
      u: random(),
      b: 0.7,
    });
  }
  return [
    ...strokes(
      [
        ...lines,
        [
          [-0.95, ground],
          [0.95, ground],
        ],
      ],
      outline,
      random,
      0.016,
    ),
    ...windows,
  ];
}

function chartPoints(count: number, random: () => number): RawPoint[] {
  const axes = Math.floor(count * 0.3);
  const head = Math.floor(count * 0.12);
  return [
    ...strokes(
      [
        [
          [-0.75, -0.7],
          [-0.75, 0.6],
          [0.8, 0.6],
        ],
      ],
      axes,
      random,
      0.012,
      P.FIELD,
    ),
    ...strokes(
      [
        [
          [-0.62, 0.42],
          [-0.3, 0.12],
          [-0.02, 0.24],
          [0.5, -0.42],
        ],
      ],
      count - axes - head,
      random,
      0.026,
    ),
    ...strokes(
      [
        [
          [0.3, -0.42],
          [0.56, -0.5],
          [0.5, -0.22],
        ],
      ],
      head,
      random,
      0.022,
    ),
  ];
}

/** Two hands meeting and parting: Q applauding. */
function clapFigure(count: number): Figure {
  const random = seeded(311);
  const half = Math.floor(count / 2);
  const raw = [
    ...handPoints(half, -1, random),
    ...handPoints(count - half, 1, random),
  ];
  const set = toPointSet(raw, count);
  return {
    kind: "CLAP",
    flow: 0.015,
    evaluate: ({ t }, out) => {
      // About two claps a second, eased so the hands slow as they meet.
      const phase = (t * 2.1) % 1;
      const open = 0.5 - 0.5 * Math.cos(phase * TAU);
      for (let i = 0; i < count; i += 1) {
        const side = set.part[i] === P.HAND_LEFT ? -1 : 1;
        const angle = side * (0.5 - open * 0.25);
        const hx = (set.x[i] ?? 0) * 2.1;
        const hy = (set.y[i] ?? 0) * 2.1;
        out.x[i] =
          side * (0.12 + open * 0.34) +
          hx * Math.cos(angle) -
          hy * Math.sin(angle);
        out.y[i] = 0.25 + hx * Math.sin(angle) + hy * Math.cos(angle);
        out.z[i] = 0.3;
        out.b[i] = 0.75 + (1 - open) * 0.25;
      }
    },
  };
}

/**
 * Hands that explain, without a face (the old face's gesture, ADR 0051):
 * two open hands either side, rising and turning with the voice.
 */
function handsFigure(count: number): Figure {
  const random = seeded(419);
  const half = Math.floor(count / 2);
  const raw = [
    ...handPoints(half, -1, random),
    ...handPoints(count - half, 1, random),
  ];
  const set = toPointSet(raw, count);
  return {
    kind: "HANDS",
    flow: 0.015,
    evaluate: ({ t, output }, out) => {
      for (let i = 0; i < count; i += 1) {
        const side = set.part[i] === P.HAND_LEFT ? -1 : 1;
        const beat = Math.sin(t * 2.4 + (side > 0 ? 0 : 1.9));
        const lift = 0.1 + beat * 0.08 + output * 0.14;
        const angle = side * (0.22 * Math.sin(t * 1.9 + side) + 0.1);
        const spread = 0.75 + 0.25 * Math.sin(t * 3.1 + side * 0.8);
        const u = set.u[i] ?? 0;
        const hx = (set.x[i] ?? 0) * (1 + (spread - 1) * u) * 2;
        const hy = (set.y[i] ?? 0) * (1 + (spread - 1) * u * 0.4) * 2;
        out.x[i] = side * 0.5 + hx * Math.cos(angle) - hy * Math.sin(angle);
        out.y[i] = 0.35 - lift + hx * Math.sin(angle) + hy * Math.cos(angle);
        out.z[i] = 0.4;
        out.b[i] = 0.85;
      }
    },
  };
}

/** Builds a figure, with exactly `count` points. */
export function buildFigure(kind: FigureKind, count: number): Figure {
  const random = seeded(kind.length * 131 + count);
  switch (kind) {
    case "CLOUD":
      return cloudFigure(count);
    case "ATTENTIVE":
      return attentiveFigure(count);
    case "FACE":
      return faceFigure(count);
    case "QUESTION":
      return glyphFigure(kind, questionPoints(count, random), count);
    case "EXCLAIM":
      return glyphFigure(kind, exclaimPoints(count, random), count);
    case "MONEY":
      return glyphFigure(kind, moneyPoints(count, random), count);
    case "BUILDINGS":
      return glyphFigure(kind, buildingPoints(count, random), count);
    case "CHART_UP":
      return glyphFigure(kind, chartPoints(count, random), count);
    case "CLAP":
      return clapFigure(count);
    case "HANDS":
      return handsFigure(count);
    case "RING":
    case "WAVE":
    case "SPIRAL":
    case "CONSTELLATION":
    case "RIBBON":
      return buildShape(kind, count);
  }
}
