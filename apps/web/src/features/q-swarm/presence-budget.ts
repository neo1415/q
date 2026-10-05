/**
 * How much swarm a device gets (ADR 0049), and the frame-budget guard
 * that gives some back when frames run long. Pure, so both are tested.
 */

/** Particles per surface size, before the device's share. */
export function particleCount(pixels: number): number {
  return pixels >= 440
    ? 2200
    : pixels >= 300
      ? 1800
      : pixels >= 150
        ? 900
        : pixels >= 72
          ? 480
          : 160;
}

/**
 * The device's share: cores are the best cheap hint of what a phone can
 * draw. Small surfaces (the dock, inline loaders) never grow.
 */
export function deviceShare(cores: number | undefined, pixels: number): number {
  const c =
    cores !== undefined && Number.isFinite(cores) && cores > 0 ? cores : 4;
  const share = c >= 8 ? 1.15 : c >= 6 ? 1 : c >= 4 ? 0.8 : 0.55;
  return pixels < 150 ? Math.min(1, share) : share;
}

export function scaledParticleCount(
  pixels: number,
  cores: number | undefined,
): number {
  return Math.round(particleCount(pixels) * deviceShare(cores, pixels));
}

/** Device-pixel ratio for a surface: never above 2. */
export function surfaceDpr(devicePixelRatio: number | undefined): number {
  const ratio =
    devicePixelRatio !== undefined && Number.isFinite(devicePixelRatio)
      ? devicePixelRatio
      : 1;
  return Math.max(1, Math.min(2, ratio));
}

/**
 * The frame-budget guard. Each frame reports how long its own work took
 * and how long since the last frame. When the smoothed frame interval
 * stays above ~16 ms (with the swarm's own work a real part of it) for
 * half a second, the guard steps down one level: first fewer points, then
 * a lower DPR, then fewer again. It never steps back up within a mount,
 * so it cannot oscillate.
 */
export type Budget = {
  readonly level: number;
  /** Smoothed frame interval, ms. */
  readonly interval: number;
  /** Smoothed work per frame, ms. */
  readonly work: number;
  /** Consecutive slow frames. */
  readonly slow: number;
};

export const BUDGET_LEVELS = [
  { keep: 1, dprScale: 1 },
  { keep: 0.7, dprScale: 1 },
  { keep: 0.7, dprScale: 0.75 },
  { keep: 0.5, dprScale: 0.6 },
] as const;

export const FRAME_BUDGET_MS = 16.7;
const SLOW_FRAMES = 30;

export function createBudget(): Budget {
  return { level: 0, interval: FRAME_BUDGET_MS, work: 0, slow: 0 };
}

export function stepBudget(
  budget: Budget,
  intervalMs: number,
  workMs: number,
): Budget {
  // A background tab or a paused loop is not a slow frame.
  if (!(intervalMs > 0) || intervalMs > 250) return budget;
  const interval = budget.interval + (intervalMs - budget.interval) * 0.1;
  const work = budget.work + (Math.max(0, workMs) - budget.work) * 0.1;
  // Slow, and the swarm is a real share of why: a busy page elsewhere is
  // not the swarm's to fix by vanishing.
  const over = interval > FRAME_BUDGET_MS * 1.1 && work > 3;
  const slow = over ? budget.slow + 1 : 0;
  if (slow >= SLOW_FRAMES && budget.level < BUDGET_LEVELS.length - 1) {
    return { level: budget.level + 1, interval, work, slow: 0 };
  }
  return { level: budget.level, interval, work, slow };
}

export function budgetSettings(budget: Budget): {
  readonly keep: number;
  readonly dprScale: number;
} {
  return BUDGET_LEVELS[budget.level] ?? BUDGET_LEVELS[0];
}
