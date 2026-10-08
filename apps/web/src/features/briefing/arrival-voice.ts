import { arrivalWords } from "./arrival";
import { loadArrival } from "./arrival-browser";
import { arrivalForVoice } from "./arrival-store";

/** How long a call waits for the briefing's reads before a plain hello. */
const VOICE_BRIEFING_WAIT_MS = 2_500;

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * What Q says first on a new call (Zino, 2026-10-08): the arrival
 * briefing (greeting by their clock, what was done, the decisions
 * waiting), never a generic "what would you like to work on?". Null only
 * when the briefing could not be read in time.
 */
export async function voiceBriefing(): Promise<string | null> {
  const data = await arrivalForVoice(loadArrival, VOICE_BRIEFING_WAIT_MS);
  if (data === null) return null;
  return arrivalWords(data, new Date(), browserZone()).spoken;
}
