/**
 * The GPT-Live trial in the browser (owner 2026-10-12). The Q API measures
 * the allowance and is its only authority; the page only says, plainly and
 * once at a time, how much live voice is left and when it is used up.
 */

/** Said when a trial call opens, e.g. "About 3 min of live voice left." */
export function liveTrialLeftNotice(remainingSeconds: number): string {
  if (remainingSeconds >= 90) {
    return `About ${String(Math.round(remainingSeconds / 60))} min of live voice left.`;
  }
  return remainingSeconds >= 60
    ? "About a minute of live voice left."
    : "Less than a minute of live voice left.";
}

/** Said once the allowance is used up and the standard voice takes over. */
export const LIVE_TRIAL_SPENT_NOTICE =
  "Your live voice trial is used up, so I'm on my standard voice.";

/** Below this, a running call says once that little is left. */
export const LIVE_TRIAL_LOW_SECONDS = 60;

// One notice waiting for the next voice start in this tab (module state, as
// the availability answer is): the call that ran out cannot show it itself,
// because the standard voice comes up after it has ended.
let pending: string | null = null;

export function noteLiveTrialSpent(): void {
  pending = LIVE_TRIAL_SPENT_NOTICE;
}

/** The waiting notice, once. */
export function takeLiveTrialNotice(): string | null {
  const notice = pending;
  pending = null;
  return notice;
}
