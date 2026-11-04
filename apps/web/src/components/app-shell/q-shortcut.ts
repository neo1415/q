/**
 * The keyboard shortcut that opens Q (doc 17 §164; client feedback UX-05,
 * 2026-11-04). Control/Command+K, never Q: macOS reserves Command+Q to quit
 * the browser, and a web page cannot (and must not try to) take it over.
 * Pure, so a test pins which keys open Q and which never do.
 */

type ShortcutKeys = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey"
>;

export function opensQ(event: ShortcutKeys): boolean {
  if (event.altKey) return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  return event.key.toLowerCase() === "k";
}

/** For `aria-keyshortcuts` on every control that opens Q. */
export const Q_SHORTCUT_ARIA = "Control+K Meta+K";

/** The visible hint, in the reader's platform's words. */
export function qShortcutHint(apple: boolean): string {
  return apple ? "⌘K" : "Ctrl K";
}

/** Whether the platform names the modifier Command (macOS, iPadOS). */
export function isApplePlatform(platform: string, userAgent: string): boolean {
  return /mac|iphone|ipad|ipod/iu.test(platform) || /Mac OS X/u.test(userAgent);
}
