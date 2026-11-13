import { describe, expect, it } from "vitest";

import { explainQualification } from "../src/index.js";

/**
 * Live 2026-10-14 (fictional Savanna Seed Partners, Maji Loop): a Climate
 * company was shown "Meets" for a preferred sector rule naming Fintech,
 * Digital Lending, Enterprise Software and Logistics, because only required
 * misses reached the applicant. Every published rule is now explained;
 * access stays the engine's.
 */
type Policy = Parameters<typeof explainQualification>[0];
type Result = Parameters<typeof explainQualification>[1];

const policy = {
  criteria: [
    { id: "c-stage", label: "Stage" },
    { id: "c-sector", label: "Sector" },
    { id: "c-cheque", label: "Cheque size" },
  ],
} as Policy;

const result = {
  access: "MAY_APPLY",
  principalMismatches: [],
  unknowns: [],
  criteria: [
    {
      criterionId: "c-stage",
      requiredness: "REQUIRED",
      status: "MATCH",
      reasonCode: "STAGE_ALLOWED",
    },
    {
      criterionId: "c-sector",
      requiredness: "PREFERRED",
      status: "NO_MATCH",
      reasonCode: "TAXONOMY_NO_OVERLAP",
    },
    {
      criterionId: "c-cheque",
      requiredness: "PREFERRED",
      status: "UNKNOWN",
      reasonCode: "RAISE_NOT_DECLARED",
    },
  ],
} as unknown as Result;

describe("explainQualification", () => {
  it("names a preferred mismatch and a preferred unknown, and keeps the engine's access", () => {
    const explained = explainQualification(policy, result);
    expect(explained.access).toBe("MAY_APPLY");
    expect(explained.unmet).toEqual(["Sector"]);
    expect(explained.stillNeeded).toEqual(["Cheque size"]);
    expect(explained.askCurrency).toBeUndefined();
  });

  // Live 2026-11-13 (Lagos Forge Fund, fictional): rules in NGN, amount in
  // USD; the form said only "needs cheque size".
  it("says which currency a size rule is set in when the amount was given in another", () => {
    const differs = {
      ...result,
      access: "NEEDS_INFORMATION",
      criteria: [
        {
          criterionId: "c-cheque",
          requiredness: "REQUIRED",
          status: "UNKNOWN",
          reasonCode: "CHEQUE_CURRENCY_DIFFERS",
          observed: "USD",
          expected: "NGN",
        },
      ],
    } as unknown as Result;
    const explained = explainQualification(policy, differs);
    expect(explained.stillNeeded).toEqual(["Cheque size"]);
    expect(explained.askCurrency).toBe("NGN");
  });
});
