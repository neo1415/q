import { describe, expect, it } from "vitest";

import { matchCounterpart } from "../src/index.js";

/**
 * Live 12 Nov (945138faf): "Prepare an investment plan for Ledgerline…" was
 * refused (NO_NAMED_COMPANY): beside the one "Ledgerline", ten "Ledgerline
 * XXXX (fictional)" sign-ups made the name ambiguous, so no company was
 * bound to the plan.
 */
describe("a name said exactly", () => {
  const record = (id: string, name: string) => ({ id, name });

  it("wins over names that only begin with it", () => {
    expect(
      matchCounterpart("Ledgerline", [
        record("look-1", "Ledgerline ZC4T (fictional)"),
        record("exact", "Ledgerline"),
        record("look-2", "Ledgerline 1CQB (fictional)"),
      ]),
    ).toBe("exact");
    // Case, spacing and punctuation as nameKey reads them.
    expect(
      matchCounterpart("tensor gate", [
        record("exact", "Tensorgate"),
        record("other", "Tensorgate Labs"),
      ]),
    ).toBe("exact");
  });

  it("two records with the very same name are still ambiguous", () => {
    expect(
      matchCounterpart("Zino Aviation", [
        record("a", "Zino Aviation"),
        record("b", "Zino Aviation"),
      ]),
    ).toBeNull();
  });

  it("without an exact name, the closeness rule applies as before", () => {
    expect(
      matchCounterpart("Ledgerline", [
        record("a", "Ledgerline ZC4T (fictional)"),
        record("b", "Ledgerline 1CQB (fictional)"),
      ]),
    ).toBeNull();
  });
});
