import { FEMALE_FACE_POINTS, MALE_FACE_POINTS } from "./face-points";

/**
 * What Q's particles can form (PRESENCE spec §3-4), as pure functions of
 * time and the voice: a cloud on its own current, the cloud leaning in to
 * listen, an orbit while it works, a head that thinks, a face that speaks,
 * and the gestures an answer asks for -- ? ! $ buildings, a rising chart,
 * clapping hands, a laugh, a tilt, a nod, hands that explain.
 *
 * Every figure has the same number of points, laid out in the same polar
 * order, so particle i is always near the same part of every figure and a
 * change of figure is a short flow rather than a scramble. Coordinates are
 * in one frame-wide unit (about -1.15..1.15 fills the frame) for every
 * figure: there is no per-figure scale jump to snap to.
 *
 * The face is sampled from a real portrait (face-points.ts), weighted
 * towards the features a person reads a face by, given depth from a head
 * ellipsoid and turned in 3D, so it reads as a shaded head rather than a
 * diagram -- and fades at its edges: a presence, not a portrait.
 */

export type FigureKind =
  | "CLOUD"
  | "ATTENTIVE"
  | "ORBIT"
  | "HEAD"
  | "FACE"
  | "QUESTION"
  | "EXCLAIM"
  | "MONEY"
  | "BUILDINGS"
  | "CHART_UP"
  | "CLAP"
  | "LAUGH"
  | "THINK_TILT"
  | "NOD"
  | "HANDS_EXPLAIN";

export const FIGURE_KINDS: readonly FigureKind[] = [
  "CLOUD",
  "ATTENTIVE",
  "ORBIT",
  "HEAD",
  "FACE",
  "QUESTION",
  "EXCLAIM",
  "MONEY",
  "BUILDINGS",
  "CHART_UP",
  "CLAP",
  "LAUGH",
  "THINK_TILT",
  "NOD",
  "HANDS_EXPLAIN",
];

/** Figures that show Q's face. */
export const FACE_FIGURES: ReadonlySet<FigureKind> = new Set([
  "HEAD",
  "FACE",
  "LAUGH",
  "THINK_TILT",
  "NOD",
  "HANDS_EXPLAIN",
]);

/** Figures that show Q's hands. */
export const HAND_FIGURES: ReadonlySet<FigureKind> = new Set([
  "CLAP",
  "HANDS_EXPLAIN",
]);

export type FaceVoice = "FEMALE" | "MALE";

/** What a figure is animated by, each frame. */
export type FigureInput = {
  /** Seconds. */
  readonly t: number;
  /** 0..1 speaker level, already eased. */
  readonly output: number;
  /** 0..1 microphone level, already eased. */
  readonly input: number;
  /** 0 open .. 1 closed. */
  readonly blink: number;
};

/** One evaluated frame of a figure: positions, depth and brightness. */
export type FigureFrame = {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** -1 (far) .. 1 (near); 0 for flat figures. */
  readonly z: Float32Array;
  /** 0..1 brightness. */
  readonly b: Float32Array;
};

export type Figure = {
  readonly kind: FigureKind;
  /** How strongly the flow field moves this figure's points. */
  readonly flow: number;
  readonly evaluate: (input: FigureInput, out: FigureFrame) => void;
};

export function createFigureFrame(count: number): FigureFrame {
  return {
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count),
    b: new Float32Array(count),
  };
}

const TAU = Math.PI * 2;

/** Deterministic, so a figure lays out the same way every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-6, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * random());
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Point sets
// ---------------------------------------------------------------------------

/** Parts of a point, for the face and the hands to move on their own. */
const P = {
  FIELD: 0,
  OUTLINE: 1,
  HAIR: 2,
  EYE: 3,
  BROW: 4,
  NOSE: 5,
  MOUTH_UPPER: 6,
  MOUTH_LOWER: 7,
  BRAIN: 8,
  HAND_LEFT: 9,
  HAND_RIGHT: 10,
  LINE: 11,
  WINDOW: 12,
} as const;
type Part = (typeof P)[keyof typeof P];

const PORTRAIT_PARTS: readonly Part[] = [
  P.OUTLINE,
  P.HAIR,
  P.EYE,
  P.BROW,
  P.NOSE,
  P.MOUTH_UPPER,
  P.MOUTH_LOWER,
  P.BRAIN,
];

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

// --- the portrait ----------------------------------------------------------

