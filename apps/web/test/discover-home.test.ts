import { describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";
import {
  PRIMARY_NAVIGATION,
  MOBILE_NAVIGATION,
} from "../src/components/app-shell/navigation";
import { destinationPath } from "../src/features/voice/destinations";

const redirect = vi.fn((to: string): never => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect }));
// next/font is a build-time transform; in a unit test it is just a class.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font", variable: "font-var", style: {} }),
}));

/** Discover is home (founder directive, 2026-09-27); Q is one tap away. */
describe("Discover is where the product starts", () => {
  it("the root is the landing for signed-out visitors; signed-in people go to arrival", async () => {
    // Founder 2026-10-04: the approved landing is the root again. The
    // request proxy still sends signed-in people and installed launches
    // into the app before any HTML (landing-proxy.test.ts).
    const page = await import("../app/page");
    expect(page.dynamic).toBe("force-static");
    expect(redirect).not.toHaveBeenCalled();
    const { landingRedirect } = await import("../src/auth/landing-route");
    expect(
      landingRedirect({ signedIn: true, searchParams: new URLSearchParams() }),
    ).toBe("/welcome");
    expect(
      landingRedirect({ signedIn: false, searchParams: new URLSearchParams() }),
    ).toBeNull();
  });

  it("keeps Q reachable at /home, and /q redirects there with its query", async () => {
    const rules = (await nextConfig.redirects?.()) ?? [];
    expect(rules).toContainEqual({
      source: "/q",
      destination: "/home",
      permanent: false,
    });
    // Spoken "take me home" still means Q's page (R20).
    expect(destinationPath("HOME")).toBe("/home");
    expect(destinationPath("DISCOVER")).toBe("/discover");
  });

  it("puts Discover first everywhere and Q in the centre of the phone bar", () => {
    expect(PRIMARY_NAVIGATION[0]?.href).toBe("/discover");
    expect(MOBILE_NAVIGATION[0]?.href).toBe("/discover");
    expect(MOBILE_NAVIGATION[2]?.href).toBe("/home");
    expect(MOBILE_NAVIGATION).toHaveLength(4);
  });
});
