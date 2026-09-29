import {
  faceShape,
  glyphShape,
  qShape,
  ringShape,
  type SwarmFace,
  type SwarmPart,
  type SwarmPoint,
} from "./swarm-shapes";

/**
 * Q as a living swarm (founder direction 2026-09-29): hundreds of points,
 * always moving, each able to glow on its own. What they form follows what
 * Q is doing: the letter Q at rest, a face while it listens, thinks and
 * speaks (lights firing in its brain as it thinks, the mouth moving with
 * its voice, the head turning as a person's does), a ring while it works,
 * and a glyph -- an emoji, a hand -- when it has one to show.
 *
 * One Canvas2D surface; positions are springs toward targets, so every
 * change of shape is a flowing morph, never a cut. Reduced motion draws
 * the settled shape and schedules nothing.
 */

export type SwarmMode = "Q" | "FACE" | "RING" | "GLYPH";

export type SwarmActivity =
  "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "LAUGHING" | "ASKING";

export type SwarmFrameInput = {
  readonly mode: SwarmMode;
  readonly activity: SwarmActivity;
  readonly face: SwarmFace;
  readonly glyph: string | null;
  /** 0..1 microphone energy. */
  readonly input: number;
  /** 0..1 speaker energy. */
  readonly output: number;
  /** "full" moves; "calm" moves slowly; "off" holds still. */
  readonly motion: "full" | "calm" | "off";
  readonly dim: boolean;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  target: SwarmPoint;
  phase: number;
  size: number;
  glow: number;
};

const TAU = Math.PI * 2;

export type SwarmEngine = {
  readonly draw: (now: number, input: SwarmFrameInput) => void;
  readonly resize: (pixels: number) => void;
  readonly setColour: (colour: string) => void;
};

