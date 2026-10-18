import { describe, expect, it } from "vitest";

import { reapproachAfterPass, type PassStanding } from "../src/index.js";

/** Founder decision (b), doc 19 §67: only a material change reopens a pass. */
describe("re-approach after a pass", () => {
  const pass: PassStanding = {
    passedAt: "2026-10-02T10:00:00.000Z",
    mandateId: "00000000-0000-4000-8000-0000000000d1",
    mandateVersion: 3,
  };
  const nothing = {
    mandate: { mandateId: pass.mandateId ?? "", version: 3 },
    latestPitchReadyAt: null,
    latestCapitalObjectiveAt: null,
  };

  it("stays closed with nothing new, and with only old evidence: no timer", () => {
    expect(reapproachAfterPass(pass, nothing)).toBeNull();
    expect(
      reapproachAfterPass(pass, {
        ...nothing,
        latestPitchReadyAt: "2026-09-01T00:00:00.000Z",
        latestCapitalObjectiveAt: "2026-10-02T09:59:59.000Z",
      }),
    ).toBeNull();
  });

  it("reopens on a changed mandate, a new pitch or a new raise", () => {
    expect(
      reapproachAfterPass(pass, {
        ...nothing,
        mandate: { mandateId: pass.mandateId ?? "", version: 4 },
      }),
    ).toBe("MANDATE_CHANGED");
    expect(
      reapproachAfterPass(pass, {
        ...nothing,
        latestPitchReadyAt: "2026-10-03T00:00:00.000Z",
      }),
    ).toBe("MATERIAL_UPDATE");
    expect(
      reapproachAfterPass(pass, {
        ...nothing,
        latestCapitalObjectiveAt: "2026-11-01T00:00:00.000Z",
      }),
    ).toBe("NEW_CAPITAL_OBJECTIVE");
  });

  it("unknown is never a change: no recorded mandate, or none active now", () => {
    expect(
      reapproachAfterPass(
        { ...pass, mandateId: null, mandateVersion: null },
        nothing,
      ),
    ).toBeNull();
    expect(reapproachAfterPass(pass, { ...nothing, mandate: null })).toBeNull();
  });
});
