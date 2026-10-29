import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(import.meta.dirname, "../app/globals.css"),
  "utf8",
);

/**
 * Live 2026-10-29 at 390: Previous and Next measured 44x44, but the hit
 * test at their centre was the pitch's VIDEO ("intercepts pointer
 * events"): on a phone they were clipped to nothing unless focused, so the
 * swipe had no single-tap equivalent (WCAG 2.2 SC 2.5.7).
 */
describe("Discover's Previous and Next can be tapped on a phone", () => {
  it("are never clipped away when not focused", () => {
    expect(css).not.toMatch(
      /\.cq-feed-nav:not\(:focus-within\)\s*\{[^}]*clip-path/u,
    );
  });

  it("sit above the stage on the z-index token scale", () => {
    const rule = /\n {2}\.cq-feed-nav \{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/z-index:\s*var\(--cq-z-[a-z-]+\)/u);
  });
});
