/**
 * What the swarm can become (founder direction 2026-09-29): the letter Q,
 * an abstract face (a woman's when Q speaks in the female voice, a man's
 * in the male one), a ring while it works, and any glyph -- an emoji, a
 * hand -- sampled from how the browser draws it. Every shape is a list of
 * points in a unit square centred on 0, each tagged with the part of the
 * figure it belongs to, so the engine can light the brain while thinking,
 * move the mouth while speaking and turn the head while it talks.
 *
 * Abstraction is the point: dots suggesting a face, never a portrait.
 */

import { FEMALE_FACE_POINTS, MALE_FACE_POINTS } from "./face-points";

export type SwarmPart =
  | "OUTLINE"
  | "HAIR"
  | "EYE"
  | "BROW"
  | "NOSE"
  | "MOUTH_UPPER"
  | "MOUTH_LOWER"
  | "BRAIN"
  | "GLYPH"
  /** A point of a free figure the engine keeps moving (wave, galaxy, bloom). */
  | "FIELD";

export type SwarmPoint = {
  readonly x: number;
  readonly y: number;
  readonly part: SwarmPart;
};

export type SwarmFace = "FEMALE" | "MALE";

const TAU = Math.PI * 2;

/** A deterministic sequence, so the same shape lays out the same way. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  count: number,
  part: SwarmPart,
  from = 0,
  to = TAU,
): SwarmPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = from + ((to - from) * i) / Math.max(1, count - 1);
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, part };
  });
}

/** The Q: a thick ring and its tail, as in the splash. */
export function qShape(count: number): SwarmPoint[] {
  const random = seeded(81);
  return Array.from({ length: count }, (_, i) => {
    const tail = i > count * 0.86;
    if (tail) {
      const along = random();
      const across = (random() - 0.5) * 0.09;
      return {
        x: 0.2 + along * 0.42 + across,
        y: 0.22 + along * 0.42 - across,
        part: "GLYPH" as const,
      };
    }
    const angle = random() * TAU;
    const radius = 0.5 + random() * 0.14;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius - 0.03,
      part: "GLYPH" as const,
    };
  });
}

/** A ring the swarm runs round while Q works: the loading state. */
export function ringShape(count: number): SwarmPoint[] {
  return ellipse(0, 0, 0.58, 0.58, count, "GLYPH");
}

/**
 * A mouth, close up: two lips the engine opens with Q's voice. Speaking
 * as a whole figure (founder direction 2026-09-29: "sometimes it just
 * forms a mouth speaking").
 */
export function mouthShape(count: number): SwarmPoint[] {
  const random = seeded(43);
  return Array.from({ length: count }, (_, i) => {
    const upper = i % 2 === 0;
    const u = random() * 2 - 1;
    // A cupid's bow on top, a fuller curve below; filled, not outlined.
    const edge = upper
      ? -0.1 - 0.12 * (1 - u * u) + 0.05 * Math.exp(-(u * u) / 0.02)
      : 0.1 + 0.2 * (1 - u * u);
    const fill = random();
    const y = edge * (0.55 + fill * 0.45);
    return {
      x: u * 0.68,
      y,
      part: upper ? ("MOUTH_UPPER" as const) : ("MOUTH_LOWER" as const),
    };
  });
}

/** A line across the middle the engine turns into a moving sound wave. */
export function waveShape(count: number): SwarmPoint[] {
  const random = seeded(59);
  return Array.from({ length: count }, (_, i) => ({
    x: (i / Math.max(1, count - 1)) * 1.5 - 0.75,
    y: (random() - 0.5) * 0.03,
    part: "FIELD" as const,
  }));
}

/** Spiral arms; the engine turns them, so the swarm reads as a galaxy. */
export function galaxyShape(count: number): SwarmPoint[] {
  const random = seeded(71);
  return Array.from({ length: count }, (_, i) => {
    const arm = i % 3;
    const along = Math.sqrt(random());
    const angle = along * 3.4 + (arm * TAU) / 3 + (random() - 0.5) * 0.5;
    const radius = along * 0.68;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      part: "FIELD" as const,
    };
  });
}

/**
 * A formless mass (founder live 2026-09-29: "never rests... it can just be
 * a mass, formless"): a soft cloud the engine keeps churning like smoke.
 */
