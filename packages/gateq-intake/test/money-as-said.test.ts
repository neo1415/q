import { describe, expect, it } from "vitest";

import type { GateQStatementOpV3 } from "@capital-q/q-core";

import { moneyAsSaid } from "../src/application/statement-plan.js";

/**
 * Money only as said (live 64637e8c9 t10: "It buys about 18 months" was
 * stored as a raise of USD 18). Decided from the reader's own `unit` and
 * the founder's own words for the statement, never the rest of the turn.
 */
const money = (
  amount: string,
  words: string,
  unit: string | null | undefined,
  currency: string | null = null,
): GateQStatementOpV3 => ({
  op: "CORRECTS",
  target: "S3",
  turn: null,
  dimension: "raise.amount",
  quantity: "raise_amount",
  value: { kind: "MONEY", amount, currency },
  asOf: null,
  words,
  provenance: "APPLICANT_PROVIDED",
  ...(unit === undefined ? {} : { unit }),
});

describe("money only as said", () => {
  it("a span of months the reader names is runway, never a raise", () => {
    const read = moneyAsSaid(
      money("18", "It buys about 18 months.", "month", "USD"),
      "It buys about 18 months.",
    );
    expect(read).toMatchObject({
      op: "NEW",
      target: null,
      dimension: "raise.use_of_funds",
      quantity: "runway_months",
      value: { kind: "COUNT", count: "18" },
    });
  });

  it("a number with no currency or money unit of its own is not money, whatever currency the reader added", () => {
    for (const unit of [null, undefined])
      expect(
        moneyAsSaid(
          money("18", "It buys about 18 months.", unit, "USD"),
          "It buys about 18 months.",
        ),
      ).toBeNull();
    expect(
      moneyAsSaid(money("2", "two years", "year"), "two years"),
    ).toBeNull();
    expect(moneyAsSaid(money("40", "40%", "%"), "40%")).toBeNull();
  });

  it("keeps money said with a currency, a currency unit, or a money scale", () => {
    const said = [
      money("400000", "Sorry, I meant 400k, not 350k.", null),
      money("12", "our CAC is about $12 per shop", "shop"),
      money("350000", "350,000", "USD"),
      money("2000000", "two million shillings", null),
    ];
    for (const op of said) expect(moneyAsSaid(op, op.words)).toBe(op);
  });
});
