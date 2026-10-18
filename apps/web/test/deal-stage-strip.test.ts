import { describe, expect, it } from "vitest";

import { dealFixture } from "../app/dev/deal-close/fixtures";
import {
  DEAL_STAGE_GUIDE,
  stripSteps,
} from "../src/features/relationships/deal-stage-strip";

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

  // Live 2026-10-11 (Savanna Seed × Ajopot): diligence started without a
  // recorded meeting, and the strip said "Met · not reached".
  it("a stage passed without its own event reads as passed, never as ahead", () => {
    const view = {
      stages: [
        { stage: "MET" as const, reachedAt: null },
        { stage: "DILIGENCE" as const, reachedAt: "2026-10-03T00:32:41.834Z" },
        { stage: "SOFT_COMMIT" as const, reachedAt: null },
        { stage: "TERMS" as const, reachedAt: null },
        { stage: "SIGNED" as const, reachedAt: null },
        { stage: "FUNDS_RECEIVED" as const, reachedAt: null },
        { stage: "CLOSED" as const, reachedAt: null },
      ],
      current: "DILIGENCE" as const,
      end: null,
    };
    const steps = stripSteps(view);
    expect(steps[0]).toMatchObject({ key: "MET", status: "skipped" });
    expect(steps[1]).toMatchObject({ key: "DILIGENCE", status: "current" });
    expect(steps[2]).toMatchObject({ key: "SOFT_COMMIT", status: "next" });
  });

  it("guides without claiming Capital Q signs or moves money", () => {
    expect(DEAL_STAGE_GUIDE.SIGNED).toContain("outside Capital Q");
    expect(DEAL_STAGE_GUIDE.FUNDS_RECEIVED).toContain("does not move money");
    expect(DEAL_STAGE_GUIDE.SOFT_COMMIT).toContain("not binding");
  });
});
