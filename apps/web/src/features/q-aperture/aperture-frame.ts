import type { QApertureState } from "./aperture-state";

/**
 * The aperture's light, as numbers: what each state looks like and when
 * the renderer needs another frame. Pure, so the motion rules (spec §5.3)
 * are asserted by tests rather than by eye.
 *
 * Coordinates are the mark's own box: the centre is 0, the edge is 1. The
 * ring sits well inside the edge so the bloom has room and never reaches
 * a label, which always sits outside the box.
 */

/** Full: light moves with real state. Calm: static light. Off: static mark, no glow. */
export type QMotion = "full" | "calm" | "off";

export type ApertureParams = {
  /** Ring radius. */
  readonly radius: number;
  /** Stroke width at stage size (the renderer keeps a hairline minimum). */
  readonly width: number;
  /** Listening: faint light filling the aperture, 0..1. */
  readonly open: number;
  /** Overall light, 1 at rest. */
  readonly bright: number;
  /** Thinking/working: the focus sweep's strength and position (turns). */
  readonly sweepAmp: number;
  readonly sweepPhase: number;
  /** Working with known progress: 0..1 of the ring lit; -1 when unknown. */
  readonly progress: number;
  /** Speaking: the tail's length and the light it projects. */
  readonly tail: number;
  readonly tailGlow: number;
  /** Complete: the single shutter flash, 1 → 0. */
  readonly flash: number;
  /** Needs approval: the warm-white core highlight. */
  readonly core: number;
  /** Error: 1 dims the light to an ember. */
  readonly ember: number;
  /** Bloom strength, 0 (a solid ring) .. 1. */
  readonly bloom: number;
};

export const RING_RADIUS = 0.56;
const RING_WIDTH = 0.05;

/** A state change settles in the emphasis duration (doc 18 §118–121). */
export const SETTLE_MS = 280;
/** The complete shutter: one short flash (spec §5.1). */
export const FLASH_MS = 240;
/** The focus sweep: 1.4 s a turn, until work has run for 5 s (WCAG 2.2.2). */
export const SWEEP_PERIOD_MS = 1400;
export const SWEEP_CALM_PERIOD_MS = 6000;
export const SWEEP_SLOW_AFTER_MS = 5000;
const SWEEP_EASE_MS = 600;
const SWEEP_CALM_AMPLITUDE = 0.35;

