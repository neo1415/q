import { describe, expect, it } from "vitest";

import { asksChequeFit, chequeFitStatement } from "../src/q/cheque-fit-fact.js";

import { fitFixture } from "./fit-fixture.js";

/**
 * Owner QA I7 (23 Oct 2026): "Does my cheque fit Ajopot's round?" (EUR
 * cheque, NGN round) was answered "I can't confirm without an exchange
 * rate": the computed fit, with its dated FX estimate, was never read.
 */
describe("a cheque question reads the computed cheque row", () => {
  it("knows the question", () => {
    for (const asked of [
      "Does my cheque fit Ajopot's round?",
      "Is my ticket size too big for Ledgerfold?",
      "Would my check size work for this round?",
    ]) {
      expect(asksChequeFit(asked)).toBe(true);
    }
    expect(asksChequeFit("What does Ajopot do?")).toBe(false);
  });

  it("states the row, and an estimate as approximate at its dated rate", () => {
    const outcome = fitFixture(
      "91de2a77-fe47-4af0-8534-d9abf9c55949",
      "Ajopot",
      { CHEQUE_SIZE: "STRONG" },
    );
    const data = outcome.result.data as {
      profile: { parameters: Record<string, unknown>[] };
    };
    const row = data.profile.parameters.find(
      (parameter) => parameter["parameter"] === "CHEQUE_SIZE",
    );
    if (row === undefined) throw new Error("no cheque row");
    row["estimate"] = {
      method: "MARKET_RATE",
      rateDate: "2026-10-23",
      truthClass: "ESTIMATE",
    };
    const statement = chequeFitStatement("Ajopot", data) ?? "";
    expect(statement).toContain("CHEQUE FIT FOR Ajopot");
    expect(statement).toContain("STRONG");
    expect(statement).toContain("market rate of 2026-10-23");
    expect(statement).toContain("Never say an exchange rate is missing");
    expect(chequeFitStatement("Ajopot", { status: "NOT_FOUND" })).toBeNull();
  });
});
