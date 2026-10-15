import type { SceneLine } from "@capital-q/q-pitch";

/**
 * Captions-first narrator. Each line stays on screen for a reading time
 * derived from its length (about 150 words a minute), and stops at once
 * when the tour is paused or interrupted.
 *
 * No audio yet, on purpose. Q's voice goes through the existing voice
 * provider and Q voice identity (blueprint §5 "Speech"). Wiring it waits for
 * Lane S's streaming TTS contract and the owner's live-run budget. A device
 * speech engine would be a different voice, and some engines send text to a
 * vendor, so neither is a quiet substitute.
 */
const WORDS_PER_MINUTE = 150;
const MIN_MS = 1_500;
const MAX_MS = 14_000;

export function readingMs(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  const ms = Math.round((words / WORDS_PER_MINUTE) * 60_000);
  return Math.min(MAX_MS, Math.max(MIN_MS, ms));
}

export function captionSpeak(
  lines: readonly SceneLine[],
  signal: AbortSignal,
): Promise<void> {
  const total = lines.reduce((sum, line) => sum + readingMs(line.text), 0);
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, total);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
