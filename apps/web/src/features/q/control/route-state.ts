/**
 * RECOVERY-2026-10 (C2/C3): the routes this tab has shown, as the app's
 * router committed them (QControlRuntime reports each one after Next has
 * rendered it). A UI act that moves the page is confirmed only once the
 * router has settled on the new route -- never on the click alone.
 */

let route: string | null = null;
let epoch = 0;
const trail: string[] = [];
const TRAIL_MAX = 32;

/** The shell reports each route it shows (pathname plus search). */
export function noteRoute(path: string): void {
  if (path === route) return;
  route = path;
  epoch += 1;
  trail.push(path);
  if (trail.length > TRAIL_MAX) trail.shift();
}

/** The route the router last settled on, or null before the shell reported one. */
export function currentRoute(): string | null {
  return route;
}

/** A number that moves with every settled route change. */
export function routeEpoch(): number {
  return epoch;
}

/** The routes this tab showed, oldest first (the person's own trail). */
export function routeTrail(): readonly string[] {
  return [...trail];
}

/**
 * The in-app route a link goes to (pathname plus search), or null for a
 * link that leaves the app or carries only a hash.
 */
export function routeOfHref(href: string): string | null {
  if (typeof window === "undefined") return null;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  return `${url.pathname}${url.search}`;
}

/** Clears the trail (tests). */
export function resetRouteState(): void {
  route = null;
  epoch = 0;
  trail.length = 0;
}
