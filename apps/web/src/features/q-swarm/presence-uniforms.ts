import type { QApertureState } from "../q-aperture/aperture-state";
import type { QMotion } from "../q-aperture/aperture-frame";
import type { FigureKind } from "./presence-figures";
import { isPictogram } from "./figure-library";

/**
 * What the 3D renderer is told each frame (ADR 0049), as a pure function
 * of the presence's existing inputs: the surface's Q state, the eased mic
 * and speaker levels, the cursor lean, the clock and the Q motion setting.
 * The figure (what the particles form) is still the presence machine's;
 * this only decides how the swarm is turned, lit and sized in 3D.
 */

export type PresenceUniforms = {
  /** Turn about the vertical, radians: positive brings the right side near. */
  readonly yaw: number;
  /** Turn about the horizontal, radians: positive brings the top near. */
  readonly pitch: number;
  /** The lean's shift, frame units. */
  readonly shiftX: number;
  readonly shiftY: number;
  /** Point size multiplier (the voice swells the points a little). */
  readonly pointScale: number;
  /** Halo strength, 0..~1.6; 0 draws none. */
  readonly glow: number;
  /** How far the core whitens on a dark surface, 0..1. */
  readonly core: number;
  /** Alpha multiplier (dim on error). */
  readonly fade: number;
  /** Share of particles drawn, 0..1 (the frame budget's lever). */
  readonly keep: number;
  /**
   * The darkest a particle may be drawn, 0..1: high for the swarm (every
   * point a spark).
   */
  readonly floor: number;
  /** How much the frame's centre brightens points, 0..1. */
  readonly lift: number;
};

export type UniformInput = {
  readonly state: QApertureState;
  /** What the particles form (the presence machine's choice). */
  readonly figure: FigureKind;
  /** 0..1, already eased. */
  readonly input: number;
  readonly output: number;
  /** The cursor lean after its spring, each -1..1. */
  readonly leanX: number;
  readonly leanY: number;
  /** Seconds. */
  readonly t: number;
  readonly motion: QMotion;
  readonly dim: boolean;
  readonly keep: number;
};

/** The pose a still frame is drawn in: turned enough to read as 3D. */
export const STILL_YAW = 0.38;
export const STILL_PITCH = -0.22;

/** How far the cursor can turn Q: it attends, it does not chase. */
export const LEAN_YAW = 0.42;
export const LEAN_PITCH = 0.3;
export const LEAN_SHIFT = 0.07;

const CLOUD_FIGURES: ReadonlySet<FigureKind> = new Set(["CLOUD", "ATTENTIVE"]);

/** The letter Q (the Q moment) turns least of all, so it reads as the mark. */
const MARK_FIGURES: ReadonlySet<FigureKind> = new Set(["LETTER_Q", "ROOM_Q"]);

const WORKING: ReadonlySet<QApertureState> = new Set(["THINKING", "WORKING"]);

export function presenceUniforms(input: UniformInput): PresenceUniforms {
  const level = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const mic = level(input.input);
  const voice = level(input.output);
  const moving = input.motion === "full";
  const leanX = moving ? Math.max(-1, Math.min(1, input.leanX)) : 0;
  const leanY = moving ? Math.max(-1, Math.min(1, input.leanY)) : 0;
  // At rest the swarm turns a little on its own, so its depth always reads;
  // a still frame holds one turned pose and never drifts.
  const swayYaw = moving ? Math.sin(input.t * 0.23) * 0.16 : 0;
  const swayPitch = moving ? Math.sin(input.t * 0.17 + 1.1) * 0.06 : 0;
  const listening = input.state === "LISTENING" ? 1 : 0;
  // Glyphs turn half as far as the cloud, so they stay legible; the Q
  // mark less still.
  const cloud = CLOUD_FIGURES.has(input.figure);
  // Pictograms turn as little as the mark: a clock read at an angle is
  // no longer a clock.
  const flat = MARK_FIGURES.has(input.figure) || isPictogram(input.figure);
  const turn = cloud ? 1 : flat ? 0.3 : 0.55;
  return {
    yaw: (STILL_YAW + swayYaw) * turn + leanX * LEAN_YAW,
    // Listening tips the top towards the person.
    pitch:
      (STILL_PITCH + swayPitch) * turn - leanY * LEAN_PITCH + listening * 0.08,
    shiftX: leanX * LEAN_SHIFT,
    shiftY: leanY * LEAN_SHIFT,
    pointScale: 1 + voice * 0.25 + mic * 0.1,
    glow:
      (0.75 + voice * 0.5 + mic * 0.3 + (WORKING.has(input.state) ? 0.15 : 0)) *
      (input.dim ? 0.45 : 1),
    // The white core is the cloud's dense centre; a ring or a glyph has
    // none, so it gets none.
    core: (input.dim ? 0.4 : 1) * (cloud ? 1 : 0.2),
    fade: input.dim ? 0.45 : 1,
    keep: Math.max(0.2, Math.min(1, input.keep)),
    floor: 0.38,
    lift: 0.6,
  };
}

