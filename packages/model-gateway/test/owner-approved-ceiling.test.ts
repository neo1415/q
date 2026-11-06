import { describe, expect, it } from "vitest";

import type { ProviderRecord } from "../src/catalog.js";
import { providerJustifiedCeiling } from "../src/policy/eligibility.js";

/**
 * An owner's recorded approval (ai_ops.providers.owner_approved_ceiling,
 * 20261231280000; DECISIONS 62 for Anthropic) can raise a no-training
 * provider to CONFIDENTIAL and nothing more. It never lifts an unreviewed
 * or training-permitted provider, and never lowers a reviewed ceiling.
 */

const base: ProviderRecord = {
  id: "a1000000-0000-4000-8000-000000000004",
  code: "anthropic",
  name: "Anthropic",
  status: "ACTIVE",
  privacyPolicyClass: "NO_TRAINING_DEFAULT_RETENTION",
  supportsZeroRetention: false,
  regionSupport: [],
};

describe("providerJustifiedCeiling with an owner approval", () => {
  it("no-training without zero retention is INTERNAL until the owner approves", () => {
    expect(providerJustifiedCeiling(base)).toBe("INTERNAL");
    expect(
      providerJustifiedCeiling({ ...base, ownerApprovedCeiling: null }),
    ).toBe("INTERNAL");
    expect(
      providerJustifiedCeiling({
        ...base,
        ownerApprovedCeiling: "CONFIDENTIAL",
      }),
    ).toBe("CONFIDENTIAL");
  });

  it("never lifts an unreviewed or training-permitted provider", () => {
    for (const privacyPolicyClass of [
      "UNREVIEWED",
      "TRAINING_PERMITTED",
    ] as const) {
      expect(
        providerJustifiedCeiling({
          ...base,
          privacyPolicyClass,
          ownerApprovedCeiling: "CONFIDENTIAL",
        }),
      ).toBe("PUBLIC");
    }
  });

  it("never lowers what the review already allows", () => {
    expect(
      providerJustifiedCeiling({
        ...base,
        privacyPolicyClass: "NO_TRAINING_ZERO_RETENTION",
        supportsZeroRetention: true,
        ownerApprovedCeiling: "INTERNAL",
      }),
    ).toBe("CONFIDENTIAL");
  });
});
