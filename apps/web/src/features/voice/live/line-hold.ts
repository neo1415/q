/**
 * Owner 2026-10-28 (job 9e52faf7): the live line idled out at 14:06:59
 * while the document it had promised was still being made, so the ready
 * note had nowhere to be said. Work Q promised in this conversation holds
 * the line open while it runs: the idle guard waits, for at most
 * LINE_HOLD_MAX_MS past its own window, never for ever (a stuck job must
 * not keep a paid line open).
 *
 * A tiny module store rather than a context: the job watcher (work-live)
 * and the call (live-call) live in different trees.
 */

/** How much longer than its idle window a held line may stay silent. */
export const LINE_HOLD_MAX_MS = 6 * 60_000;

const holds = new Set<string>();

/** Something this line promised is running (one key per job). */
export function holdLine(key: string): void {
  holds.add(key);
}

/** It finished, failed, or is no longer watched. */
export function releaseLine(key: string): void {
  holds.delete(key);
}

export function lineHeld(): boolean {
  return holds.size > 0;
}

/**
 * Whether a line silent for `silentMs` ends for idleness: past its window,
 * unless promised work holds it, and then only past the bounded hold.
 */
export function idleEnds(
  silentMs: number,
  idleMs: number,
  held: boolean = lineHeld(),
): boolean {
  if (silentMs <= idleMs) return false;
  return !held || silentMs > idleMs + LINE_HOLD_MAX_MS;
}

/** Tests only. */
export function resetLineHolds(): void {
  holds.clear();
}
