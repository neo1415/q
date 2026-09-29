/**
 * When the splash shows (founder handoff revision 3): on a cold entry,
 * once per browser session. A PWA launch is a new session, so it plays on
 * every launch from the home screen. Never on an OAuth return, a public
 * Q card or a share link, and never on internal navigation (the overlay
 * lives in the root layout, which does not remount).
 *
 * The boot rule runs in <head> before anything paints, so a skipped
 * splash never flashes.
 */
export const SPLASH_SEEN_KEY = "cq.splash.seen";
export const SPLASH_DONE_EVENT = "cq:splash-done";

const SKIPPED_PATHS = ["/auth/", "/u/", "/c/", "/@", "/api/"];

export const SPLASH_BOOT_SCRIPT = `try{var p=location.pathname;if(sessionStorage.getItem(${JSON.stringify(
  SPLASH_SEEN_KEY,
)})||${JSON.stringify(SKIPPED_PATHS)}.some(function(s){return p.indexOf(s)===0})){document.documentElement.setAttribute("data-splash","off")}}catch(e){document.documentElement.setAttribute("data-splash","off")}`;

/**
 * The boot rule, as a function: the script above is this, inlined so it
 * runs before any paint. Kept together so they cannot drift.
 */
export function splashSkippedFor(pathname: string, seen: boolean): boolean {
  return seen || SKIPPED_PATHS.some((prefix) => pathname.startsWith(prefix));
}

/** Whether the boot rule already decided not to show it. */
export function splashWasSkipped(): boolean {
  return document.documentElement.dataset["splash"] === "off";
}

/** Whether the splash is still on screen (Discover waits for it). */
export function splashShowing(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset["splash"] !== "off" &&
    document.querySelector(".cq-splash") !== null
  );
}
