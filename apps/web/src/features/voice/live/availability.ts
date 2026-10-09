import { liveVoiceAvailable } from "./live-call";

/**
 * Whether this person's voice is GPT-Live, asked once per page (V).
 *
 * The voice start never waits for it (2026-10-09 regression: while the
 * answer was on its way, or never came, the existing line did not start
 * and voice "never opened" for everyone GPT-Live is not on for). It is
 * asked as soon as any voice surface mounts; a start that comes before the
 * answer simply opens the existing line. Asked again only after a GPT-Live
 * call failed to open.
 *
 * Module state, deliberately: one answer per tab.
 */

let answer: boolean | null = null;
let asking: Promise<boolean> | null = null;

/** Ask, if not already asked; never throws. */
export function askLiveAvailability(): Promise<boolean> {
  if (asking !== null) return asking;
  const mine = liveVoiceAvailable().then((value) => {
    if (asking === mine) answer = value;
    return value;
  });
  asking = mine;
  return mine;
}

/** The answer if it is in: true, false, or null while it is not. */
export function liveAvailabilityNow(): boolean | null {
  return answer;
}

/** A GPT-Live call failed to open: ask again next time. */
export function forgetLiveAvailability(): void {
  answer = null;
  asking = null;
}
