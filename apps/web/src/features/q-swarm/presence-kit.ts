/**
 * The shared vocabulary of Q's figures: what a figure is, what animates it
 * and the deterministic randomness every figure is laid out with. Kept
 * apart from the figures themselves so the free shapes (presence-shapes)
 * and the speaking face (presence-face) build on it without a cycle.
 */

export type FigureKind =
  | "CLOUD"
  | "ATTENTIVE"
  | "RING"
  | "WAVE"
  | "SPIRAL"
  | "CONSTELLATION"
  | "RIBBON"
  | "FACE"
  | "QUESTION"
  | "EXCLAIM"
  | "MONEY"
  | "BUILDINGS"
  | "CHART_UP"
  | "CLAP"
  | "HANDS";

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

export const TAU = Math.PI * 2;

/**
 * Depth, in frame units, of z = 1 (ADR 0049: the presence is 3D). Figures
 * report z normalised to -1 (far) .. 1 (near); the renderer multiplies by
 * this before turning and projecting, so every figure shares one scale.
 */
export const DEPTH_UNITS = 0.7;

/** Deterministic, so a figure lays out the same way every time. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function gaussian(random: () => number): number {
  const u = Math.max(1e-6, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * random());
}

/** A clamped normal sample, for soft scatter. */
export const gaussianSoft = (random: () => number): number =>
  Math.max(-2.5, Math.min(2.5, gaussian(random)));

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** A figure's z (frame units) normalised for the renderer, clamped. */
export const depthOf = (z: number): number =>
  Math.max(-1, Math.min(1, z / DEPTH_UNITS));
