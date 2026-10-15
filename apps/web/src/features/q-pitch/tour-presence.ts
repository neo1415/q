import { RESUME_KEY } from "./resume";

/**
 * Whether a Q Pitch tour holds this tab's voice (lead 15 Oct, cost bug: the
 * Home arrival auto-opened a paid voice line before the person pressed
 * Start, and kept reconnecting it in "Captions only"). While a tour is
 * asked for (`?qpitch=`), running, or set to resume in this tab, nothing
 * opens a voice line on its own: only the tour's own Start does, and only
 * with voice. Deliberately tiny (no React, no contracts) so any surface
 * that auto-opens a line can ask it.
 */
let running = false;

export function markQPitchRunning(on: boolean): void {
  running = on;
}

/** The decision, pure (tests). */
export function tourHoldsVoice(input: {
  readonly running: boolean;
  readonly search: string;
  readonly resumeStored: boolean;
}): boolean {
  if (input.running || input.resumeStored) return true;
  return new URLSearchParams(input.search).has("qpitch");
}

export function qPitchHoldsVoice(): boolean {
  return tourHoldsVoice({
    running,
    search: typeof window === "undefined" ? "" : window.location.search,
    resumeStored: resumeIsStored(),
  });
}

function resumeIsStored(): boolean {
  try {
    return window.sessionStorage.getItem(RESUME_KEY) !== null;
  } catch {
    return false;
  }
}
