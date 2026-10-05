import {
  clamp01,
  depthOf,
  gaussian,
  seeded,
  TAU,
  type Figure,
} from "./presence-kit";

/**
 * Q's speaking face (K2, ADR 0051): design B's option B, a warm human
 * face in particles. The founder's words: "the face looks like a demon...
 * either scrap the face or a proper human being's face... I'll prefer
 * that". It replaces the portrait-sampled face entirely.
 *
 * What made the old face read as a demon, and what this one does instead:
 * - hollow dark sockets and mouth (a skull): here the skin is an even,
 *   jittered surface lit softly from the front, never black, with only
 *   a soft eye shade;
 * - bright staring eyes: here the lids, brows and lips are thin, dim
 *   lines of light, the iris a faint ring with one catchlight;
 * - edge-traced features: here the features come from a painted tone map
 *   (forehead, nose, cheeks, lips catch light), not outlines.
 *
 * The mouth is a closed smile; the lids blink; the lower lip and chin move
 * with Q's voice amplitude. Shown only while Q speaks on the Q page at
 * 160 px or more (presence-machine `faceAllowed`); everywhere else the
 * presence has no face.
 */

const PART = {
  SKIN: 0,
  LOWER_LIP: 1,
  CHIN: 2,
  HAIR: 3,
  LID: 4,
  IRIS: 5,
  BROW: 6,
  MOUTH: 7,
  LINE: 8,
  NECK: 9,
} as const;
type Part = (typeof PART)[keyof typeof PART];

type FacePoint = { x: number; y: number; z: number; part: Part; b: number };

/** The studio's units to the frame's (y is flipped at evaluation). */
export const FACE_FRAME_SCALE = 1;
const SCALE = FACE_FRAME_SCALE;

const G = (dx: number, dy: number, sx: number, sy: number) =>
  Math.exp(-(dx * dx) / sx - (dy * dy) / sy);

const jaw = (y: number) =>
  y < -0.15 ? 1 - 0.3 * Math.pow(clamp01((-0.15 - y) / 0.71), 1.3) : 1;

/** Half the face's width at height y (y up, the studio's frame). */
const halfWidth = (y: number) =>
  0.6 * Math.sqrt(clamp01(1 - Math.pow((y - 0.04) / 0.88, 2))) * jaw(y);

/** Relief: a head with a nose, brow ridge, cheeks, lips and chin. */
function height(x: number, y: number): number {
  const w = Math.max(halfWidth(y), 1e-3);
  const ax = Math.abs(x);
  let z =
    0.42 *
    Math.sqrt(clamp01(1 - Math.pow(x / (w * 1.06), 2))) *
    Math.sqrt(clamp01(1 - Math.pow((y - 0.04) / 0.92, 2)));
  z +=
    0.11 *
    G(x, 0, 0.0035, 1) *
    clamp01((0.12 - y) / 0.1) *
    clamp01((y + 0.22) / 0.06);
  z += 0.09 * G(x, y + 0.17, 0.006, 0.004);
  z += 0.02 * G(ax - 0.065, y + 0.19, 0.0016, 0.0016);
  z += 0.04 * G(0, y - 0.23, 1, 0.006) * clamp01(1 - ax / 0.42);
  z -= 0.04 * G(ax - 0.23, y - 0.1, 0.012, 0.0045);
  z += 0.026 * G(ax - 0.23, y - 0.1, 0.0045, 0.0022);
  z += 0.05 * G(ax - 0.27, y + 0.12, 0.018, 0.016);
  z += 0.04 * G(x, y + 0.385, 0.014, 0.0011);
  z += 0.045 * G(x, y + 0.45, 0.011, 0.0016);
  z += 0.045 * G(x, y + 0.7, 0.012, 0.008);
  return z;
}

/**
 * Tone is painted, not lit: a portrait painter's map of where light sits
 * on a face, with soft shade that is never black.
 */
function tone(x: number, y: number): number {
  const ax = Math.abs(x);
  const w = Math.max(halfWidth(y), 1e-3);
  let b = 0.42;
  b += 0.28 * G(x, y - 0.4, 0.06, 0.03);
  b += 0.3 * G(ax - 0.27, y + 0.1, 0.012, 0.01);
  b += 0.3 * G(x + 0.012, y + 0.04, 0.0012, 0.025);
  b += 0.25 * G(x, y + 0.16, 0.003, 0.002);
  b -= 0.2 * G(x, y + 0.235, 0.008, 0.0012);
  b -= 0.12 * G(ax - 0.23, y - 0.1, 0.009, 0.004);
  b += 0.14 * G(x, y + 0.385, 0.01, 0.0008);
  b += 0.24 * G(x, y + 0.45, 0.008, 0.0012);
  b -= 0.15 * G(x, y + 0.53, 0.01, 0.0015);
  b += 0.12 * G(x, y + 0.7, 0.01, 0.006);
  b -= 0.3 * Math.pow(ax / w, 3);
  return clamp01(b);
}

