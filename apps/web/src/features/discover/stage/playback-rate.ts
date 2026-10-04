"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Playback speed for pitches (Discover v2): client-only, remembered per
 * device. It never leaves the browser and never feeds ranking, analytics
 * or interest -- watching faster is not a signal about a company.
 */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

const STORAGE_KEY = "cq.discover.rate";
const listeners = new Set<() => void>();
let memory: PlaybackRate | null = null;

function isRate(value: number): value is PlaybackRate {
  return (PLAYBACK_RATES as readonly number[]).includes(value);
}

export function readPlaybackRate(): PlaybackRate {
  if (memory !== null) return memory;
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    // Storage can be blocked or cleared; 1x is always a correct answer.
    memory = isRate(stored) ? stored : 1;
  } catch {
    memory = 1;
  }
  return memory;
}

export function writePlaybackRate(rate: PlaybackRate): void {
  memory = rate;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(rate));
  } catch {
    // A private window keeps the choice for this page only.
  }
  for (const listener of listeners) listener();
}

/** One step slower or faster along the list, clamped at its ends. */
export function stepPlaybackRate(
  rate: PlaybackRate,
  direction: -1 | 1,
): PlaybackRate {
  const at = PLAYBACK_RATES.indexOf(rate);
  const next =
    PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, at + direction))];
  return next ?? rate;
}

/** "1×", "0.75×": the speed as the menu says it. */
export function rateLabel(rate: number): string {
  return `${String(rate)}×`;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function usePlaybackRate(): readonly [
  PlaybackRate,
  (rate: PlaybackRate) => void,
] {
  const rate = useSyncExternalStore(
    subscribe,
    readPlaybackRate,
    (): PlaybackRate => 1,
  );
  const set = useCallback((next: PlaybackRate) => writePlaybackRate(next), []);
  return [rate, set] as const;
}

/** For tests: forget the remembered speed. */
export function resetPlaybackRateForTests(): void {
  memory = null;
}
