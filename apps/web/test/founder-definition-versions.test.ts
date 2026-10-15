import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding/definition";

import { isSupportedVersion } from "../src/features/founder-onboarding/models/journey";

/**
 * Live 2026-10-01: founder definition v3 was published and every new
 * founder saw "Founder setup isn't available right now", because this
 * screen accepted v2 only. v3 is v2 plus two options; v1 stays refused.
 * Live 2026-10-15: the same again for v4 (published 2026-10-07; v3 plus
 * the optional financials block), until the screen named v4.
 */
const viewAt = (definitionVersion: number) =>
  ({ session: { definitionVersion } }) as unknown as OnboardingSessionView;

describe("the founder setup screen's definition versions", () => {
  it("renders v2, v3 and v4", () => {
    expect(isSupportedVersion(viewAt(2))).toBe(true);
    expect(isSupportedVersion(viewAt(3))).toBe(true);
    expect(isSupportedVersion(viewAt(4))).toBe(true);
  });

  it("renders the version new founder sessions pin to", () => {
    expect(isSupportedVersion(viewAt(FOUNDER_DEFINITION_CURRENT.version))).toBe(
      true,
    );
  });

  it("still refuses v1 and anything it has not seen", () => {
    expect(isSupportedVersion(viewAt(1))).toBe(false);
    expect(isSupportedVersion(viewAt(5))).toBe(false);
  });
});
