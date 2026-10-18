import { describe, expect, it } from "vitest";

import { answeredLine, settleOwnCompletion } from "../src/index.js";

/**
 * "Who am I" reads completion from the authoritative record, not from the
 * latest session's navigation (ACC 2026-09-25: an investor whose mandate
 * was ACTIVE by the form was told "setup still in progress, 13 of 32").
 * Properties over every combination of the three facts.
 */

const STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;
const BOOLS = [false, true] as const;

const worlds = STATUSES.flatMap((latestStatus) =>
  BOOLS.flatMap((anyCompletedSession) =>
    BOOLS.map((activeMandate) => ({
      latestStatus,
      anyCompletedSession,
      activeMandate,
    })),
  ),
);

describe("own onboarding completion follows the authoritative state", () => {
  it("is complete exactly when a session completed or the mandate is live", () => {
    for (const world of worlds) {
      const settled = settleOwnCompletion(world);
      const authoritative =
        world.latestStatus === "COMPLETED" ||
        world.anyCompletedSession ||
        world.activeMandate;
      expect(settled.status === "COMPLETED", JSON.stringify(world)).toBe(
        authoritative,
      );
      expect(settled.completedBy === null, JSON.stringify(world)).toBe(
        !authoritative,
      );
    }
  });

  it("an ACTIVE mandate completes a setup whose session was never closed", () => {
    expect(
      settleOwnCompletion({
        latestStatus: "ACTIVE",
        anyCompletedSession: false,
        activeMandate: true,
      }),
    ).toEqual({ status: "COMPLETED", completedBy: "ACTIVE_MANDATE" });
  });

  it("never invents completion, and never downgrades a completed session", () => {
    for (const world of worlds) {
      const settled = settleOwnCompletion(world);
      if (!world.anyCompletedSession && !world.activeMandate) {
        expect(settled.status).toBe(world.latestStatus);
      }
      if (world.latestStatus === "COMPLETED") {
        expect(settled).toEqual({
          status: "COMPLETED",
          completedBy: "SESSION",
        });
      }
    }
  });
});

describe("answeredLine (live 2026-10-16: the raise read back as 'not recorded')", () => {
  const step = (stepKey: string, configuration: unknown) =>
    ({ stepKey, configuration }) as unknown as Parameters<
      typeof answeredLine
    >[1];

  it("carries what they answered: amount, currency and instrument", () => {
    expect(
      answeredLine(
        "How much are you raising?",
        step("F6.target_amount", {
          stepType: "range",
          prompt: "How much are you raising?",
          min: "0",
          max: "1000000000",
        }),
        { type: "RANGE", value: "750000" },
      ),
    ).toMatch(/^How much are you raising\? -> .*750/);
    expect(
      answeredLine(
        "Which instrument?",
        step("F6.instrument", {
          stepType: "single_select",
          prompt: "Which instrument?",
          options: [{ optionKey: "safe", label: "SAFE" }],
        }),
        { type: "SINGLE_SELECT", optionKey: "safe" },
      ),
    ).toBe("Which instrument? -> SAFE");
  });

  it("a confirmation is the question alone", () => {
    expect(
      answeredLine(
        "Does this look right?",
        step("F6.confirm", { stepType: "confirmation", prompt: "x" }),
        { type: "CONFIRMATION", confirmed: true },
      ),
    ).toBe("Does this look right?");
  });
});
