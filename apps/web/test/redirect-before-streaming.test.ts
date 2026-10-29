import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { redirectBeforeStreaming } from "../src/features/q/redirect-response";

/**
 * Live 2026-10-29 (onboarding-3, React #419 a second after leaving the
 * completed investor setup for /company): /company and /mandate were pages
 * under the app's loading boundary, so their redirect() ran after that
 * boundary streamed. Next answered 200 with a meta refresh to /profile and
 * a boundary the server "could not finish"; the client reported #419.
 */
describe("a bare address redirects before any HTML", () => {
  it("answers 307 with an in-app Location", () => {
    const response = redirectBeforeStreaming("/profile?section=mandate");
    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe("/profile?section=mandate");
    expect(
      redirectBeforeStreaming("https://elsewhere.example").headers.get(
        "Location",
      ),
    ).toBe("/");
    expect(
      redirectBeforeStreaming("//elsewhere.example").headers.get("Location"),
    ).toBe("/");
  });

  it("/company and /mandate are route handlers, not pages under the loading boundary", () => {
    const app = join(import.meta.dirname, "..", "app", "(app)");
    for (const segment of ["company", "mandate"]) {
      expect(existsSync(join(app, segment, "page.tsx"))).toBe(false);
      expect(readFileSync(join(app, segment, "route.ts"), "utf8")).toContain(
        "redirectBeforeStreaming(",
      );
    }
  });
});
