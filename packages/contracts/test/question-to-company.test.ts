import { describe, expect, it } from "vitest";

import { questionToCompany } from "../src/index.js";

/**
 * Replay strings from production conversation 9995dcca (17 Nov 2026):
 * the uncertainty Q stated about Ajopot and the question it then put on
 * the card. What a company receives is a question addressed to it.
 */
describe("questionToCompany", () => {
  it("turns the stored findings into the open question they name", () => {
    // Card c02fa2c8's question, word for word.
    expect(
      questionToCompany(
        "The records do not establish exactly who pays Ajopot's 1% payout fee.",
      ),
    ).toBe("Who pays Ajopot's 1% payout fee?");
    // Finding 65f2e41d, the answer's own UNCERTAINTY.
    expect(
      questionToCompany(
        "Ajopot reports a 1% fee on each payout, but the available records do not establish exactly which party pays that fee.",
      ),
    ).toBe("Which party pays that fee?");
    expect(
      questionToCompany("It is unclear whether the bank partner holds funds."),
    ).toBe("Can you confirm whether the bank partner holds funds?");
  });

  it("keeps a question or an ask as written, without a list number", () => {
    // The second card's question (294f54e2), sent at 15:11:50.
    expect(questionToCompany("Who pays Ajopot’s 1% payout fee?")).toBe(
      "Who pays Ajopot’s 1% payout fee?",
    );
    expect(questionToCompany("1. What is your monthly burn?")).toBe(
      "What is your monthly burn?",
    );
    expect(questionToCompany("Please share the six-month cohort table.")).toBe(
      "Please share the six-month cohort table.",
    );
  });

  it("returns null for Q's own account of its evidence", () => {
    expect(
      questionToCompany("Ajopot's payout fee is not evidenced in the records."),
    ).toBeNull();
    expect(questionToCompany("The available evidence is thin.")).toBeNull();
    expect(questionToCompany("   ")).toBeNull();
  });
});
