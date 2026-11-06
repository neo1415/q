import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Owner 2026-11-06 (asked twice): Home shows no "Q is working on N
 * things" panel. Running work is on the Board and on /work.
 */
const home = readFileSync(
  fileURLToPath(
    new URL("../src/features/home/home-screen.tsx", import.meta.url),
  ),
  "utf8",
);

describe("Home without the work panel", () => {
  it("never mounts WorkPanel", () => {
    expect(home).not.toMatch(/<WorkPanel\b/u);
    expect(home).not.toContain("@/features/work/work-panel");
  });
});
