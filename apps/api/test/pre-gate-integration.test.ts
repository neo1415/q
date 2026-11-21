import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * W1-A (enterprise audit 21 Nov 2026, finding 7): the pre-gate runs the
 * integration tests touching what changed, and pgTAP for a changed
 * database file, on a fresh local Supabase, the way the gate does, so a
 * pinned version cannot fail the gate late again. A structural check of
 * the script itself (it is bash; its run is the pre-gate).
 */
const script = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "scripts", "pre-gate.sh"),
  "utf8",
);

describe("the pre-gate covers integration tests", () => {
  it("runs the integration config on the files touching what changed", () => {
    expect(script).toContain("--config vitest.integration.config.ts");
    expect(script).toContain("*.integration.test.ts");
    // A test that imports a changed package counts, not only its own.
    expect(script).toMatch(/grep -rlF --include='\*\.integration\.test\.ts'/u);
  });

  it("runs pgTAP when a migration or database test changed", () => {
    expect(script).toContain("supabase/(migrations|tests)/");
    expect(script).toContain("supabase test db");
  });

  it("uses a fresh local Supabase and stops it after, with the gate's database URL", () => {
    expect(script).toContain("supabase stop --no-backup");
    expect(script).toContain("supabase start -x");
    expect(script).toContain(
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
  });

  it("can be skipped only out loud", () => {
    expect(script).toContain("SKIPPED by PRE_GATE_INTEGRATION=0");
  });
});
