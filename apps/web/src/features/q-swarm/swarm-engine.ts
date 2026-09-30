import {
  bloomShape,
  formlessShape,
  faceShape,
  galaxyShape,
  glyphShape,
  mouthShape,
  qShape,
  ringShape,
  waveShape,
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

export type SwarmMode =
  | "Q"
  | "FACE"
  | "RING"
  | "GLYPH"
  | "MOUTH"
  | "WAVE"
  | "GALAXY"
  | "BLOOM"
  | "FORMLESS";

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
      case "MOUTH":
        return mouthShape(count);
      case "WAVE":
        return waveShape(count);
      case "GALAXY":
        return galaxyShape(count);
      case "BLOOM":
        return bloomShape(count);
      case "FORMLESS":
        return formlessShape(count);
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
    if (
      input.mode === "FACE" &&
      (point.part === "HAND_LEFT" || point.part === "HAND_RIGHT")
    ) {
      // Hands (founder live 2026-09-30): they come up and gesture with
      // Q's voice, open and close a little on emphasis, and rest out of
      // sight when Q is quiet.
      const side = point.part === "HAND_LEFT" ? -1 : 1;
      const speaking =
        input.activity === "SPEAKING" || input.activity === "LAUGHING";
      const energy = speaking ? 0.35 + smoothedOutput : 0;
      const beat = Math.sin(t * 2.6 + (side > 0 ? 0 : 1.7));
      const rest = speaking ? 0 : 0.8;
      const lift = energy * (0.16 + beat * 0.06);
      // Each hand turns a little about its own centre as it moves.
      const cx = side * 0.7;
      const cy = 0.72;
      const angle = side * (0.18 * beat * energy);
      const dx = x - cx;
      const dy = y - cy;
      x =
        cx + dx * Math.cos(angle) - dy * Math.sin(angle) + side * energy * 0.04;
      y = cy + dx * Math.sin(angle) + dy * Math.cos(angle) - lift + rest;
      return { x, y };
    }
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
      // The head turns (founder live 2026-09-30: "the head doesn't even
      // turn"): a yaw, so the features swing across the face while the
      // outline narrows, as a real head does. Towards the person while
      // they talk, glancing aside and back while Q speaks, up and away
      // while it thinks.
      const yaw =
        input.activity === "LISTENING"
          ? Math.sin(t * 0.5) * 0.12 + input.input * 0.1
          : input.activity === "SPEAKING"
            ? Math.sin(t * 0.7) * 0.28 + Math.sin(t * 1.9) * 0.06
            : input.activity === "THINKING"
              ? -0.3 + Math.sin(t * 0.4) * 0.05
              : Math.sin(t * 0.45) * 0.18;
      const front =
        point.part === "OUTLINE" || point.part === "HAIR"
          ? 0.15
          : point.part === "BRAIN"
            ? 0.3
            : 1;
      x =
        x * (1 - 0.12 * Math.abs(Math.sin(yaw)) * (1 - front)) +
        Math.sin(yaw) * 0.16 * front;
      if (input.activity === "THINKING") y -= 0.03 * front;
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
    } else if (input.mode === "MOUTH") {
      // The lips part with the voice; a laugh opens them wide and shakes.
      const open =
        input.activity === "LAUGHING"
          ? 0.12 + 0.08 * Math.abs(Math.sin(t * 14))
          : 0.02 + smoothedOutput * 0.28 + Math.abs(Math.sin(t * 7)) * 0.02;
      if (point.part === "MOUTH_LOWER") y += open;
      if (point.part === "MOUTH_UPPER") y -= open * 0.35;
      x *= 1 + smoothedOutput * 0.12;
    } else if (input.mode === "WAVE") {
      // A sound wave: the voice (or the person's) drives its height.
      const level =
        input.activity === "LISTENING"
          ? input.input
          : input.activity === "SPEAKING"
            ? smoothedOutput
            : 0.15;
      const envelope = Math.cos((point.x / 0.75) * (Math.PI / 2));
      y +=
        envelope *
        (0.05 + level * 0.35) *
        (Math.sin(point.x * 11 - t * 6) * 0.7 +
          Math.sin(point.x * 23 + t * 9) * 0.3);
    } else if (input.mode === "GALAXY") {
      const radius = Math.hypot(point.x, point.y);
      const angle =
        Math.atan2(point.y, point.x) + t * (0.9 - radius * 0.8) * 1.2;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * 0.82;
    } else if (input.mode === "BLOOM") {
      // Petals opening and closing, the whole flower turning.
      const radius = Math.hypot(point.x, point.y);
      const angle = Math.atan2(point.y, point.x) + t * 0.35;
      const petals = 0.62 + 0.38 * Math.abs(Math.sin(angle * 3 + t * 0.8));
      const breathe = 0.85 + 0.15 * Math.sin(t * 1.3) + smoothedOutput * 0.2;
      x = Math.cos(angle) * radius * petals * breathe;
      y = Math.sin(angle) * radius * petals * breathe;
    } else if (input.mode === "FORMLESS") {
      // Smoke: every point carried on its own slow current, the whole
      // mass stretching, folding and turning, never the same twice.
      const radius = Math.hypot(point.x, point.y);
      const angle =
        Math.atan2(point.y, point.x) +
        t * 0.18 +
        radius * Math.sin(t * 0.23) * 1.4;
      const stretch = 1 + 0.35 * Math.sin(t * 0.31 + angle * 2);
      x =
        Math.cos(angle) * radius * stretch +
        Math.sin(point.y * 4.1 + t * 0.55) * 0.12 +
        Math.sin(t * 0.13) * 0.08;
      y =
        Math.sin(angle) * radius * (2 - stretch) +
        Math.cos(point.x * 3.7 - t * 0.47) * 0.12 +
        Math.cos(t * 0.17) * 0.06;
      const swell = 1 + smoothedOutput * 0.25 + input.input * 0.15;
      x *= swell;
      y *= swell;
    } else if (input.mode === "Q" && input.activity === "SPEAKING") {
      // The Q pulses with the voice.
      x *= 1 + smoothedOutput * 0.1;
      y *= 1 + smoothedOutput * 0.1;
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
    if (mode === "MOUTH") return 0.9;
    if (mode !== "FACE") return 0.75;
    // Features bright, structure soft: the eyes, brows and mouth are what
    // a person reads a face by.
    switch (part) {
      case "BRAIN":
        return 0.18;
      case "HAIR":
        return 0.3;
      case "OUTLINE":
        return 0.45;
      case "NOSE":
        return 0.6;
      case "BROW":
        return 0.8;
      case "GLYPH":
      case "FIELD":
        return 0.85;
      case "EYE":
      case "MOUTH_UPPER":
      case "MOUTH_LOWER":
        return 1;
      case "HAND_LEFT":
      case "HAND_RIGHT":
        return 0.9;
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
      // Softer springs: a change of figure flows over a second or so,
      // like smoke finding a new shape, never a snap.
      const stiffness = 4.2 * pace;
      const damping = Math.exp(-4.2 * dt);
      // Wind (founder live 2026-09-29: "constantly shifting, like wind"):
      // a slow flow field over every figure, stronger on the free ones,
      // and a gust now and then that loosens the figure and lets it
      // gather again. Faces keep their features readable.
      const figure = input.mode === "FACE" || input.mode === "MOUTH";
      const gustPhase = (t * pace) % 13;
      const gust =
        gustPhase > 10.5 ? Math.sin(((gustPhase - 10.5) / 2.5) * Math.PI) : 0;
      const windAmp = still
        ? 0
        : (figure ? 0.012 : 0.045) + gust * (figure ? 0.05 : 0.14);
      const gustAngle = Math.floor((t * pace) / 13) * 2.39996;
      const half = size / 2;
      // A face fills more of the frame than the free figures do.
      const scale = size * (input.mode === "FACE" ? 0.52 : 0.42);

      context.clearRect(0, 0, size, size);
      for (const particle of particles) {
        const target = place(particle.target, t * pace, input);
        // A drift of its own, so the swarm keeps breathing in any shape.
        const drift = still ? 0 : 0.01 + (input.mode === "Q" ? 0.006 : 0);
        const tp = t * pace;
        const flowX =
          Math.sin(
            target.y * 3.1 + tp * 0.7 + Math.sin(target.x * 2.3 - tp * 0.4),
          ) +
          gust * Math.cos(gustAngle) * 1.5;
        const flowY =
          Math.cos(
            target.x * 2.7 - tp * 0.6 + Math.cos(target.y * 1.9 + tp * 0.5),
          ) +
          gust * Math.sin(gustAngle) * 1.5;
        const tx =
          target.x +
          Math.sin(tp * 0.9 + particle.phase) * drift +
          flowX * windAmp * (0.6 + 0.4 * Math.sin(particle.phase * 5));
        const ty =
          target.y +
          Math.cos(tp * 1.1 + particle.phase * 1.3) * drift +
          flowY * windAmp * (0.6 + 0.4 * Math.cos(particle.phase * 7));
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