/** The closed smile: the corners a little higher than the middle. */
const mouthY = (x: number) => -0.418 + 0.03 * Math.pow(x / 0.13, 2);

const hairline = (x: number) => 0.6 - 0.32 * x * x;

/** The face's points (studio frame, y up), exactly `count` of them. */
export function facePoints(count: number): FacePoint[] {
  const random = seeded(11);
  const points: FacePoint[] = [];
  const add = (x: number, y: number, z: number, part: Part, b: number) =>
    points.push({ x, y, z, part, b });
  const share = (f: number) => Math.max(2, Math.round(count * f));

  // Skin on a jittered grid: an even surface, so light, not clumps, shapes
  // it. The grid follows the swarm's size so a phone's face is as whole.
  const step = Math.max(0.018, Math.min(0.05, 0.024 * Math.sqrt(4200 / count)));
  for (let gy = -0.86; gy < 0.9; gy += step) {
    for (let gx = -0.62; gx < 0.62; gx += step) {
      const x = gx + (random() - 0.5) * step * 0.9;
      const y = gy + (random() - 0.5) * step * 0.9;
      if (Math.abs(x) > halfWidth(y) || y > hairline(x)) continue;
      let b = tone(x, y);
      if (Math.abs(x) < 0.14 && Math.abs(y - mouthY(x)) < 0.008) b *= 0.35;
      const part: Part =
        y < mouthY(x) && y > -0.52 && Math.abs(x) < 0.15
          ? PART.LOWER_LIP
          : y < -0.52
            ? PART.CHIN
            : PART.SKIN;
      add(x, y, height(x, y), part, b);
    }
  }
  // Hair on a coarser grid, framing the face, darker than the skin.
  const hairStep = step * 1.17;
  for (let gy = -0.75; gy < 1.12; gy += hairStep) {
    for (let gx = -0.8; gx < 0.8; gx += hairStep) {
      const x = gx + (random() - 0.5) * hairStep;
      const y = gy + (random() - 0.5) * hairStep;
      const top = (x / 0.72) ** 2 + ((y - 0.1) / 1.0) ** 2 < 1 && y > 0.05;
      const sides =
        Math.abs(x) < 0.76 - 0.06 * clamp01(-y) &&
        y <= 0.1 &&
        y > -0.75 + 0.25 * (1 - Math.abs(x) / 0.76);
      const inFace = Math.abs(x) < halfWidth(y) + 0.015 && y <= hairline(x);
      if (!(top || sides) || inFace) continue;
      if (y < -0.5 && Math.abs(x) < 0.3) continue;
      const strand =
        0.5 +
        0.5 *
          Math.sin(Math.atan2(y - 0.3, x) * 38 + Math.hypot(x, y - 0.3) * 4);
      const fall = clamp01((y + 0.75) / 0.4);
      add(
        x,
        y,
        0.1 * Math.sqrt(clamp01(1 - (x / 0.8) ** 2)) - 0.1,
        PART.HAIR,
        (0.05 + 0.13 * strand) * fall,
      );
    }
  }
  // Eyes: a thin lid line, a faint iris ring, one catchlight; brows above.
  for (const side of [-1, 1]) {
    const ex = side * 0.23;
    const ey = 0.1;
    const lid = share(0.012);
    for (let i = 0; i < lid; i += 1) {
      const u = (i / (lid - 1)) * 2 - 1;
      const x = ex + u * 0.085;
      const y = ey + 0.036 * (1 - u * u) - 0.004 + gaussian(random) * 0.003;
      add(x, y, height(x, y) + 0.01, PART.LID, 0.72);
    }
    const iris = share(0.008);
    for (let i = 0; i < iris; i += 1) {
      const a = (i / iris) * TAU;
      add(
        ex + Math.cos(a) * 0.026,
        ey + 0.004 + Math.sin(a) * 0.026 * 0.85,
        height(ex, ey) + 0.012,
        PART.IRIS,
        0.45,
      );
    }
    add(ex + 0.01, ey + 0.016, height(ex, ey) + 0.02, PART.IRIS, 0.9);
    add(ex + 0.013, ey + 0.013, height(ex, ey) + 0.02, PART.IRIS, 0.75);
    const brow = share(0.01);
    for (let i = 0; i < brow; i += 1) {
      const u = i / (brow - 1);
      const x = side * (0.12 + u * 0.23);
      const y =
        0.245 +
        0.035 * Math.sin(u * Math.PI * 0.9) -
        u * 0.01 +
        gaussian(random) * 0.005;
      add(x, y, height(x, y) + 0.008, PART.BROW, 0.5);
    }
  }
  // Mouth and nose as quiet lines of light, the same hand as the lids.
  const line = (
    n: number,
    fx: (u: number) => number,
    fy: (u: number) => number,
    b: number,
    part: Part,
  ) => {
    for (let i = 0; i < n; i += 1) {
      const u = (i / (n - 1)) * 2 - 1;
      const x = fx(u);
      const y = fy(u) + gaussian(random) * 0.0025;
      add(x, y, height(x, y) + 0.012, part, b);
    }
  };
  line(
    share(0.011),
    (u) => u * 0.13,
    (u) => mouthY(u * 0.13),
    0.7,
    PART.MOUTH,
  );
  line(
    share(0.007),
    (u) => u * 0.09,
    (u) => -0.468 + 0.022 * u * u,
    0.38,
    PART.LOWER_LIP,
  );
  line(
    share(0.006),
    (u) => u * 0.06,
    (u) => -0.372 - 0.012 * Math.cos(u * Math.PI * 2) * (1 - Math.abs(u)),
    0.32,
    PART.LINE,
  );
  line(
    share(0.006),
    (u) => u * 0.065,
    (u) => -0.2 + 0.03 * u * u,
    0.5,
    PART.LINE,
  );
  line(
    share(0.004),
    (u) => -0.035 + u * 0.004,
    (u) => 0.02 - (u + 1) * 0.08,
    0.26,
    PART.LINE,
  );

  // Over budget: thin skin and hair evenly, never the eyes, brows or lips.
  const keep = Math.floor(count * 0.97);
  let thinnable = points.filter(
    (p) => p.part === PART.SKIN || p.part === PART.HAIR,
  ).length;
  let excess = points.length - keep;
  const kept: FacePoint[] = [];
  for (const p of points) {
    const thin = p.part === PART.SKIN || p.part === PART.HAIR;
    if (thin && excess > 0 && random() < excess / Math.max(1, thinnable)) {
      excess -= 1;
      thinnable -= 1;
      continue;
    }
    if (thin) thinnable -= 1;
    kept.push(p);
  }
  // Under budget: a hint of neck and shoulders.
  while (kept.length < count) {
    if (random() < 0.3) {
      kept.push({
        x: (random() * 2 - 1) * 0.19,
        y: -0.78 - random() * 0.3,
        z: 0.12,
        part: PART.NECK,
        b: 0.14,
      });
    } else {
      const u = random() * 2 - 1;
      kept.push({
        x: u * 0.95,
        y: -1.12 + 0.16 * (1 - u * u) + gaussian(random) * 0.02,
        z: 0,
        part: PART.NECK,
        b: 0.12,
      });
    }
  }
  kept.length = count;
  // Shuffled, so a shape flowing into the face gathers from everywhere.
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = kept[i];
    const b = kept[j];
    if (a !== undefined && b !== undefined) {
      kept[i] = b;
      kept[j] = a;
    }
  }
  return kept;
}

