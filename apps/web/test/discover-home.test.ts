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

/** Discover is home (founder directive, 2026-09-27); Q is one tap away. */
describe("Discover is where the product starts", () => {
  it("the root sends everyone to arrival; the landing waits for its redo", async () => {
    // Founder 2026-10-04: until the landing's visual redo is approved, the
    // root is the app's arrival again for everyone.
    const { default: RootPage } = await import("../app/page");
    expect(() => RootPage()).toThrow("REDIRECT /welcome");
    const { landingRedirect } = await import("../src/auth/landing-route");
    expect(
      landingRedirect({ signedIn: true, searchParams: new URLSearchParams() }),
    ).toBe("/welcome");
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
