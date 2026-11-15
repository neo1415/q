import { describe, expect, it } from "vitest";

import {
  stageLimitNote,
  stageLimitOf,
  stageRestatements,
} from "../src/q/uncertainty.js";

/**
 * D11 (live 15 Nov 2026, run 396ebc21): "How solid is Kazikit's revenue?
 * Can you get their accounts?" at INTEREST_EXPRESSED said the stage twice:
 * "Your interest is still awaiting Kazikit's acceptance, ... so I can't
 * obtain the accounts at this point." and code's closing line.
 */
describe("D11: the stage limit is said once, by code", () => {
  const kazikit = {
    yourSide: "INVESTOR" as const,
    state: "INTEREST_EXPRESSED",
    milestones: [{ state: "INTEREST_EXPRESSED" }],
  };
  const stage = "Your interest in Kazikit is waiting for them to accept";

  it("is known from the stage alone, before the answer is written", () => {
    expect(stageLimitOf(kazikit, "Kazikit")).toEqual({
      line: "Your interest in Kazikit is waiting for them to accept; once they do, you can send them questions or ask for documents through Capital Q.",
      stage,
    });
    // Connected: a route is open, so there is no stage limit to say.
    expect(
      stageLimitOf({ ...kazikit, state: "CONNECTED" }, "Kazikit"),
    ).toBeNull();
    // The founder's side never hears the investor's stage line.
    expect(
      stageLimitOf({ ...kazikit, yourSide: "COMPANY" }, "Kazikit"),
    ).toBeNull();
    expect(stageLimitNote("Line.")).toContain('word for word: "Line."');
  });

  it("drops the answer's own restatement of that stage, never its analysis", () => {
    const restated =
      "Your interest is still awaiting Kazikit's acceptance, and no diligence exchange is recorded, so I can't obtain the accounts at this point.";
    const answer = `Kazikit's revenue is not solidly evidenced. Kazikit has shared no documents and has answered no questions about revenue. ${restated}`;
    expect(stageRestatements(answer, stage, "Kazikit")).toEqual([restated]);
    expect(
      stageRestatements(
        "Diligence has not begun because Kazikit has not yet accepted your interest.",
        stage,
        "Kazikit",
      ),
    ).toHaveLength(1);
    expect(
      stageRestatements(
        "Kazikit's revenue is self-reported.",
        stage,
        "Kazikit",
      ),
    ).toEqual([]);
  });
});
