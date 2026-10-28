/**
 * When to offer installing Capital Q (founder directive, 2026-09-27). Pure,
 * so every rule is a test; the component only reads the browser facts.
 *
 * - Already installed (standalone): never.
 * - Dismissed: not again on this device for 14 days (live run
 *   2026-10-28: once for ever hid it from a person who had meant "later").
 * - The Q page while a conversation is in progress: never; it is a hint,
 *   not something to read around while talking to Q.
 * - Chrome / Android / desktop Chromium: only once the browser itself has
 *   said the app is installable (`beforeinstallprompt`), and the offer
 *   calls the browser's own prompt.
 * - iOS / iPadOS Safari, which has no such event: a one-line hint to use
 *   Share → Add to Home Screen.
 * - Anything else: nothing.
 *
 * Discover is excluded: the pitch is the screen there, and nothing is laid
 * over it that the person did not ask for.
 */

export const INSTALL_DISMISSED_KEY = "cq.install-prompt.dismissed";
/** How long a dismissal holds before the hint may show once more. */
export const INSTALL_DISMISSED_FOR_MS = 14 * 24 * 60 * 60 * 1000;

export type InstallFacts = {
  readonly standalone: boolean;
  readonly dismissed: boolean;
  /** The browser fired `beforeinstallprompt` and we are holding it. */
  readonly deferredPrompt: boolean;
  readonly userAgent: string;
  /** iPadOS reports a Mac user agent; touch points tell them apart. */
  readonly maxTouchPoints: number;
  readonly pathname: string;
  /** The Q page has a conversation going (turns, or Q at work). */
  readonly conversing?: boolean | undefined;
};

export type InstallOffer = "NONE" | "PROMPT" | "IOS_HINT";

export function isIosSafari(userAgent: string, maxTouchPoints: number) {
  const ios =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  // Other iOS browsers (CriOS, FxiOS, EdgiOS) cannot add to the Home Screen
  // from their own menu on every version; Safari is the one that can.
  const safari =
    /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  return ios && safari;
}

export function installOffer(facts: InstallFacts): InstallOffer {
  if (facts.standalone || facts.dismissed) return "NONE";
  if (
    facts.pathname === "/discover" ||
    facts.pathname.startsWith("/discover/")
  ) {
    return "NONE";
  }
  if (facts.conversing === true && facts.pathname === "/home") return "NONE";
  if (facts.deferredPrompt) return "PROMPT";
  if (isIosSafari(facts.userAgent, facts.maxTouchPoints)) return "IOS_HINT";
  return "NONE";
}

/**
 * Dismissed within the last 14 days. Storage can be absent or throw
 * (private mode, blocked site data). The value is the dismissal's time
 * in ms; the older "1" (dismissed for ever) still counts as dismissed.
 */
export function readDismissed(
  storage: Storage | undefined,
  now: number = Date.now(),
): boolean {
  try {
    const raw = storage?.getItem(INSTALL_DISMISSED_KEY);
    if (raw === null || raw === undefined) return false;
    if (raw === "1") return true;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < INSTALL_DISMISSED_FOR_MS;
  } catch {
    return false;
  }
}

export function rememberDismissed(
  storage: Storage | undefined,
  now: number = Date.now(),
): void {
  try {
    storage?.setItem(INSTALL_DISMISSED_KEY, String(now));
  } catch {
    // Not remembered on this device; it is still dismissed for this visit.
  }
}
