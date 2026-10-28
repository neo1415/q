import { describe, expect, it } from "vitest";

import {
  WorkforceLiveSchema,
  workforceExpected,
  WORKFORCE_USUAL_MINUTES,
} from "../src/index.js";

/**
 * Owner 2026-10-28: a running job's live read says when it was accepted and
 * how long work of its kind usually takes, so the card can make a 3-minute
 * wait understood. Both are additive: an older read without them parses.
 */
const base = {
  jobId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  state: "WORKING",
  done: 1,
  total: 3,
  stage: null,
  document: null,
  reason: null,
} as const;

describe("the live read of a job (owner 2026-10-28)", () => {
  it("carries when it started and its usual length", () => {
    const parsed = WorkforceLiveSchema.parse({
      ...base,
      startedAt: "2026-10-28T14:04:40.000Z",
      expected: workforceExpected("DOCUMENT"),
    });
    expect(parsed.expected).toEqual({
      kind: "DOCUMENT",
      minMinutes: WORKFORCE_USUAL_MINUTES.DOCUMENT.min,
      maxMinutes: WORKFORCE_USUAL_MINUTES.DOCUMENT.max,
    });
    expect(WORKFORCE_USUAL_MINUTES.DOCUMENT).toEqual({ min: 2, max: 4 });
  });

  it("still reads an older payload, and a job with no usual length", () => {
    expect(WorkforceLiveSchema.safeParse(base).success).toBe(true);
    expect(
      WorkforceLiveSchema.safeParse({ ...base, expected: null }).success,
    ).toBe(true);
  });

  it("refuses a length that is not a known kind, an inverted range or a bad time", () => {
    expect(
      WorkforceLiveSchema.safeParse({
        ...base,
        expected: { kind: "MEETING", minMinutes: 1, maxMinutes: 2 },
      }).success,
    ).toBe(false);
    expect(
      WorkforceLiveSchema.safeParse({
        ...base,
        expected: { kind: "DOCUMENT", minMinutes: 5, maxMinutes: 2 },
      }).success,
    ).toBe(false);
    expect(
      WorkforceLiveSchema.safeParse({ ...base, startedAt: "yesterday" })
        .success,
    ).toBe(false);
    // Closed: nothing else rides on it (no reasoning, no agent names).
    expect(
      WorkforceLiveSchema.safeParse({ ...base, agent: "Research analyst" })
        .success,
    ).toBe(false);
  });
});
