import { askLiveVoice, LIVE_AVAILABLE_TIMEOUT_MS } from "./live-call";

/**
 * Whether this person's voice is GPT-Live, asked once per page (V).
 *
 * Asked as soon as any voice surface mounts. A start waits for it only
 * while it is on its way, and never longer than LIVE_AVAILABLE_TIMEOUT_MS;
 * a known answer (yes or no) costs no wait at all, and an answer that is
 * not in by then opens the existing line (2026-10-09 regression: a start
 * that waited without a bound never opened voice).
 *
 * Root cause of the gpt-live.spec start failures (2026-10-09 stack runs):
 * the answer was raced against that 1.5 s bound when it was ASKED, and a
 * late one was cached as "no" for the life of the tab. Under load the Q
 * API's answer took 1.7-4.1 s (web log), so the tab was silently on the
 * duplex line for good: the founder could get it too. Now the real answer
 * is kept whenever it lands; only a failed ask is forgotten, so a later
 * start asks again.
 *
 * Module state, deliberately: one answer per tab.
 */

/** Longest the ask itself may take (a hung request is not an answer). */
const ASK_TIMEOUT_MS = 15_000;

let answer: boolean | null = null;
let asking: Promise<boolean | null> | null = null;

/** Ask, if not already asked; never throws. Null: no answer (yet). */
export function askLiveAvailability(
  doFetch?: typeof fetch,
): Promise<boolean | null> {
  if (answer !== null) return Promise.resolve(answer);
  if (asking !== null) return asking;
  const mine: Promise<boolean | null> = askLiveVoice(
    doFetch,
    ASK_TIMEOUT_MS,
  ).then((value) => {
    if (asking !== mine) return value;
    if (value === null) asking = null;
    else answer = value;
    return value;
  });
  asking = mine;
  return mine;
}

/** The answer if it is in: true, false, or null while it is not. */
export function liveAvailabilityNow(): boolean | null {
  return answer;
}

/**
 * For a voice start: the answer now if it is in; otherwise the one on its
 * way, waited for at most `waitMs`; null if it is not in by then.
 */
export async function liveAvailabilityFor(
  waitMs: number = LIVE_AVAILABLE_TIMEOUT_MS,
  doFetch?: typeof fetch,
): Promise<boolean | null> {
  if (answer !== null) return answer;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, waitMs);
  });
  try {
    return await Promise.race([askLiveAvailability(doFetch), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A GPT-Live call failed to open: ask again next time. */
export function forgetLiveAvailability(): void {
  answer = null;
  asking = null;
}