const REST: ApertureParams = {
  radius: RING_RADIUS,
  width: RING_WIDTH,
  open: 0,
  bright: 1,
  sweepAmp: 0,
  sweepPhase: 0,
  progress: -1,
  tail: 1,
  tailGlow: 0,
  flash: 0,
  core: 0,
  ember: 0,
  bloom: 1,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The sweep after `elapsedMs` of work. Amplitude falls to a low, long
 * sweep by 5.0 s; the phase is the integral of the speed, so the head
 * never jumps when the period changes.
 */
export function sweepAt(elapsedMs: number): {
  readonly amplitude: number;
  readonly phase: number;
} {
  const amplitude =
    1 -
    (1 - SWEEP_CALM_AMPLITUDE) *
      smoothstep(
        SWEEP_SLOW_AFTER_MS - SWEEP_EASE_MS,
        SWEEP_SLOW_AFTER_MS,
        elapsedMs,
      );
  const fast = Math.min(elapsedMs, SWEEP_SLOW_AFTER_MS) / SWEEP_PERIOD_MS;
  const slow =
    Math.max(0, elapsedMs - SWEEP_SLOW_AFTER_MS) / SWEEP_CALM_PERIOD_MS;
  return { amplitude, phase: (fast + slow) % 1 };
}

export type FrameInputs = {
  /** 0..1 microphone and speaker energy, already smoothed. */
  readonly input: number;
  readonly output: number;
  /** 0..1 when a durable task reports progress; null when it does not. */
  readonly progress: number | null;
  readonly elapsedMs: number;
  readonly motion: QMotion;
  readonly bloom: boolean;
};

/** What a state looks like at this moment, before any settling. */
export function targetParams(
  state: QApertureState,
  inputs: FrameInputs,
): ApertureParams {
  const moving = inputs.motion === "full";
  const input = moving ? inputs.input : 0;
  const output = moving ? inputs.output : 0;
  const sweep = moving ? sweepAt(inputs.elapsedMs) : { amplitude: 0, phase: 0 };
  const bloom = inputs.bloom && inputs.motion !== "off" ? 1 : 0;
  const base = { ...REST, bloom };
  switch (state) {
    case "IDLE":
      return base;
    case "LISTENING":
      // The aperture opens: up to 6% wider, the inner field filling.
      return {
        ...base,
        radius: RING_RADIUS * (1 + 0.06 * input),
        open: 0.2 + 0.6 * input,
        bright: 1.1 + 0.35 * input,
      };
    case "THINKING":
      // The aperture focuses: a tighter ring and a travelling highlight.
      return {
        ...base,
        radius: RING_RADIUS * 0.93,
        bright: 1.05,
        sweepAmp: sweep.amplitude,
        sweepPhase: sweep.phase,
      };
    case "WORKING": {
      const known = inputs.progress !== null;
      return {
        ...base,
        radius: RING_RADIUS * 0.96,
        bright: 1.05,
        progress: known ? Math.min(1, Math.max(0, inputs.progress ?? 0)) : -1,
        sweepAmp: known ? sweep.amplitude * 0.5 : sweep.amplitude,
        sweepPhase: known ? (inputs.progress ?? 0) : sweep.phase,
      };
    }
    case "SPEAKING":
      // Light projects from the tail, with the voice.
      return {
        ...base,
        tail: 1.25 + 0.9 * output,
        tailGlow: 0.35 + 0.65 * output,
        bright: 1.05 + 0.2 * output,
      };
    case "NEEDS_INPUT":
      return { ...base, bright: 1.3, width: RING_WIDTH * 1.2 };
    case "NEEDS_APPROVAL":
      return { ...base, core: 1, bright: 1.15 };
    case "COMPLETE": {
      const flash =
        moving && inputs.elapsedMs < FLASH_MS
          ? 1 - smoothstep(0, FLASH_MS, inputs.elapsedMs)
          : 0;
      return { ...base, flash };
    }
    case "ERROR":
      return { ...base, ember: 1, bright: 0.85, bloom: bloom * 0.35 };
  }
}

/**
 * Whether the renderer needs another frame. The answer is no at rest: an
 * idle, calm or static aperture is drawn once and costs nothing after.
 */
export function needsFrames(
  state: QApertureState,
  inputs: Pick<FrameInputs, "elapsedMs" | "motion" | "progress">,
  hasLevel: { readonly input: boolean; readonly output: boolean },
): boolean {
  if (inputs.motion !== "full") return false;
  if (inputs.elapsedMs < SETTLE_MS) return true;
  switch (state) {
    case "LISTENING":
      return hasLevel.input;
    case "SPEAKING":
      return hasLevel.output;
    case "THINKING":
    case "WORKING":
      return true;
    case "COMPLETE":
      return inputs.elapsedMs < FLASH_MS;
    case "IDLE":
    case "NEEDS_INPUT":
    case "NEEDS_APPROVAL":
    case "ERROR":
      // Static light: drawn once per change.
      return false;
  }
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixParams(
  from: ApertureParams,
  to: ApertureParams,
  t: number,
): ApertureParams {
  return {
    radius: mix(from.radius, to.radius, t),
    width: mix(from.width, to.width, t),
    open: mix(from.open, to.open, t),
    bright: mix(from.bright, to.bright, t),
    sweepAmp: mix(from.sweepAmp, to.sweepAmp, t),
    // The sweep's position is the new state's own; only its strength fades.
    sweepPhase: to.sweepPhase,
    progress: to.progress,
    tail: mix(from.tail, to.tail, t),
    tailGlow: mix(from.tailGlow, to.tailGlow, t),
    flash: to.flash,
    core: mix(from.core, to.core, t),
    ember: mix(from.ember, to.ember, t),
    bloom: mix(from.bloom, to.bloom, t),
  };
}

/** Strong ease-out: a change answers at once and settles softly. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * One aperture's light over time. A state change retargets from wherever
 * the light is now (interruptible, never a restart); audio levels attack
 * fast and release slowly, so a word lands at once and lets go gently.
 */
export class ApertureAnimator {
  private state: QApertureState;
  private since: number;
  private from: ApertureParams = REST;
  private current: ApertureParams = REST;
  private input = 0;
  private output = 0;

  constructor(state: QApertureState, now: number) {
    this.state = state;
    // Born settled: a first paint is never an animation.
    this.since = now - SETTLE_MS;
  }

  setState(state: QApertureState, now: number): void {
    if (state === this.state) return;
    this.from = this.current;
    this.state = state;
    this.since = now;
  }

  frame(
    now: number,
    options: {
      readonly input?: (() => number) | undefined;
      readonly output?: (() => number) | undefined;
      readonly progress: number | null;
      readonly motion: QMotion;
      readonly bloom: boolean;
    },
  ): { readonly params: ApertureParams; readonly live: boolean } {
    const elapsedMs = now - this.since;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const inTarget =
      this.state === "LISTENING" && options.input !== undefined
        ? clamp(options.input())
        : 0;
    const outTarget =
      this.state === "SPEAKING" && options.output !== undefined
        ? clamp(options.output())
        : 0;
    this.input +=
      (inTarget - this.input) * (inTarget > this.input ? 0.5 : 0.12);
    this.output +=
      (outTarget - this.output) * (outTarget > this.output ? 0.5 : 0.12);
    const inputs: FrameInputs = {
      input: this.input,
      output: this.output,
      progress: options.progress,
      elapsedMs,
      motion: options.motion,
      bloom: options.bloom,
    };
    const target = targetParams(this.state, inputs);
    const t =
      options.motion === "full"
        ? easeOut(Math.min(1, elapsedMs / SETTLE_MS))
        : 1;
    this.current = mixParams(this.from, target, t);
    return {
      params: this.current,
      live: needsFrames(this.state, inputs, {
        input: options.input !== undefined,
        output: options.output !== undefined,
      }),
    };
  }
}