/**
 * The cursor lean: a critically damped spring (no overshoot), gentle --
 * about a third of a second to settle most of the way.
 */
export type Lean = { x: number; y: number; vx: number; vy: number };

export const LEAN_OMEGA = 6;

export function stepLean(
  lean: Lean,
  targetX: number,
  targetY: number,
  rawDt: number,
): void {
  const dt = Math.min(1 / 30, Math.max(0, rawDt));
  const w = LEAN_OMEGA;
  // Exact solution of the critically damped spring over dt, so a long
  // frame cannot make it overshoot.
  const decay = Math.exp(-w * dt);
  for (const axis of ["x", "y"] as const) {
    const v = axis === "x" ? "vx" : "vy";
    const target = axis === "x" ? targetX : targetY;
    const offset = lean[axis] - target;
    const c = lean[v] + w * offset;
    lean[axis] = target + (offset + c * dt) * decay;
    lean[v] = (c - w * (offset + c * dt)) * decay;
  }
}

/**
 * How Q's light meets the surface behind it (owner 2026-10-20: the Q page
 * follows the theme). On the night the swarm is light: points add up
 * (additive blending), the dense core whitens and a wide, soft halo shows.
 * On paper additive light washes out -- white on white is no light at
 * all -- so the swarm is ink, matching the aperture's --cq-q-ink: 1:
 * normal ("over") blending so dense points deepen to Q's own colour, no
 * whitened core, more weight per point, and a tight, faint bloom.
 * Glow stays on Q only; reduced motion changes how Q moves, not this.
 */
export type PresenceLighting = {
  /** "add": light (ONE, ONE). "over": ink (ONE, ONE_MINUS_SRC_ALPHA). */
  readonly blend: "add" | "over";
  /** How far the dense core may whiten, 0..1. */
  readonly white: number;
  /** Alpha multiplier on every point (clamped to 1 per point). */
  readonly weight: number;
  /**
   * The faintest a point may be drawn, 0..1, over the figure's own floor:
   * ink needs a body that light does not, or the dim room Q reads as dust.
   */
  readonly floor: number;
  /** The halo's peak alpha per unit of glow. */
  readonly halo: number;
  /** The halo's reach, as a share of half the frame. */
  readonly haloReach: number;
  /** Whether the near-white light over Q's centre is drawn. */
  readonly coreLight: boolean;
};

export const NIGHT_LIGHTING: PresenceLighting = {
  blend: "add",
  white: 1,
  weight: 1,
  floor: 0,
  halo: 0.24,
  haloReach: 0.98,
  coreLight: true,
};

export const PAPER_LIGHTING: PresenceLighting = {
  blend: "over",
  white: 0,
  weight: 1.7,
  floor: 0.6,
  halo: 0.05,
  haloReach: 0.5,
  coreLight: false,
};

/** The lighting for a surface: light on the night, ink on paper. */
export function presenceLighting(dark: boolean): PresenceLighting {
  return dark ? NIGHT_LIGHTING : PAPER_LIGHTING;
}
