import { signInPath } from "./redirect-safety";

/**
 * Who sees the landing page at `/` (founder routing rules, 2026-10-04).
 *
 * The landing is for a signed-out visitor in a browser tab, nobody else:
 *
 *   - signed in → the application, as before (`/welcome` decides between
 *     onboarding and the Q page);
 *   - an installed launch (`start_url` carries `?source=pwa`) → straight
 *     into the application, which for a signed-out person is sign-in;
 *   - everyone else → the prerendered landing.
 *
 * Decided in the request proxy, before any HTML, so the landing never
 * flashes on an installed launch. The splash is unaffected: it lives in
 * the root layout, so it plays first on whichever page this lands on.
 * An install whose start URL predates the flag (or an iOS Home Screen
 * shortcut made from `/`) is caught by `PWA_STANDALONE_SCRIPT` instead.
 */

export const PWA_SOURCE_PARAM = "source";
export const PWA_SOURCE_VALUE = "pwa";
export const PWA_START_URL = `/?${PWA_SOURCE_PARAM}=${PWA_SOURCE_VALUE}`;

/** Where the app starts for anyone who is not shown the landing. */
const APP_ENTRY = "/welcome";

export function landingRedirect(input: {
  readonly signedIn: boolean;
  readonly searchParams: URLSearchParams;
}): string | null {
  if (input.signedIn) return APP_ENTRY;
  if (input.searchParams.get(PWA_SOURCE_PARAM) === PWA_SOURCE_VALUE) {
    return signInPath(APP_ENTRY);
  }
  return null;
}

/**
 * The client-side fallback: a standalone display mode with no flag. Runs
 * inline at the top of the landing, before its content paints; the CSS
 * hides the landing while `data-pwa` is set, so nothing flashes before the
 * navigation. The proxy then routes `/welcome` as for any installed launch.
 */
export const PWA_STANDALONE_SCRIPT = `try{if((window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true){document.documentElement.setAttribute("data-pwa","");location.replace(${JSON.stringify(APP_ENTRY)})}}catch(e){}`;

/**
 * The fallback's rule, as a function: the script above is this, inlined so
 * it runs before any paint. Kept together so they cannot drift.
 */
export function isStandaloneLaunch(win: {
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
  readonly navigator: { readonly standalone?: boolean };
}): boolean {
  return (
    (typeof win.matchMedia === "function" &&
      win.matchMedia("(display-mode: standalone)").matches) ||
    win.navigator.standalone === true
  );
}
