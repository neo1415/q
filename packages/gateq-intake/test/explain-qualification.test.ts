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
    { criterionId: "c-stage", requiredness: "REQUIRED", status: "MATCH" },
    { criterionId: "c-sector", requiredness: "PREFERRED", status: "NO_MATCH" },
    { criterionId: "c-cheque", requiredness: "PREFERRED", status: "UNKNOWN" },
  ],
} as unknown as Result;

describe("explainQualification", () => {
  it("names a preferred mismatch and a preferred unknown, and keeps the engine's access", () => {
    const explained = explainQualification(policy, result);
    expect(explained.access).toBe("MAY_APPLY");
    expect(explained.unmet).toEqual(["Sector"]);
    expect(explained.stillNeeded).toEqual(["Cheque size"]);
  });
});
