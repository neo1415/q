import { describe, expect, it } from "vitest";

import { pendingAskedStepKey } from "../src/application/view.js";

/**
 * Live 25 Oct e2e: after a reload the screen showed the cursor's step
 * ("Skip" only) under Q's "are you deploying capital now?", its chips gone.
 * A session read with no step named carries the step Q's last line asked,
 * while that line is still the question on the table.
 */

const ASKED_AT = "2026-10-25T14:15:00.000Z";

describe("the step on the table", () => {
  it("is the step Q's last line asked, when nothing moved after it", () => {
    expect(
      pendingAskedStepKey(
        { role: "Q", stepKey: "I1.deployment_status", createdAt: ASKED_AT },
        "2026-10-25T14:14:59.000Z",
      ),
    ).toBe("I1.deployment_status");
    // Said in the same instant the session last moved: still on the table.
    expect(
      pendingAskedStepKey(
        { role: "Q", stepKey: "I11.review", createdAt: ASKED_AT },
        ASKED_AT,
      ),
    ).toBe("I11.review");
  });

  it("is none once they answered, or the session moved on", () => {
    expect(
      pendingAskedStepKey(
        { role: "PERSON", stepKey: null, createdAt: ASKED_AT },
        "2026-10-25T14:14:00.000Z",
      ),
    ).toBeUndefined();
    expect(
      pendingAskedStepKey(
        { role: "Q", stepKey: "I1.deployment_status", createdAt: ASKED_AT },
        "2026-10-25T14:16:00.000Z",
      ),
    ).toBeUndefined();
  });

  it("is none when Q's line asked nothing, or there is no thread", () => {
    expect(
      pendingAskedStepKey(
        { role: "Q", stepKey: null, createdAt: ASKED_AT },
        "2026-10-25T14:14:00.000Z",
      ),
    ).toBeUndefined();
    expect(pendingAskedStepKey(undefined, ASKED_AT)).toBeUndefined();
    expect(
      pendingAskedStepKey(
        { role: "Q", stepKey: "I11.review", createdAt: "not a time" },
        ASKED_AT,
      ),
    ).toBeUndefined();
  });
});
