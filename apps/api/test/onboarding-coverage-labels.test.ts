import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";

import { coverageLabelFor, groupedAmount } from "../src/onboarding-coverage.js";

/**
 * QA F-66 (24 Oct): the coverage read "Minimum cheque: 100000" and
 * "Geography: 2 selected". Money reads with its currency, grouped; a
 * taxonomy choice by its names.
 */
const view = {
  responses: [
    {
      stepKey: "I2.currency",
      value: { type: "SINGLE_SELECT", optionKey: "usd" },
    },
  ],
} as unknown as Pick<OnboardingSessionView, "responses">;
const EGYPT = "a1000000-0000-4000-8000-000000000001";
const MOROCCO = "a1000000-0000-4000-8000-000000000002";

describe("coverage labels", () => {
  it("money with its currency, grouped as text", () => {
    const label = coverageLabelFor(view, new Map());
    expect(label("I2.cheque_min", { type: "RANGE", value: "100000" })).toBe(
      "USD 100,000",
    );
    expect(groupedAmount("1500000.50")).toBe("1,500,000.50");
    expect(groupedAmount("1500000.00")).toBe("1,500,000");
    // Not a money step: the default reading.
    expect(label("I1.something", { type: "RANGE", value: "12" })).toBeNull();
  });

  it("taxonomy choices by name; an unknown id falls back to the default", () => {
    const label = coverageLabelFor(
      view,
      new Map([
        [EGYPT, "Egypt"],
        [MOROCCO, "Morocco"],
      ]),
    );
    const ref = (ids: string[]) =>
      ({
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: ids,
      }) as const;
    expect(label("I3.geography", ref([EGYPT, MOROCCO]))).toBe("Egypt, Morocco");
    expect(
      label(
        "I3.geography",
        ref([EGYPT, "a1000000-0000-4000-8000-000000000009"]),
      ),
    ).toBeNull();
  });
});
