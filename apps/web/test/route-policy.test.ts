import { describe, expect, it } from "vitest";

import { classifyRoute } from "../src/auth/route-policy";

describe("classifyRoute", () => {
  it.each([
    "/home",
    "/home/anything",
    "/discover",
    "/capital",
    "/capital/objectives/1",
    "/profile",
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
