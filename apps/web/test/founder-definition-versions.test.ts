import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";

import { isSupportedVersion } from "../src/features/founder-onboarding/models/journey";

/**
 * Live 2026-10-01: founder definition v3 was published and every new
 * founder saw "Founder setup isn't available right now", because this
 * screen accepted v2 only. v3 is v2 plus two options; v1 stays refused.
 */
const viewAt = (definitionVersion: number) =>
  ({ session: { definitionVersion } }) as unknown as OnboardingSessionView;

describe("the founder setup screen's definition versions", () => {
  it("renders v2 and v3", () => {
    expect(isSupportedVersion(viewAt(2))).toBe(true);
    expect(isSupportedVersion(viewAt(3))).toBe(true);
  });

  it("still refuses v1 and anything it has not seen", () => {
    expect(isSupportedVersion(viewAt(1))).toBe(false);
    expect(isSupportedVersion(viewAt(4))).toBe(false);
  });
});
