import { describe, expect, it } from "vitest";

import { settleOwnCompletion } from "../src/index.js";

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
