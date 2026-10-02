import { describe, expect, it } from "vitest";

import {
  earliestCall,
  ErrandStartPayloadSchema,
  errandProgress,
} from "../src/composition/errands.js";

/** Live 2026-10-02 (Zino): an errand's status in plain words, from its record. */
describe("errandProgress", () => {
  const base = {
    counterpart_name: "Nixo",
    status: "ACTIVE",
    last_step: null,
  };
  it("says what Q is waiting for at each stage, and that nothing is booked until it is", () => {
    expect(errandProgress({ ...base, stage: "WAITING_CONNECTION" })).toBe(
      "Q is looking after Nixo for you: waiting for them to accept, so nothing is booked yet.",
    );
    expect(
      errandProgress({
        ...base,
        stage: "CONVERSING",
        last_step: "Q offered 3 times; waiting for Nixo to pick one.",
      }),
    ).toBe(
      "Q is looking after Nixo for you: messaging them to agree a time; nothing is booked yet. Latest: Q offered 3 times; waiting for Nixo to pick one.",
    );
    expect(errandProgress({ ...base, stage: "CALL_BOOKED" })).toBe(
      "Q is looking after Nixo for you: the call is booked.",
    );
    expect(
      errandProgress({ ...base, status: "STOPPED", stage: "CONVERSING" }),
    ).toBe("Q stopped looking after Nixo.");
  });
});

describe("the call window an errand books in (live 2026-10-02)", () => {
  const now = new Date("2026-10-02T12:40:00.000Z");
  it("never sooner than 18 hours, and never before the window they asked for", () => {
    expect(earliestCall(now, {}).toISOString()).toBe(
      "2026-10-03T06:40:00.000Z",
    );
    expect(
      earliestCall(now, {
        notBefore: "2026-10-02T12:45:00.000Z",
      }).toISOString(),
    ).toBe("2026-10-03T06:40:00.000Z");
    expect(
      earliestCall(now, {
        notBefore: "2026-10-05T09:00:00.000Z",
      }).toISOString(),
    ).toBe("2026-10-05T09:00:00.000Z");
  });

  it("the payload carries the window", () => {
    expect(
      ErrandStartPayloadSchema.parse({
        relationshipId: "a0000000-0000-4000-8000-000000000001",
        counterpartName: "Nixo",
        expressInterest: false,
        openingMessage: null,
        brief: null,
        bookCall: {
          purpose: "Meeting",
          durationMinutes: 30,
          notBefore: "2026-10-02T12:40:00.000Z",
          notAfter: "2026-10-02T12:45:00.000Z",
        },
      }).bookCall?.notAfter,
    ).toBe("2026-10-02T12:45:00.000Z");
  });
});
