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

/**
 * An abstract face. Proportions are a portrait's: eyes at mid-height,
 * the mouth a third of the way up from the chin. The two differ where
 * people read them at a glance -- hair length and line, jaw, brow weight.
 */
export function faceShape(face: SwarmFace, count: number): SwarmPoint[] {
  const random = seeded(face === "FEMALE" ? 17 : 29);
  const points: SwarmPoint[] = [];
  const female = face === "FEMALE";
  const share = (fraction: number) => Math.max(4, Math.round(count * fraction));

  // Head outline: a softer, narrower jaw for the female face.
  const jaw = female ? 0.52 : 0.58;
  points.push(
    ...ellipse(
      0,
      -0.02,
      female ? 0.42 : 0.45,
      0.58,
      share(0.2),
      "OUTLINE",
      Math.PI * 0.05,
      Math.PI * 0.95,
    ).map((p) => ({
      ...p,
      y: p.y > 0.25 ? 0.25 + (p.y - 0.25) * (jaw / 0.58) : p.y,
    })),
    ...ellipse(
      0,
      -0.02,
      female ? 0.42 : 0.45,
      0.58,
      share(0.12),
      "OUTLINE",
      Math.PI * 1.02,
      Math.PI * 1.98,
    ),
  );

  // Hair: long and falling past the jaw, or short and close to the crown.
  const hairCount = share(female ? 0.2 : 0.12);
  for (let i = 0; i < hairCount; i++) {
    const t = random();
    if (female) {
      const side = random() < 0.5 ? -1 : 1;
      const top = random() < 0.4;
      points.push(
        top
          ? {
              x: (random() - 0.5) * 0.9,
              y: -0.62 + Math.abs(random() - 0.5) * 0.14,
              part: "HAIR",
            }
          : {
              x: side * (0.44 + random() * 0.14 + t * 0.06),
              y: -0.45 + t * 1.15,
              part: "HAIR",
            },
      );
    } else {
      const angle = Math.PI * (1.08 + random() * 0.84);
      const radius = 0.5 + random() * 0.1;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 1.1 - 0.06,
        part: "HAIR",
      });
    }
  }

  // Brows, eyes, nose, mouth.
  const brow = female ? 0.012 : 0.025;
  for (const side of [-1, 1]) {
    points.push(
      ...ellipse(
        side * 0.17,
        -0.2,
        0.09,
        brow + 0.02,
        share(0.03),
        "BROW",
        Math.PI * 1.1,
        Math.PI * 1.9,
      ),
      ...ellipse(side * 0.17, -0.1, 0.07, 0.035, share(0.045), "EYE"),
    );
  }
  const noseCount = share(0.03);
  points.push(
    ...Array.from({ length: noseCount }, (_, i) => ({
      x: 0.01 * Math.sin(i),
      y: -0.05 + (0.2 * i) / noseCount,
      part: "NOSE" as const,
    })),
    ...ellipse(
      0,
      0.27,
      female ? 0.13 : 0.15,
      0.035,
      share(0.05),
      "MOUTH_UPPER",
      Math.PI,
      TAU,
    ),
    ...ellipse(
      0,
      0.27,
      female ? 0.13 : 0.15,
      0.05,
      share(0.05),
      "MOUTH_LOWER",
      0,
      Math.PI,
    ),
  );

  // The brain: a field of points inside the crown, dim until Q thinks.
  const brainCount = Math.max(0, count - points.length);
  for (let i = 0; i < brainCount; i++) {
    const angle = Math.PI * (1.05 + random() * 0.9);
    const radius = Math.sqrt(random()) * 0.4;
    points.push({
      x: Math.cos(angle) * radius,
      y: -0.26 + Math.sin(angle) * radius * 0.85,
      part: "BRAIN",
    });
  }
  return points.slice(0, count);
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
