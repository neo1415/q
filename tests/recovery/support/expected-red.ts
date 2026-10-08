import { test } from "@playwright/test";

/**
 * Expected red, honestly. The test still runs and still fails; this only
 * records WHY it is expected to fail today and which TRACKING rows will
 * turn it green. `scripts/recovery/results-table.mjs` reads the annotation
 * and reports EXPECTED RED versus UNEXPECTED RED, and flags a test that
 * passes while still annotated so the annotation is removed.
 *
 * Deliberately not `test.fail()` (which reports a failure as a pass) and
 * not `test.skip()` (which hides it): SPEC §4.8, no fake progress.
 */
export function awaits(rows: readonly string[], why: string): void {
  test.info().annotations.push({
    type: "expected-red",
    description: `${rows.join(", ")}: ${why}`,
  });
}

/** Names the promise and step a test proves, for the promise table. */
export function proves(promise: string, step: number, title: string): void {
  test.info().annotations.push({
    type: "promise-step",
    description: `${promise}|${String(step)}|${title}`,
  });
}