const decoded = new Map<FaceVoice, readonly RawPoint[]>();

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Head depth: an ellipsoid, with the nose forward and the eyes set in. */
function depthOf(x: number, y: number, part: Part): number {
  const shell = Math.sqrt(
    Math.max(0, 1 - (x / 0.62) ** 2 - ((y + 0.02) / 0.8) ** 2),
  );
  const bump =
    part === P.NOSE
      ? 0.14 * (1 - Math.min(1, Math.abs(x) / 0.12))
      : part === P.EYE
        ? -0.05
        : part === P.MOUTH_UPPER || part === P.MOUTH_LOWER
          ? 0.04
          : part === P.HAIR
            ? -0.08
            : 0;
  return Math.max(-0.6, Math.min(1, shell * 0.8 + bump));
}

/**
 * The portrait, decoded once (int16 triples: x, y in thousandths, part),
 * with a lower lip made where the sampler found too few points for one:
 * a mouth that cannot open is what made the face read as a cartoon.
 */
function portrait(voice: FaceVoice): readonly RawPoint[] {
  const cached = decoded.get(voice);
  if (cached !== undefined) return cached;
  const bytes = decodeBase64(
    voice === "FEMALE" ? FEMALE_FACE_POINTS : MALE_FACE_POINTS,
  );
  const values = new Int16Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.length / 2),
  );
  const points: RawPoint[] = [];
  for (let i = 0; i + 2 < values.length; i += 3) {
    const x = (values[i] ?? 0) / 1000;
    const y = (values[i + 1] ?? 0) / 1000;
    const part = PORTRAIT_PARTS[values[i + 2] ?? 0] ?? P.OUTLINE;
    points.push({ x, y, z: depthOf(x, y, part), part, u: 0, b: 1 });
  }
  const lower = points.filter((p) => p.part === P.MOUTH_LOWER).length;
  if (lower < 30) {
    const upper = points.filter((p) => p.part === P.MOUTH_UPPER);
    const width = Math.max(0.05, ...upper.map((p) => Math.abs(p.x)));
    for (const p of upper) {
      const across = 1 - (p.x / width) ** 2;
      const y = p.y + 0.04 + 0.025 * across;
      points.push({
        x: p.x * 0.9,
        y,
        z: depthOf(p.x, y, P.MOUTH_LOWER),
        part: P.MOUTH_LOWER,
        u: 0,
        b: 1,
      });
    }
  }
  decoded.set(voice, points);
  return points;
}

/**
 * How much of the swarm each part gets: the features carry a face, so
 * they are dense; hair and the outline only suggest the head.
 */
const PART_SHARE: Partial<Record<Part, number>> = {
  [P.EYE]: 3.4,
  [P.BROW]: 2,
  [P.NOSE]: 2.4,
  [P.MOUTH_UPPER]: 4,
  [P.MOUTH_LOWER]: 4,
  [P.OUTLINE]: 1.3,
  [P.HAIR]: 0.42,
  [P.BRAIN]: 0.5,
};

/** How bright each part reads. Features bright, structure soft. */
const PART_LIGHT: Partial<Record<Part, number>> = {
  [P.EYE]: 1,
  [P.MOUTH_UPPER]: 0.95,
  [P.MOUTH_LOWER]: 0.95,
  [P.BROW]: 0.85,
  [P.NOSE]: 0.75,
  [P.OUTLINE]: 0.6,
  [P.HAIR]: 0.42,
  [P.BRAIN]: 0.35,
};

