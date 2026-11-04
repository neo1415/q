/**
 * Whether "Back" may use the browser's history (UX-04). Only when the
 * previous entry is a Capital Q page: one reached by a client-side move in
 * this tab (and this is not the page the tab arrived on), or a same-origin
 * referrer. Otherwise the caller's fallback link (the page's parent) is
 * used, so a deep link never leaves the app and Back never loops out.
 */

let landing: string | null = null;
let movedInApp = false;

/** The page this tab arrived on, recorded once. */
export function markLanding(pathname: string): void {
  landing ??= pathname;
}

/** A client-side navigation happened in this tab. */
export function markInAppNavigation(): void {
  movedInApp = true;
}

/** Tests only. */
export function resetInAppNavigation(): void {
  landing = null;
  movedInApp = false;
}

export function canGoBack(history: {
  readonly length: number;
  readonly referrer: string;
  readonly origin: string;
  readonly pathname: string;
}): boolean {
  if (history.length <= 1) return false;
  if (movedInApp && history.pathname !== landing) return true;
  if (history.referrer === "") return false;
  try {
    return new URL(history.referrer).origin === history.origin;
  } catch {
    return false;
  }
}
