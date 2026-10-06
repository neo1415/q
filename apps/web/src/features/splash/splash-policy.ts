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

// OAuth and email-link returns land mid-flow; public cards and share links
// are someone else's page. Sign-in and sign-up are a first screen like any
// other, so they get the splash on a cold entry.
const SKIPPED_PATHS = [
  "/auth/callback",
  "/auth/update-password",
  "/u/",
  "/c/",
  // A GateQ gateway, often inside someone else's website.
  "/g/",
  "/@",
  "/api/",
];

/**
 * How long the formation takes on screen (demo audit 2026-10-03: the
 * splash held the sign-in form for ~6.5 s; the whole splash, hold and
 * fade included, now stays under 2 s).
 */
export const SPLASH_FORMATION_MS = 1_300;

/**
 * P9: the latest the splash may still be on screen, counted from the
 * page's start rather than from when its code ran. On a slow line the
 * code arrives seconds after the first paint, and the splash used to
 * start only then, holding a page that was already there. The overlay
 * enforces this once its code runs (and skips the animation when too
 * little time is left to form the Q); before that, CSS does
 * (`cq-splash-expire` in globals.css, timed from the splash's first paint).
 */
export const SPLASH_DEADLINE_MS = 2_400;

/*
 * Before the page's code arrives (seconds, on a slow line) a tap or a key
 * still skips the splash: the boot rule listens until the overlay takes
 * over (`data-live`), then leaves it to the overlay's own fade.
 */
export const SPLASH_BOOT_SCRIPT = `try{var p=location.pathname;if(sessionStorage.getItem(${JSON.stringify(
  SPLASH_SEEN_KEY,
)})||${JSON.stringify(SKIPPED_PATHS)}.some(function(s){return p.indexOf(s)===0})){document.documentElement.setAttribute("data-splash","off")}else{var k=function(){if(document.querySelector(".cq-splash[data-live]"))return;document.documentElement.setAttribute("data-splash","off");try{sessionStorage.setItem(${JSON.stringify(
  SPLASH_SEEN_KEY,
)},"1")}catch(e){}};addEventListener("pointerdown",k,{capture:true,once:true});addEventListener("keydown",k,{capture:true,once:true})}}catch(e){document.documentElement.setAttribute("data-splash","off")}`;

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
