/**
 * The speaking light's level, smoothed (owner audit 2026-11-15, Phase 4C:
 * "the speaking animation jumps and chops").
 *
 * A voice line's meters report raw energy multiplied by four and clipped
 * at 1, so a syllable is a square wave between 0 and 1. The presence used
 * to follow it with a ~38 ms attack, one 30 fps frame: the light snapped
 * to full on every syllable and fell back between them. This envelope is
 * what every presence reads instead:
 *
 * - a soft knee, so loud speech approaches the cap rather than slamming
 *   into a clip;
 * - a cap below 1, so the light's range stays restrained;
 * - an attack and a release with real time constants (a word arrives in
 *   about a tenth of a second and lets go over a quarter);
 * - a slew limit, so no frame -- however late -- moves the level more
 *   than a small step.
 *
 * Pure and frame-rate independent, so its bounds are asserted by tests.
 */

export type LevelEnvelopeOptions = {
  /** Rise time constant, ms. */
  readonly attackMs: number;
  /** Fall time constant, ms. */
  readonly releaseMs: number;
  /** The highest level the envelope reaches, 0..1. */
  readonly cap: number;
  /** Soft-knee strength: higher saturates sooner. 0 is linear. */
  readonly knee: number;
  /** The most the level may move per second (slew limit). */
  readonly maxPerSecond: number;
};

export const SPEAKING_ENVELOPE: LevelEnvelopeOptions = {
  attackMs: 90,
  releaseMs: 260,
  cap: 0.8,
  knee: 1.6,
  maxPerSecond: 4,
};

/** The raw 0..1 level, shaped by the soft knee and capped. */
export function shapeLevel(
  raw: number,
  options: Pick<LevelEnvelopeOptions, "cap" | "knee">,
): number {
  const x = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  const shaped =
    options.knee <= 0
      ? x
      : (1 - Math.exp(-options.knee * x)) / (1 - Math.exp(-options.knee));
  return shaped * options.cap;
}

export type LevelEnvelope = {
  /** Advance by `dtMs` towards `raw` (0..1); returns the new level. */
  readonly step: (raw: number, dtMs: number) => number;
  readonly value: () => number;
  /** Jump to a level at once (a still presence, a state change at rest). */
  readonly reset: (level?: number) => void;
};

export function createLevelEnvelope(
  options: LevelEnvelopeOptions = SPEAKING_ENVELOPE,
): LevelEnvelope {
  let level = 0;
  return {
    step: (raw, dtMs) => {
      const dt = Number.isFinite(dtMs) ? Math.max(0, Math.min(dtMs, 100)) : 0;
      const target = shapeLevel(raw, options);
      const tau = target > level ? options.attackMs : options.releaseMs;
      const k = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
      const wanted = (target - level) * k;
      const limit = (options.maxPerSecond * dt) / 1000;
      level += Math.max(-limit, Math.min(limit, wanted));
      return level;
    },
    value: () => level,
    reset: (next = 0) => {
      level = shapeLevel(next, options);
    },
  };
}
