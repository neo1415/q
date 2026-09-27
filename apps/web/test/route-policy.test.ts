import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { config as proxyConfig } from "../proxy";
import {
  classifyRoute,
  PROTECTED_PATH_PREFIXES,
  SIGNED_OUT_ONLY_PATHS,
} from "../src/auth/route-policy";

/** The first path segment of every route a signed-in person reaches. */
function sessionRouteSegments(): string[] {
  const segments: string[] = [];
  for (const group of ["(app)", "(onboarding)"]) {
    const root = new URL(`../app/${group}/`, import.meta.url);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) segments.push(`/${entry.name}`);
    }
  }
  return segments;
}

/** Whether the proxy's static matcher runs on this path. */
function proxyRunsOn(pathname: string): boolean {
  return proxyConfig.matcher.some((pattern) => {
    const prefix = pattern.replace(/\/:path\*$/, "");
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

/**
 * The session is refreshed, and the rotated cookies written, only where the
 * proxy runs. A protected page it skipped still rendered signed in -- the
 * layout re-verifies -- so nothing looked wrong; but with an expired access
 * token that page refreshed inside a Server Component, could not write the
 * result, and the browser kept the old session (CQ-WEB-030: /welcome, which
 * every sign-in lands on, did four discarded refreshes per render).
 */
describe("the proxy covers the route policy", () => {
  it.each(sessionRouteSegments())(
    "every signed-in route (%s) is protected and refreshed by the proxy",
    (segment) => {
      expect(classifyRoute(segment)).toBe("protected");
      expect(proxyRunsOn(segment)).toBe(true);
    },
  );

  it.each([...PROTECTED_PATH_PREFIXES, ...SIGNED_OUT_ONLY_PATHS])(
    "the proxy runs on %s",
    (path) => {
      expect(proxyRunsOn(path)).toBe(true);
    },
  );
});

describe("classifyRoute", () => {
  it.each([
    "/home",
    "/home/anything",
    "/welcome",
    "/pitch",
    "/company/visibility",
    "/discover",
    "/capital",
    "/capital/objectives/1",
    "/profile",
    "/settings",
    "/relationships",
    "/onboarding/founder",
    "/onboarding/investor",
    "/auth/update-password",
  ])("protects %s", (path) => {
    expect(classifyRoute(path)).toBe("protected");
  });

  it.each(["/auth/sign-in", "/auth/sign-up", "/auth/forgot-password"])(
    "reserves %s for signed-out visitors",
    (path) => {
      expect(classifyRoute(path)).toBe("signed-out-only");
    },
  );

  it.each([
    "/",
    "/auth/callback",
    "/auth/check-email",
    "/manifest.webmanifest",
    "/sw.js",
    "/icons/icon-192.png",
    "/_next/static/chunk.js",
    "/dev/ui",
    "/homepage",
    "/profiles",
  ])(
    "leaves %s public (and never matches on a prefix without a boundary)",
    (path) => {
      expect(classifyRoute(path)).toBe("public");
    },
  );
});
