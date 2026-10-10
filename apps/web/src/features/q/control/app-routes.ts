/**
 * R3 (founder, hosted 2026-10-09: "Q says it is opening the page; then the
 * app says the page could not be opened"): the typed route table Q's moves
 * are validated against BEFORE anything executes.
 *
 * - `APP_ROUTE_PATTERNS`: every page the signed-in app has. A move to a
 *   path that matches none fails at VALIDATED ("that page doesn't exist"),
 *   never as a 20-second timeout. A test reads the app directory and fails
 *   when a page is added without being listed here.
 * - `ROUTE_REDIRECTS`: pages that send the person on (server `redirect()`
 *   or the page's own client replace). A move to one is VERIFIED where it
 *   was sent, never reported as a page that didn't open.
 * - Viewer rules: only what the browser already knows (its own shell
 *   context) to say "that page isn't available to you" early. This is an
 *   honest message, not authorization: every page and the API still
 *   authorise server-side (UI hiding is not authorization).
 */

/** Pathname patterns of the app's pages (`[param]` is one segment). */
export const APP_ROUTE_PATTERNS: readonly string[] = [
  "/admin",
  "/admin/accounts",
  "/admin/accounts/[userId]",
  "/admin/audit",
  "/admin/billing",
  "/admin/brand",
  "/admin/claims",
  "/admin/email",
  "/admin/etiquette",
  "/admin/flags",
  "/admin/organisations",
  "/admin/organisations/[organisationId]",
  "/admin/q",
  "/admin/q/runs/[runId]",
  "/admin/queue",
  "/admin/reviews",
  "/admin/safety",
  "/admin/safety/break-glass/[requestId]",
  "/admin/team",
  "/admin/verification",
  "/capital",
  "/company/[companyId]",
  "/company/[companyId]/founder/[position]",
  "/company/interest",
  "/company/visibility",
  "/daily",
  "/daily/[editionId]",
  "/discover",
  "/discover/passed",
  "/discover/saved",
  "/discover/saved/compare",
  "/discover/yours",
  "/documents",
  "/explore",
  "/find",
  "/gateq",
  "/gateway",
  "/home",
  "/investors",
  "/investors/[investorOrganisationId]",
  "/investors/[investorOrganisationId]/rehearse",
  "/investors/top",
  "/join/[token]",
  "/onboarding/founder",
  "/onboarding/investor",
  "/pitch",
  "/pitch/[mediaAssetId]",
  "/pitch/new",
  "/profile",
  "/rehearsals",
  "/rehearsals/company/[companyId]",
  "/rehearsals/investor/[investorOrganisationId]",
  "/rehearsals/person/[externalPersonId]",
  "/rehearsals/meeting/[meetingId]",
  "/rehearsals/r/[rehearsalId]",
  "/relationships",
  "/relationships/company/[companyId]",
  "/relationships/company/[companyId]/calls",
  "/relationships/company/[companyId]/diligence",
  "/relationships/company/[companyId]/messages",
  "/relationships/investor/[investorOrganisationId]",
  "/relationships/investor/[investorOrganisationId]/calls",
  "/relationships/investor/[investorOrganisationId]/diligence",
  "/relationships/investor/[investorOrganisationId]/messages",
  "/results",
  "/reviews",
  "/search",
  "/settings",
  "/settings/billing",
  "/settings/memory",
  "/settings/plan",
  "/settings/reconnect/google",
  "/settings/team",
  "/settings/usage",
  "/verification",
  "/welcome",
  "/work",
  "/work/[delegationId]",
  "/work/[delegationId]/report/[laneId]",
];

