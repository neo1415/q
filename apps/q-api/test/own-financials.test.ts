import { describe, expect, it } from "vitest";

import { toOwnFinancialFigure } from "../src/composition/own-financials.js";

/**
 * F06 (Q-page sweep 2026-10-29): the founder's own figures for their own
 * financial model. A CONFIDENTIAL figure is theirs and is shown back to
 * them in their words; one stored above it leaves the read as held back,
 * its measure only.
 */
describe("own financial figures for the model", () => {
  it("a CONFIDENTIAL figure is their own claim, in their words, with its value", () => {
    expect(
      toOwnFinancialFigure({
        knowledge_key: "financial.cash_balance",
        statement: "The founder said cash in the bank is USD 310,000.",
        structured_value: { kind: "MONEY", amount: "310000", currency: "USD" },
        sensitivity_class: "CONFIDENTIAL",
        recorded_at: new Date("2026-10-28T10:00:00Z"),
      }),
    ).toEqual({
      key: "financial.cash_balance",
      heldBack: false,
      statement: "You told Q: cash in the bank is USD 310,000.",
      value: { kind: "MONEY", amount: "310000", currency: "USD" },
      asOf: "2026-10-28",
    });
  });

  it("a HIGHLY_CONFIDENTIAL figure carries neither its words nor its value", () => {
    const figure = toOwnFinancialFigure({
      knowledge_key: "financial.burn_rate",
      statement: "The founder said monthly net burn is USD 77,777.",
      structured_value: { kind: "MONEY", amount: "77777", currency: "USD" },
      sensitivity_class: "HIGHLY_CONFIDENTIAL",
      recorded_at: "2026-10-01T10:00:00Z",
    });
    expect(figure).toEqual({
      key: "financial.burn_rate",
      heldBack: true,
      statement: null,
      value: null,
      asOf: "2026-10-01",
    });
    expect(JSON.stringify(figure)).not.toContain("77");
  });
});
