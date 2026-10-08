import { describe, expect, it } from "vitest";

import { dealFixture } from "../app/dev/deal-close/fixtures";
import { stripSteps } from "../src/features/relationships/deal-stage-strip";

/**
 * The deal stage strip (2026-10-08): one current step with the accent, a
 * date for every reached stage, and a clear final state -- closed, or
 * "Not proceeding" in place of the stages not reached (never red).
 */

describe("deal stage strip", () => {
  it("marks terms current, earlier stages done, later ones next", () => {
    const steps = stripSteps(dealFixture("terms", "INVESTOR"));
    expect(steps.map((step) => [step.key, step.status])).toEqual([
      ["MET", "done"],
      ["DILIGENCE", "done"],
      ["SOFT_COMMIT", "done"],
      ["TERMS", "current"],
      ["SIGNED", "next"],
      ["FUNDS_RECEIVED", "next"],
      ["CLOSED", "next"],
    ]);
    expect(steps[0]?.date).toBe("18 Sept");
  });

  it("ends at Closed as the final state", () => {
    const steps = stripSteps(dealFixture("closed", "COMPANY"));
    expect(steps.at(-1)).toMatchObject({
      key: "CLOSED",
      status: "ended",
      date: "7 Oct",
    });
    expect(steps.filter((step) => step.status === "current")).toEqual([]);
  });

  it("a pass shows the stages reached, then Not proceeding", () => {
    const steps = stripSteps(dealFixture("passed", "INVESTOR"));
    expect(steps.map((step) => step.label)).toEqual([
      "Met",
      "Diligence",
      "Not proceeding",
    ]);
    expect(steps.at(-1)?.status).toBe("ended");
  });
});