export function createSwarmEngine(
  context: CanvasRenderingContext2D,
  pixels: number,
): SwarmEngine {
  let size = pixels;
  let colour = "#6aa8ff";
  const count = size >= 300 ? 900 : size >= 150 ? 700 : size >= 72 ? 360 : 140;
  let shapeKey = "";
  let last = 0;
  let smoothedOutput = 0;
  let seed = 7;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };

  const particles: Particle[] = Array.from({ length: count }, () => ({
    x: (random() - 0.5) * 1.6,
    y: (random() - 0.5) * 1.6,
    vx: 0,
    vy: 0,
    target: { x: 0, y: 0, part: "GLYPH" },
    phase: random() * TAU,
    size: 0.6 + random() * 0.8,
    glow: 0,
  }));

  const sprite = document.createElement("canvas");
  let spriteColour = "";
  const paintSprite = () => {
    if (spriteColour === colour) return;
    spriteColour = colour;
    sprite.width = 32;
    sprite.height = 32;
    const g = sprite.getContext("2d");
    if (g === null) return;
    g.clearRect(0, 0, 32, 32);
    const gradient = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.18, colour);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 32, 32);
  };

  const shapeFor = (input: SwarmFrameInput): SwarmPoint[] => {
    switch (input.mode) {
      case "FACE":
        return faceShape(input.face, count);
      case "RING":
        return ringShape(count);
      case "GLYPH":
        return input.glyph === null
          ? qShape(count)
          : glyphShape(input.glyph, count);
      case "Q":
        return qShape(count);
    }
  };

  const retarget = (input: SwarmFrameInput) => {
    const key = `${input.mode}:${input.face}:${input.glyph ?? ""}`;
    if (key === shapeKey) return;
    shapeKey = key;
    const shape = shapeFor(input);
    // A rotating hand-out, so the swarm swirls into its new shape rather
    // than every point sliding straight across.
    const offset = Math.floor(random() * shape.length);
    particles.forEach((particle, i) => {
      particle.target = shape[(i + offset) % shape.length] ?? particle.target;
    });
  };

  /** Where a point of the figure is now, with the head's motion applied. */
  const place = (
    point: SwarmPoint,
    t: number,
    input: SwarmFrameInput,
  ): { x: number; y: number } => {
    let { x, y } = point;
    if (input.mode === "FACE") {
      const speaking = input.activity === "SPEAKING";
      const laughing = input.activity === "LAUGHING";
      const open = laughing
        ? 0.05 + 0.035 * Math.abs(Math.sin(t * 16))
        : speaking
          ? smoothedOutput * 0.11
          : 0;
      if (point.part === "MOUTH_LOWER") y += open;
      if (point.part === "MOUTH_UPPER") y -= open * 0.25;
      if (
        laughing &&
        (point.part === "MOUTH_LOWER" || point.part === "MOUTH_UPPER")
      ) {
        x *= 1.25;
      }
      if (point.part === "EYE" && laughing) y = -0.1 + (y + 0.1) * 0.35;
      if (point.part === "BROW" && input.activity === "ASKING") y -= 0.03;
      // The head: a look around, a nod while talking, a tilt when asking.
      const look =
        Math.sin(t * 0.45) * 0.07 +
        (input.activity === "LISTENING" ? Math.sin(t * 0.9) * 0.02 : 0);
      const depth =
        point.part === "OUTLINE" || point.part === "HAIR" ? 0.35 : 1;
      x += look * depth * 0.5;
      const roll =
        (input.activity === "ASKING" ? 0.12 : 0) +
        (speaking ? Math.sin(t * 2.3) * 0.035 * (0.4 + smoothedOutput) : 0) +
        (laughing ? Math.sin(t * 9) * 0.05 : 0) +
        Math.sin(t * 0.33) * 0.015;
      const nod = speaking ? Math.sin(t * 4.1) * 0.012 * smoothedOutput : 0;
      const cos = Math.cos(roll);
      const sin = Math.sin(roll);
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos + nod;
      x = rx;
      y = ry;
    } else if (input.mode === "RING") {
      const angle = Math.atan2(point.y, point.x) + t * 2.2;
      const radius = Math.hypot(point.x, point.y);
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
    }
    return { x, y };
  };

  /** How lit a point is, by what Q is doing. */
  const glowOf = (
    particle: Particle,
    t: number,
    input: SwarmFrameInput,
  ): number => {
    const part: SwarmPart = particle.target.part;
    // A spark now and then anywhere: the swarm is never quite still.
    const idle = Math.max(0, Math.sin(t * 0.8 + particle.phase * 3)) ** 40;
    switch (input.activity) {
      case "THINKING": {
        if (part === "BRAIN" || input.mode !== "FACE") {
          // Waves of firing travelling across the brain, from a focus
          // that wanders.
          const fx = Math.sin(t * 1.3) * 0.25;
          const fy = -0.3 + Math.cos(t * 1.7) * 0.12;
          const d = Math.hypot(particle.target.x - fx, particle.target.y - fy);
          return (
            1.4 *
            Math.max(0, Math.sin(t * 7 - d * 16 + particle.phase * 0.3)) ** 6
          );
        }
        return idle * 0.5;
      }
      case "LISTENING":
        return part === "EYE" || part === "BROW"
          ? 0.25 + input.input * 0.9
          : idle + input.input * 0.25;
      case "SPEAKING":
        return part === "MOUTH_LOWER" || part === "MOUTH_UPPER"
          ? 0.3 + smoothedOutput
          : idle + smoothedOutput * 0.15;
      case "LAUGHING":
        return part === "EYE" || part.startsWith("MOUTH")
          ? 0.8
          : Math.max(
              idle,
              Math.max(0, Math.sin(t * 10 + particle.phase)) ** 8 * 0.6,
            );
      case "ASKING":
        return part === "BROW" || part === "EYE" ? 0.6 : idle;
      case "IDLE":
        return idle;
    }
  };

  const baseAlpha = (part: SwarmPart, mode: SwarmMode): number => {
    if (mode !== "FACE") return 0.75;
    switch (part) {
      case "BRAIN":
        return 0.2;
      case "HAIR":
        return 0.45;
      case "OUTLINE":
        return 0.55;
      case "GLYPH":
      case "EYE":
      case "BROW":
      case "NOSE":
      case "MOUTH_UPPER":
      case "MOUTH_LOWER":
        return 0.85;
    }
  };

  return {
    resize: (next) => {
      size = next;
    },
    setColour: (next) => {
      colour = next;
    },
    draw: (now, input) => {
      retarget(input);
      paintSprite();
      const t = now / 1000;
      const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      last = now;
      smoothedOutput +=
        (input.output - smoothedOutput) *
        (input.output > smoothedOutput ? 0.5 : 0.12);
      const still = input.motion === "off";
      const pace = input.motion === "calm" ? 0.45 : 1;
      const stiffness = 9 * pace;
      const damping = Math.exp(-6 * dt);
      const half = size / 2;
      const scale = size * 0.42;

      context.clearRect(0, 0, size, size);
      for (const particle of particles) {
        const target = place(particle.target, t * pace, input);
        // A drift of its own, so the swarm keeps breathing in any shape.
        const drift = still ? 0 : 0.012 + (input.mode === "Q" ? 0.006 : 0);
        const tx = target.x + Math.sin(t * 0.9 * pace + particle.phase) * drift;
        const ty =
          target.y + Math.cos(t * 1.1 * pace + particle.phase * 1.3) * drift;
        if (still) {
          particle.x = tx;
          particle.y = ty;
        } else {
          particle.vx =
            (particle.vx + (tx - particle.x) * stiffness * dt) * damping;
          particle.vy =
            (particle.vy + (ty - particle.y) * stiffness * dt) * damping;
          particle.x += particle.vx;
          particle.y += particle.vy;
        }
        const wanted = still ? 0 : glowOf(particle, t * pace, input);
        particle.glow += (wanted - particle.glow) * 0.25;

        const px = half + particle.x * scale;
        const py = half + particle.y * scale;
        const alpha =
          (input.dim ? 0.45 : 1) *
          Math.min(
            1,
            baseAlpha(particle.target.part, input.mode) + particle.glow * 0.6,
          );
        const radius = Math.max(0.6, particle.size * (size / 260));
        context.globalAlpha = alpha;
        context.fillStyle = colour;
        context.beginPath();
        context.arc(px, py, radius, 0, TAU);
        context.fill();
        if (particle.glow > 0.2) {
          const d = radius * (4 + particle.glow * 6);
          context.globalAlpha =
            Math.min(1, particle.glow) * (input.dim ? 0.4 : 0.85);
          context.drawImage(sprite, px - d / 2, py - d / 2, d, d);
        }
      }
      context.globalAlpha = 1;
    },
  };
}
