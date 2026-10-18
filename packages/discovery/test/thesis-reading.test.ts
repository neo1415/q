import { describe, expect, it } from "vitest";

import {
  readThesis,
  thesisSuggestionPatch,
  type ThesisDecision,
  type ThesisMandate,
} from "../src/index.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");

const mandate: ThesisMandate = {
  id: "44444444-4444-4444-8444-444444444444",
  version: 3,
  minStageCode: "pre_seed",
  maxStageCode: "seed",
  chequeRange: { currency: "USD", min: "100000", max: "500000" },
  constraints: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      dimension: "geography.country",
      operator: "IN",
      value: { kind: "codes", values: ["ng", "ke"] },
      importance: "MUST",
      isHardExclusion: false,
    },
  ],
  taxonomyPreferences: [],
};

const d = (
  decision: ThesisDecision["decision"],
  stageCode: string | null,
  country: string | null,
  times = 1,
): ThesisDecision[] =>
  Array.from({ length: times }, () => ({ decision, stageCode, country }));

describe("how Q reads a thesis (Q.02)", () => {
  const decisions = [
    ...d("SAVED", "seed", "GH", 3),
    ...d("SAVED", "seed", "NG", 2),
    ...d("PASSED", "pre_seed", "NG", 8),
    ...d("SAVED", "pre_seed", "NG", 1),
  ];

  it("keeps declared, observed and inferred apart; suggestions are Q's inference", () => {
    const reading = readThesis({ mandate, decisions, now: NOW });
    expect(reading.declared.find((r) => r.label === "Stage")?.value).toBe(
      "Pre-seed to Seed",
    );
    expect(reading.observed).toMatchObject({ saved: 6, passed: 8 });
    expect(reading.suggestions.map((s) => s.id)).toEqual([
      "ADD_COUNTRY:GH",
      "DROP_STAGE:pre_seed",
    ]);
    expect(
      reading.suggestions.every((s) => s.truthClass === "Q_INFERENCE"),
    ).toBe(true);
  });

  it("never suggests from thin behaviour, and never without a mandate", () => {
    const thin = readThesis({
      mandate,
      decisions: [
        ...d("SAVED", "seed", "GH"),
        ...d("PASSED", "pre_seed", "NG", 3),
      ],
      now: NOW,
    });
    expect(thin.suggestions).toEqual([]);
    const none = readThesis({ mandate: null, decisions, now: NOW });
    expect(none.declared).toEqual([]);
    expect(none.suggestions).toEqual([]);
  });

  it("never suggests a country the investor excluded", () => {
    const excluded: ThesisMandate = {
      ...mandate,
      constraints: [
        ...mandate.constraints,
        {
          id: "66666666-6666-4666-8666-666666666666",
          dimension: "geography.country",
          operator: "NOT_IN",
          value: { kind: "codes", values: ["gh"] },
          importance: "HARD_EXCLUSION",
          isHardExclusion: true,
        },
      ],
    };
    const reading = readThesis({ mandate: excluded, decisions, now: NOW });
    expect(reading.suggestions.some((s) => s.kind === "ADD_COUNTRY")).toBe(
      false,
    );
  });

  it("an approved suggestion is the ordinary mandate update at the version read", () => {
    expect(thesisSuggestionPatch(mandate, "DROP_STAGE:pre_seed", 3)).toEqual({
      expectedVersion: 3,
      minStageCode: "seed",
    });
    const added = thesisSuggestionPatch(mandate, "ADD_COUNTRY:GH", 3);
    expect(added?.constraints?.[0]?.value).toEqual({
      kind: "codes",
      values: ["ng", "ke", "gh"],
    });
    expect(added?.constraints?.[0]).not.toHaveProperty("id");
  });

  it("a suggestion that no longer applies changes nothing", () => {
    expect(thesisSuggestionPatch(mandate, "ADD_COUNTRY:NG", 3)).toBeNull();
    expect(thesisSuggestionPatch(mandate, "DROP_STAGE:seed", 3)).toBeNull();
    expect(thesisSuggestionPatch(mandate, "BOGUS:x", 3)).toBeNull();
  });
});
