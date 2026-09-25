import { describe, expect, it } from "vitest";

import { portrait } from "../src/voice/portrait.js";

/**
 * H: "What do you have on me so far?" is a synthesis of the record, not a
 * count and a field dump. Asserted on what it contains and what it must
 * never contain, not on its wording.
 */
describe("H · the portrait", () => {
  const entries = [
    { stepKey: "I0.investor_type", items: ["Angel investor"] },
    { stepKey: "I0.organisation_name", items: ["Zino Aviation"] },
    { stepKey: "I0.business_title", items: ["Founder"] },
    { stepKey: "I1.deployment_status", items: ["Actively investing"] },
    { stepKey: "I2.stages", items: ["Pre-seed"] },
    { stepKey: "I2.currency", items: ["Euro"] },
    { stepKey: "I2.cheque_min", items: ["€10,000"] },
    { stepKey: "I2.cheque_max", items: ["€50,000"] },
    { stepKey: "I5.founder_preferences", items: ["Deep domain expertise"] },
    { stepKey: "I7.avoid", items: ["Adult content"] },
  ];
  const remaining = [
    { stepKey: "I9.discovery_mode", required: true },
    { stepKey: "I10.inbound_preference", required: true },
    { stepKey: "I8.portfolio", required: false },
  ];

  it("says every recorded value, and nothing that is not recorded", () => {
    const said = portrait("investor", entries, remaining);
    for (const value of [
      "Zino Aviation",
      "Founder",
      "€10,000",
      "€50,000",
      "deep domain expertise",
      "adult content",
    ]) {
      expect(said).toContain(value);
    }
    expect(said).not.toMatch(/gambling|tobacco|series/i);
  });

  it("has no counts, no field labels and no colon-separated dump", () => {
    const said = portrait("investor", entries, remaining);
    expect(said).not.toMatch(/\d+ of \d+|to go\b|answered/i);
    expect(said).not.toMatch(
      /How do you invest|Your firm:|On your record so far/,
    );
    expect(said).not.toContain(";");
  });

  it("names what is left in words, required first", () => {
    const said = portrait("investor", entries, remaining);
    expect(said).toContain("discovery setting");
    expect(said).toContain("inbound preference");
    // Optional steps are not listed ahead of what is needed.
    expect(said).not.toContain("portfolio companies");
  });

  it("claims nothing when nothing is recorded", () => {
    const said = portrait("investor", [], remaining);
    expect(said).not.toMatch(/You invest|Right now/);
    expect(said).toContain("discovery setting");
  });
});