/** The face's points, weighted by part, scaled to its place in the frame. */
function facePoints(
  voice: FaceVoice,
  count: number,
  scale: number,
  cy: number,
): RawPoint[] {
  const source = portrait(voice);
  const random = seeded(voice === "FEMALE" ? 17 : 29);
  const weights = source.map((p) => PART_SHARE[p.part] ?? 1);
  const total = weights.reduce((sum, w) => sum + w, 0);
  // Systematic sampling by weight: every part is represented in proportion
  // at any swarm size, with no clumping.
  const out: RawPoint[] = [];
  const step = total / count;
  let acc = random() * step;
  let index = 0;
  let running = weights[0] ?? 0;
  for (let i = 0; i < count; i += 1) {
    while (acc > running && index < source.length - 1) {
      index += 1;
      running += weights[index] ?? 0;
    }
    const p = source[index] ?? source[0];
    if (p !== undefined) {
      out.push({
        ...p,
        x: (p.x + (random() - 0.5) * 0.008) * scale,
        y: (p.y + (random() - 0.5) * 0.008) * scale + cy,
        z: p.z,
        b: PART_LIGHT[p.part] ?? 0.6,
      });
    }
    acc += step;
  }
  return out;
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
      const r = 0.55 + Math.sqrt(random()) * 0.45;
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

type Pose = {
  yaw: number;
  pitch: number;
  roll: number;
  /** 0..1 jaw open. */
  mouth: number;
  /** Lip width change, -0.2..0.3. */
  wide: number;
  /** 0..1 eyes closed. */
  blink: number;
  /** Eyes raised (thinking). */
  eyesUp: number;
};

/** The head's 3D pose for each face figure, from time and the voice. */
function poseFor(kind: FigureKind, input: FigureInput): Pose {
  const { t, output } = input;
  switch (kind) {
    case "HEAD":
      // Thinking: looking up and away, the head tilting slowly side to side.
      return {
        yaw: -0.2 + Math.sin(t * 0.5) * 0.1,
        pitch: -0.1 + Math.sin(t * 0.8) * 0.03,
        roll: Math.sin(t * 0.33) * 0.2,
        mouth: 0.04,
        wide: -0.08,
        blink: input.blink,
        eyesUp: 0.02,
      };
    case "THINK_TILT":
      return {
        yaw: -0.15 + Math.sin(t * 0.6) * 0.05,
        pitch: -0.06,
        roll: 0.28 + Math.sin(t * 0.9) * 0.04,
        mouth: 0.05,
        wide: -0.1,
        blink: input.blink,
        eyesUp: 0.03,
      };
    case "NOD":
      return {
        yaw: Math.sin(t * 0.5) * 0.08,
        pitch: Math.sin(t * TAU * 1.3) * 0.16,
        roll: Math.sin(t * 0.4) * 0.03,
        mouth: output * 0.7,
        wide: 0.05,
        blink: input.blink,
        eyesUp: 0,
      };
    case "LAUGH":
      // The head goes back, the mouth opens wide, the eyes narrow.
      return {
        yaw: Math.sin(t * 0.7) * 0.08,
        pitch: -0.34 + Math.sin(t * 15) * 0.05,
        roll: Math.sin(t * 7) * 0.07,
        mouth: 0.75 + Math.abs(Math.sin(t * 12)) * 0.2,
        wide: 0.25,
        blink: 0.6,
        eyesUp: 0,
      };
    case "FACE":
    case "HANDS_EXPLAIN":
    case "CLOUD":
    case "ATTENTIVE":
    case "ORBIT":
    case "QUESTION":
    case "EXCLAIM":
    case "MONEY":
    case "BUILDINGS":
    case "CHART_UP":
    case "CLAP":
      // Speaking: glancing aside and back, a nod on emphasis.
      return {
        yaw: Math.sin(t * 0.55) * 0.2 + Math.sin(t * 1.7) * 0.05,
        pitch: Math.sin(t * 1.3) * 0.03 + output * 0.06 - 0.02,
        roll: Math.sin(t * 0.42) * 0.035 + Math.sin(t * 2.1) * 0.02 * output,
        mouth: output,
        wide: Math.sin(t * 7.3) * 0.1 * output,
        blink: input.blink,
        eyesUp: 0,
      };
  }
}

type FaceLayout = {
  readonly scale: number;
  readonly cy: number;
  readonly handShare: number;
  /** Where each hand rests, and how big it is. */
  readonly hands: {
    readonly x: number;
    readonly y: number;
    readonly size: number;
  } | null;
};

/** The face fills more of the frame than before (founder 2026-10-01). */
export const FACE_SCALE = 1.38;

const FACE_LAYOUT: Partial<Record<FigureKind, FaceLayout>> = {
  HEAD: { scale: FACE_SCALE * 0.94, cy: -0.02, handShare: 0, hands: null },
  FACE: { scale: FACE_SCALE, cy: 0, handShare: 0, hands: null },
  LAUGH: { scale: FACE_SCALE, cy: 0.04, handShare: 0, hands: null },
  THINK_TILT: { scale: FACE_SCALE * 0.96, cy: 0, handShare: 0, hands: null },
  NOD: { scale: FACE_SCALE, cy: 0, handShare: 0, hands: null },
  HANDS_EXPLAIN: {
    scale: FACE_SCALE * 0.72,
    cy: -0.3,
    handShare: 0.28,
    hands: { x: 0.68, y: 0.62, size: 1.5 },
  },
};

function faceFigure(kind: FigureKind, voice: FaceVoice, count: number): Figure {
  const layout = FACE_LAYOUT[kind] ?? {
    scale: FACE_SCALE,
    cy: 0,
    handShare: 0,
    hands: null,
  };
  const random = seeded(kind.length * 977 + (voice === "FEMALE" ? 1 : 2));
  const perHand = Math.floor((count * layout.handShare) / 2);
  const raw = [
    ...facePoints(voice, count - perHand * 2, layout.scale, layout.cy),
    ...(layout.hands === null
      ? []
      : [
          ...handPoints(perHand, -1, random),
          ...handPoints(perHand, 1, random),
        ]),
  ];
  const set = toPointSet(raw, count);
  // Eye centres (left and right) and the mouth's, for blinks and lips.
  const centre = (part: Part, side: number) => {
    let sum = 0;
    let n = 0;
    let sx = 0;
    for (let i = 0; i < count; i += 1) {
      if (set.part[i] !== part) continue;
      const x = set.x[i] ?? 0;
      if (side !== 0 && Math.sign(x) !== side) continue;
      sum += set.y[i] ?? 0;
      sx += x;
      n += 1;
    }
    return n === 0 ? { x: 0, y: 0 } : { x: sx / n, y: sum / n };
  };
  const eyeL = centre(P.EYE, -1);
  const eyeR = centre(P.EYE, 1);
  const mouth = centre(P.MOUTH_UPPER, 0);
  const pivotY = layout.cy + 0.4 * layout.scale;
  const hands = layout.hands;

  return {
    kind,
    flow: 0.012,
    evaluate: (input, out) => {
      const pose = poseFor(kind, input);
      const cyaw = Math.cos(pose.yaw);
      const syaw = Math.sin(pose.yaw);
      const cp = Math.cos(pose.pitch);
      const sp = Math.sin(pose.pitch);
      const cr = Math.cos(pose.roll);
      const sr = Math.sin(pose.roll);
      const t = input.t;
      for (let i = 0; i < count; i += 1) {
        const part = set.part[i] as Part;
        let x = set.x[i] ?? 0;
        let y = set.y[i] ?? 0;
        if (part === P.HAND_LEFT || part === P.HAND_RIGHT) {
          if (hands === null) continue;
          const side = part === P.HAND_LEFT ? -1 : 1;
          // Hands that talk: up and down with the voice, turning a little,
          // opening and closing on emphasis.
          const beat = Math.sin(t * 2.4 + (side > 0 ? 0 : 1.9));
          const lift = 0.1 + beat * 0.08 + input.output * 0.14;
          const angle = side * (0.22 * Math.sin(t * 1.9 + side) + 0.1);
          const spread = 0.75 + 0.25 * Math.sin(t * 3.1 + side * 0.8);
          const u = set.u[i] ?? 0;
          const hx = x * (1 + (spread - 1) * u) * hands.size;
          const hy = y * (1 + (spread - 1) * u * 0.4) * hands.size;
          out.x[i] =
            side * hands.x + hx * Math.cos(angle) - hy * Math.sin(angle);
          out.y[i] =
            hands.y - lift + hx * Math.sin(angle) + hy * Math.cos(angle);
          out.z[i] = 0.4;
          out.b[i] = 0.85;
          continue;
        }
        const z = set.z[i] ?? 0;
        if (part === P.EYE) {
          const eye = x < 0 ? eyeL : eyeR;
          y = eye.y + (y - eye.y) * (1 - 0.88 * pose.blink) - pose.eyesUp;
        } else if (part === P.MOUTH_LOWER) {
          y += pose.mouth * 0.11 * layout.scale;
          x = mouth.x + (x - mouth.x) * (1 + pose.wide);
        } else if (part === P.MOUTH_UPPER) {
          y -= pose.mouth * 0.02 * layout.scale;
          x = mouth.x + (x - mouth.x) * (1 + pose.wide);
        } else if (part === P.OUTLINE && y > mouth.y) {
          // The jaw drops with the mouth.
          y +=
            pose.mouth * 0.05 * layout.scale * Math.min(1, (y - mouth.y) * 4);
        }
        // Yaw about the vertical axis.
        const x1 = x * cyaw + z * syaw * layout.scale * 0.6;
        const z1 = (-x * syaw) / (layout.scale * 0.6) + z * cyaw;
        // Pitch about the neck.
        const dy = y - pivotY;
        // Negative pitch tips the head back (the face rises, as in a laugh).
        const y2 = pivotY + dy * cp + z1 * sp * layout.scale * 0.6;
        const z2 = (-dy * sp) / (layout.scale * 0.6) + z1 * cp;
        // Roll in the picture plane, about the face's centre.
        const ry = y2 - layout.cy;
        const x3 = x1 * cr - ry * sr;
        const y3 = layout.cy + x1 * sr + ry * cr;
        // A little perspective: the near side larger.
        const persp = 1 / (1 - Math.max(-0.6, Math.min(0.9, z2)) * 0.12);
        out.x[i] = x3 * persp;
        out.y[i] = layout.cy + (y3 - layout.cy) * persp;
        out.z[i] = z2;
        // Shading: lit from the front, fading at the head's edge, so it is
        // a presence rather than a cut-out.
        const r = Math.hypot(
          (set.x[i] ?? 0) / (0.62 * layout.scale),
          ((set.y[i] ?? 0) - layout.cy) / (0.8 * layout.scale),
        );
        const edge = 1 - smooth(0.7, 1.12, r) * 0.85;
        out.b[i] =
          (set.b[i] ?? 0.6) *
          (0.5 + 0.5 * Math.max(0, Math.min(1, z2 + 0.2))) *
          edge;
      }
    },
  };
}

/** The resting cloud: a mass carried on slow currents, never the same twice. */
function cloudFigure(count: number): Figure {
  const random = seeded(113);
  const raw: RawPoint[] = Array.from({ length: count }, () => {
    const r = Math.abs(gaussian(random)) * 0.3;
    const a = random() * TAU;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r * 0.85,
      z: 0,
      part: P.FIELD,
      u: random(),
      b: 0.55 + random() * 0.3,
    };
  });
  const set = toPointSet(raw, count);
  return {
    kind: "CLOUD",
    flow: 0.16,
    evaluate: ({ t, output, input }, out) => {
      for (let i = 0; i < count; i += 1) {
        const bx = set.x[i] ?? 0;
        const by = set.y[i] ?? 0;
        const radius = Math.hypot(bx, by);
        const angle =
          Math.atan2(by, bx) + t * 0.16 + radius * Math.sin(t * 0.21) * 1.3;
        const stretch = 1 + 0.32 * Math.sin(t * 0.29 + angle * 2);
        const swell = 1 + output * 0.25 + input * 0.15;
        out.x[i] = Math.cos(angle) * radius * stretch * swell;
        out.y[i] = Math.sin(angle) * radius * (2 - stretch) * swell;
        out.z[i] = 0;
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
    flow: 0.09,
    evaluate: (input, out) => {
      base.evaluate({ ...input, output: 0, input: 0 }, out);
      const level = input.input;
      for (let i = 0; i < count; i += 1) {
        const x = (out.x[i] ?? 0) * 0.82;
        const y = (out.y[i] ?? 0) * 0.82;
        const r = Math.hypot(x, y);
        const ripple =
          1 + level * (0.28 + 0.08 * Math.sin(r * 14 - input.t * 9));
        out.x[i] = x * ripple;
        // Leaning in: forward and a little down, towards whoever speaks.
        out.y[i] = y * ripple + 0.1 + level * 0.04;
        out.b[i] = (out.b[i] ?? 0.6) * (0.85 + level * 0.5);
      }
    },
  };
}

/** Working: a slow orbit, the swarm busy on something. */
function orbitFigure(count: number): Figure {
  const random = seeded(71);
  const raw: RawPoint[] = Array.from({ length: count }, () => {
    const a = random() * TAU;
    const r = 0.5 + gaussian(random) * 0.06;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      z: 0,
      part: P.FIELD,
      u: random(),
      b: 0.6,
    };
  });
  const set = toPointSet(raw, count);
  return {
    kind: "ORBIT",
    flow: 0.05,
    evaluate: ({ t }, out) => {
      for (let i = 0; i < count; i += 1) {
        const bx = set.x[i] ?? 0;
        const by = set.y[i] ?? 0;
        const r = Math.hypot(bx, by);
        const a = Math.atan2(by, bx) + t * (0.9 + (r - 0.5) * 2);
        out.x[i] = Math.cos(a) * r;
        out.y[i] = Math.sin(a) * r * 0.92;
        out.z[i] = 0;
        // A brighter arc travelling round.
        const head = Math.cos(a - t * 2.1);
        out.b[i] = 0.45 + Math.max(0, head) ** 6 * 0.55;
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

/** Builds a figure, with exactly `count` points. */
export function buildFigure(
  kind: FigureKind,
  voice: FaceVoice,
  count: number,
): Figure {
  const random = seeded(kind.length * 131 + count);
  switch (kind) {
    case "CLOUD":
      return cloudFigure(count);
    case "ATTENTIVE":
      return attentiveFigure(count);
    case "ORBIT":
      return orbitFigure(count);
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
    case "HEAD":
    case "FACE":
    case "LAUGH":
    case "THINK_TILT":
    case "NOD":
    case "HANDS_EXPLAIN":
      return faceFigure(kind, voice, count);
  }
}
