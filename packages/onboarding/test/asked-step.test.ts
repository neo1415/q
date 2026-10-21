import { describe, expect, it } from "vitest";

import { openAskedStep } from "../src/application/view.js";

/**
 * Owner 2026-10-21: the options under Q's words are those of the question
 * Q asked, not the form cursor's. Only a step still open on their path.
 */
type Aggregate = Parameters<typeof openAskedStep>[0];

const step = (stepKey: string) =>
  ({ stepKey }) as unknown as Aggregate["path"]["eligible"][number];

function aggregate(statuses: Record<string, string> = {}): Aggregate {
  return {
    session: { currentStepKey: "name" },
    path: { eligible: [step("intent"), step("sectors"), step("name")] },
    states: new Map(
      Object.entries(statuses).map(([stepKey, status]) => [
        stepKey,
        { stepKey, status },
      ]),
    ),
  } as unknown as Aggregate;
}

describe("the step Q asked, shown with its options", () => {
  it("is another eligible step that is still open", () => {
    expect(openAskedStep(aggregate(), "sectors")?.stepKey).toBe("sectors");
    expect(
      openAskedStep(aggregate({ sectors: "IN_PROGRESS" }), "sectors")?.stepKey,
    ).toBe("sectors");
  });

  it("is nothing when it is the cursor's, answered, set aside, off the path or unknown", () => {
    expect(openAskedStep(aggregate(), "name")).toBeUndefined();
    expect(
      openAskedStep(aggregate({ sectors: "COMPLETED" }), "sectors"),
    ).toBeUndefined();
    expect(
      openAskedStep(aggregate({ sectors: "SKIPPED" }), "sectors"),
    ).toBeUndefined();
    expect(openAskedStep(aggregate(), "raise_amount")).toBeUndefined();
    expect(openAskedStep(aggregate(), undefined)).toBeUndefined();
  });
});
