import { describe, expect, it } from "vitest";

import {
  ErrandStartPayloadSchema,
  errandSummary,
} from "../src/composition/errands.js";

/**
 * Approval card upgrade (QA lead 2026-10-24): an errand's card names the
 * action it starts with ("Express interest in Silo Credit"), not the plan
 * ("Q looks after Silo Credit for you"); the plan is its preview's steps.
 */
const base = {
  counterpartName: "Silo Credit",
  openingMessage: null,
  brief: null,
  bookCall: null,
};

describe("an errand's card names its first action", () => {
  it("is the interest, the message, the call or the answers, in that order", () => {
    expect(
      errandSummary(
        ErrandStartPayloadSchema.parse({
          ...base,
          companyId: "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70",
          expressInterest: true,
          openingMessage: "Hello from our fund.",
        }),
      ),
    ).toBe("Express interest in Silo Credit");
    const connected = {
      ...base,
      relationshipId: "6a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      expressInterest: false,
    };
    expect(
      errandSummary(
        ErrandStartPayloadSchema.parse({
          ...connected,
          openingMessage: "Hello from our fund.",
        }),
      ),
    ).toBe("Message Silo Credit");
    expect(
      errandSummary(
        ErrandStartPayloadSchema.parse({
          ...connected,
          bookCall: { purpose: "Intro call", durationMinutes: 30 },
        }),
      ),
    ).toBe("Book a call with Silo Credit");
    expect(
      errandSummary(
        ErrandStartPayloadSchema.parse({
          ...connected,
          brief:
            "We back seed-stage lenders in East Africa with patient capital.",
        }),
      ),
    ).toBe("Answer Silo Credit's questions for you");
  });
});
