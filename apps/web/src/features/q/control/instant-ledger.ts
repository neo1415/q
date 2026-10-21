/**
 * Lane 7: what the screen just did by itself for the latest sentence
 * ("scroll down", "press Show more"). A voice line that also routes the
 * same words to Q (duplex) gets Q's answer carrying the same act seconds
 * later; done twice it would scroll twice or toggle a disclosure back
 * shut. Q's act is dropped once when it is the one already done.
 */
const SAME_ACT_MS = 15_000;

let done: { readonly key: string; readonly at: number } | null = null;

/** The act the screen did: "SCROLL_DOWN", "control:<id>", "theme:dark". */
export function noteInstantAct(key: string): void {
  done = { key, at: Date.now() };
}

/** True once when Q's act is the one the screen already did. */
export function doneByScreen(key: string): boolean {
  if (done === null || Date.now() - done.at > SAME_ACT_MS) return false;
  if (done.key !== key) return false;
  done = null;
  return true;
}

/** Tests. */
export function resetInstantLedger(): void {
  done = null;
}