export function formlessShape(count: number): SwarmPoint[] {
  const random = seeded(113);
  return Array.from({ length: count }, () => {
    // Roughly gaussian, so the mass is dense at its heart and thins out.
    const r = Math.sqrt(-2 * Math.log(Math.max(1e-6, random()))) * 0.26;
    const angle = random() * TAU;
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * 0.85,
      part: "FIELD" as const,
    };
  });
}

/** A seed field the engine blooms into petals that open and close. */
export function bloomShape(count: number): SwarmPoint[] {
  const random = seeded(97);
  return Array.from({ length: count }, () => {
    const angle = random() * TAU;
    const radius = 0.15 + random() * 0.5;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      part: "FIELD" as const,
    };
  });
}

const FACE_PARTS: readonly SwarmPart[] = [
  "OUTLINE",
  "HAIR",
  "EYE",
  "BROW",
  "NOSE",
  "MOUTH_UPPER",
  "MOUTH_LOWER",
  "BRAIN",
];

const decoded = new Map<SwarmFace, readonly SwarmPoint[]>();

/** The portrait cloud, decoded once: int16 triples of x, y (thousandths) and part. */
function portrait(face: SwarmFace): readonly SwarmPoint[] {
  const cached = decoded.get(face);
  if (cached !== undefined) return cached;
  const binary = atob(
    face === "FEMALE" ? FEMALE_FACE_POINTS : MALE_FACE_POINTS,
  );
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const values = new Int16Array(bytes.buffer);
  const points: SwarmPoint[] = [];
  for (let i = 0; i + 2 < values.length; i += 3) {
    points.push({
      x: (values[i] ?? 0) / 1000,
      y: (values[i + 1] ?? 0) / 1000,
      part: FACE_PARTS[values[i + 2] ?? 0] ?? "OUTLINE",
    });
  }
  decoded.set(face, points);
  return points;
}

/**
 * A face (founder live 2026-09-29: "very realistic, but still abstract
 * enough"): sampled from a real frontal portrait -- a woman's for the
 * female voice, a man's for the male -- where it is inked, weighted to its
 * edges and shading, so the swarm draws a real face's structure as light
 * rather than a diagram of one. Parts are labelled so the eyes, brows,
 * mouth and the brain above them can move and light on their own.
 */
export function faceShape(face: SwarmFace, count: number): SwarmPoint[] {
  const source = portrait(face);
  if (source.length === 0) return qShape(count);
  const random = seeded(face === "FEMALE" ? 17 : 29);
  return Array.from({ length: count }, (_, i) => {
    // Evenly through the cloud, so any swarm size keeps every part.
    const at = source[Math.floor((i * source.length) / count)] ?? source[0];
    const jitter = count > source.length ? 0.006 : 0;
    return {
      x: (at?.x ?? 0) + (random() - 0.5) * jitter,
      y: (at?.y ?? 0) + (random() - 0.5) * jitter,
      part: at?.part ?? "OUTLINE",
    };
  });
}

/**
 * Any glyph -- an emoji, a hand, a mark -- as the swarm can hold it:
 * drawn once off screen and sampled where it is inked. Browser-drawn, so
 * no image is fetched and nothing is copied from an artwork.
 */
export function glyphShape(glyph: string, count: number): SwarmPoint[] {
  if (typeof document === "undefined") return qShape(count);
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return qShape(count);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${String(size * 0.8)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.fillText(glyph, size / 2, size / 2 + size * 0.04);
  const pixels = context.getImageData(0, 0, size, size).data;
  const inked: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      if ((pixels[(y * size + x) * 4 + 3] ?? 0) > 96) {
        inked.push({ x: x / size - 0.5, y: y / size - 0.5 });
      }
    }
  }
  if (inked.length === 0) return qShape(count);
  const random = seeded(glyph.codePointAt(0) ?? 7);
  return Array.from({ length: count }, () => {
    const at = inked[Math.floor(random() * inked.length)] ?? { x: 0, y: 0 };
    return {
      x: at.x * 1.5 + (random() - 0.5) * 0.02,
      y: at.y * 1.5 + (random() - 0.5) * 0.02,
      part: "GLYPH" as const,
    };
  });
}