/** The part names, for the tests. */
export const FACE_PARTS = PART;

export function faceFigure(count: number): Figure {
  const points = facePoints(count);
  const x0 = Float32Array.from(points, (p) => p.x);
  const y0 = Float32Array.from(points, (p) => p.y);
  const z0 = Float32Array.from(points, (p) => p.z);
  const part = Uint8Array.from(points, (p) => p.part);
  // Painted tone to brightness: the lit planes carry the face.
  const light = Float32Array.from(points, (p) =>
    Math.min(1.3, Math.pow(p.b, 1.25) * 1.6),
  );
  return {
    kind: "FACE",
    flow: 0.006,
    evaluate: ({ t, output, blink }, out) => {
      const level = clamp01(output);
      const bob = 0.01 * Math.sin(t * 0.9);
      for (let i = 0; i < count; i += 1) {
        const p = part[i];
        const x = x0[i] ?? 0;
        let y = (y0[i] ?? 0) + bob;
        let b = light[i] ?? 0;
        if (p === PART.LID) y -= blink * 0.03;
        if (p === PART.IRIS) b *= 1 - blink;
        if (p === PART.LOWER_LIP || p === PART.MOUTH) {
          // The lower lip drops with the voice; the mouth line half as far.
          y -=
            (p === PART.MOUTH ? 0.5 : 1) *
            level *
            0.05 *
            clamp01(1 - Math.pow(x / 0.14, 2));
        }
        if (p === PART.CHIN) y -= level * 0.03;
        out.x[i] = x * SCALE;
        out.y[i] = -y * SCALE;
        out.z[i] = depthOf((z0[i] ?? 0) * SCALE);
        out.b[i] = b;
      }
    },
  };
}

/** Which points are which part, for the tests (lower lip moves with voice). */
export function facePartsOf(count: number): Uint8Array {
  return Uint8Array.from(facePoints(count), (p) => p.part);
}
