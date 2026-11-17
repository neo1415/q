import { describe, expect, it } from "vitest";

import { claimsChangeStatus, withoutStatusTalk } from "../src/q/action-talk.js";
import { offerRequestFor } from "../src/q/uncertainty.js";

/**
 * Replay of production conversation 9995dcca (17 Nov 2026, Zino Aviation x
 * Ajopot). The answer model said what became of Q's question card twice,
 * from inference, and contradicted itself; the records (q_runtime.actions,
 * approvals, communication.messages) showed it had lapsed unsent. Those
 * sentences are now the record's to say: the gateway replaces them with
 * the receipts' status line, and drops such findings.
 */

// Stored Q messages, word for word.
const AT_1508 =
  "Yes. The question was: “Who pays Ajopot’s 1% payout fee?” I can see it was approved and sent, but Ajopot hasn’t replied yet.";
const AT_1510 =
  "No—I didn’t send that question to Ajopot. The only message sent was your earlier three-question message on 8 November; Ajopot hasn’t replied, and the fee question was never sent.";
// Stored findings (Q_INFERENCE, NO_EVIDENCE).
const FINDING_1506 =
  "The question asking who pays Ajopot’s 1% payout fee was approved and sent.";
const FINDING_1510 =
  "Ajopot has not written in the chat, and the question about who pays the 1% payout fee was not sent.";

describe("claims about what became of Q's own change", () => {
  it("are recognised in the stored answers and findings", () => {
    expect(claimsChangeStatus(AT_1508)).toBe(true);
    expect(claimsChangeStatus(AT_1510)).toBe(true);
    expect(claimsChangeStatus(FINDING_1506)).toBe(true);
    expect(claimsChangeStatus(FINDING_1510)).toBe(true);
    expect(
      claimsChangeStatus("I didn't prepare that, so nothing changed."),
    ).toBe(true);
  });

  it("leave company facts and replies alone", () => {
    expect(claimsChangeStatus("Ajopot hasn’t replied yet.")).toBe(false);
    expect(
      claimsChangeStatus("Their term sheet was sent to investors in March."),
    ).toBe(false);
    expect(
      claimsChangeStatus(
        "Ajopot reports a 1% fee on each payout, but the records don’t establish who pays it.",
      ),
    ).toBe(false);
  });

  it("are removed from the answer, so only the record's line says it", () => {
    const stripped = withoutStatusTalk(AT_1508);
    expect(stripped.removed).toBeGreaterThan(0);
    expect(stripped.text).not.toMatch(/sent|approved/u);
    const later = withoutStatusTalk(AT_1510);
    expect(later.removed).toBe(2);
    expect(later.text).not.toMatch(/didn’t send|never sent/u);
  });
});

describe("an offer to put a question to the company carries code's question", () => {
  it("derives it from the open item, not the analyst's finding (run 9c6688a0)", () => {
    expect(
      offerRequestFor({
        tool: "send_questions_to_founder",
        request:
          "Put this question to Ajopot: The records do not establish exactly who pays Ajopot's 1% payout fee.",
        about: {
          statement:
            "The records do not establish exactly who pays Ajopot's 1% payout fee.",
          standing: "DOCUMENT_SUPPORTED",
        },
        company: "Ajopot",
      }),
    ).toBe(`Put this question to Ajopot: "Who pays Ajopot's 1% payout fee?"`);
  });

  it("leaves other vehicles' requests as offered", () => {
    expect(
      offerRequestFor({
        tool: "diligence_documents",
        request: "Ask Ajopot for the fee schedule",
        about: { statement: "x", standing: "DOCUMENT_SUPPORTED" },
        company: "Ajopot",
      }),
    ).toBe("Ask Ajopot for the fee schedule");
  });
});