function patternRegex(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((segment) =>
      /^\[[A-Za-z]+\]$/u.test(segment)
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${body}$`, "u");
}

const ROUTES = APP_ROUTE_PATTERNS.map(patternRegex);

/** The pathname of an in-app route, without trailing slash. */
export function pathnameOf(route: string): string | null {
  let url: URL;
  try {
    url = new URL(route, "http://route.local");
  } catch {
    return null;
  }
  if (url.origin !== "http://route.local") return null;
  return url.pathname.replace(/\/+$/u, "") || "/";
}

/** Whether the app has a page at this route's pathname. */
export function isAppRoute(route: string): boolean {
  const path = pathnameOf(route);
  return path !== null && ROUTES.some((regex) => regex.test(path));
}

/**
 * Where a page sends the person: given the pathname asked for, whether a
 * landing pathname is one it may send them to. Mirrors the pages' own
 * `redirect()` calls (and client replaces); a test keeps the list honest.
 */
type Redirect = {
  readonly from: RegExp;
  readonly to: (match: RegExpMatchArray, landed: string) => boolean;
};

const startsWith =
  (...prefixes: readonly string[]) =>
  (_: RegExpMatchArray, landed: string) =>
    prefixes.some(
      (prefix) => landed === prefix || landed.startsWith(`${prefix}/`),
    );

export const ROUTE_REDIRECTS: readonly Redirect[] = [
  { from: /^\/gateway$/u, to: startsWith("/gateq") },
  { from: /^\/discover\/yours$/u, to: startsWith("/discover") },
  {
    from: /^\/admin\/(?:verification|reviews)$/u,
    to: startsWith("/admin/queue"),
  },
  // A founder's /investors sends them to Discover (go-to-discover.tsx).
  { from: /^\/investors$/u, to: startsWith("/discover") },
  { from: /^\/investors\/top$/u, to: startsWith("/investors", "/discover") },
  {
    from: /^\/investors\/[^/]+\/rehearse$/u,
    to: startsWith("/rehearsals/investor"),
  },
  { from: /^\/find$/u, to: startsWith("/search") },
  {
    from: /^\/rehearsals\/meeting\/[^/]+$/u,
    to: startsWith("/rehearsals/company", "/rehearsals/investor"),
  },
  {
    from: /^\/relationships\/(company|investor)\/([^/]+)\/(?:calls|diligence|messages)$/u,
    to: (match, landed) =>
      landed === `/relationships/${match[1] ?? ""}/${match[2] ?? ""}`,
  },
  { from: /^\/pitch\/[^/]+$/u, to: startsWith("/pitch") },
  // Home sends a person with unfinished setup to it.
  { from: /^\/home$/u, to: startsWith("/onboarding", "/welcome") },
  {
    from: /^\/settings\/reconnect\/google$/u,
    to: startsWith("/settings", "/connected"),
  },
  { from: /^\/verification$/u, to: () => true },
];

/** Redirects a page declares at runtime (it knows where it sends them). */
const declared = new Map<
  string,
  { readonly to: string; readonly at: number }
>();
const DECLARED_FRESH_MS = 60_000;

export function noteRedirect(from: string, to: string): void {
  const path = pathnameOf(from);
  if (path !== null) declared.set(path, { to, at: Date.now() });
}

/** Whether landing on `actual` is where a page asked for as `expected` sent them. */
export function redirectedTo(expected: string, actual: string): boolean {
  const want = pathnameOf(expected);
  const got = pathnameOf(actual);
  if (want === null || got === null || want === got) return false;
  const runtime = declared.get(want);
  if (
    runtime !== undefined &&
    Date.now() - runtime.at <= DECLARED_FRESH_MS &&
    pathnameOf(runtime.to) === got
  ) {
    return true;
  }
  for (const rule of ROUTE_REDIRECTS) {
    const match = want.match(rule.from);
    if (match !== null && rule.to(match, got)) return true;
  }
  return false;
}

/** What the browser knows of who is signed in (the shell's own context). */
export type NavigationViewer = {
  readonly kind: "FOUNDER" | "INVESTOR" | "NONE";
  readonly admin: boolean;
};

let viewer: NavigationViewer | null = null;

/** The shell registers its viewer; null before it has (rules then skip). */
export function registerNavigationViewer(next: NavigationViewer | null): void {
  viewer = next;
}

/** Who the shell registered as signed in (null before it has). */
export function currentNavigationViewer(): NavigationViewer | null {
  return viewer;
}

export type RouteValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "NOT_FOUND" | "UNAUTHORIZED" };

/**
 * VALIDATED: the route exists and, as far as the browser knows, is the
 * person's to open. Only in-app paths are ever moves.
 */
export function validateRoute(route: string): RouteValidation {
  if (!route.startsWith("/") || route.startsWith("//") || !isAppRoute(route)) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  const path = pathnameOf(route) ?? "";
  if (
    viewer !== null &&
    !viewer.admin &&
    (path === "/admin" || path.startsWith("/admin/"))
  ) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }
  return { ok: true };
}

/** Clears runtime state (tests). */
export function resetAppRoutes(): void {
  declared.clear();
  viewer = null;
}
