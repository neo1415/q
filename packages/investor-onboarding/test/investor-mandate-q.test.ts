import { describe, expect, it } from "vitest";

import { MANDATE_CONSTRAINT_DIMENSIONS } from "@capital-q/contracts";
import type { MandateStrength } from "@capital-q/q-core";

import {
  confirmedExclusionClass,
  confirmMandate,
  constraintDimensionFor,
  discoveryModeFrom,
  isColumnDimension,
  pendingExclusions,
  preferenceClassFor,
  PROTECTED_SCREENING_MESSAGE,
  proposesExclusion,
  requestsProtectedScreening,
  requiresTaxonomyMapping,
  sameMandate,
  synthesisIsCurrent,
  type MandateSynthesis,
  type ProposedConstraint,
} from "../src/index.js";

/**
 * The deterministic half of CQ-Q-022 (§80).
 *
 * Every case here is a statement Capital Q must never make about an
 * investor's mandate — that a firm tone is an exclusion, that a soft
 * negative and an eligibility rule are the same thing, that browsing
 * rewrites what someone declared, that a model may decide what a person
 * never sees. None needs a model to judge, so none is left to an eval.
 *
 * The load-bearing one is QIM-005: HARD_EXCLUSION must be unreachable from
 * anything a model produced.
 */

function synthesis(
  overrides: Partial<MandateSynthesis> = {},
): MandateSynthesis {
  return {
    constraints: [],
    taxonomy: [],
    columns: [],
    ambiguities: [],
    inferences: [],
    tensions: [],
    refused: [],
    missing: [],
    summary: "A synthetic reading.",
    blocked: null,
    computedFromRevision: 1,
    telemetry: {
      promptBundleVersion: null,
      providerCode: null,
      modelCode: null,
      constraintCount: 0,
      taxonomyPhraseCount: 0,
      mappedTaxonomyCount: 0,
      proposedExclusionCount: 0,
      ambiguityCount: 0,
      inferenceCount: 0,
      refusedCount: 0,
      latencyMs: 0,
      costUsd: 0,
    },
    ...overrides,
  };
}

function constraint(
  overrides: Partial<ProposedConstraint> = {},
): ProposedConstraint {
  return {
    dimension: "business_models",
    constraintDimension: "business.attribute",
    value: "hardware",
    quote: "we'd rather avoid hardware",
    preferenceClass: "AVOID",
    proposesExclusion: false,
    confidence: "MODERATE",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// QIM-005 · avoid is not exclusion, and no model reaches HARD_EXCLUSION
// ---------------------------------------------------------------------------

describe("QIM-005 · a hard exclusion needs a person", () => {
  it.each([
    ["EXCLUSION_CLAIMED", "AVOID"],
    ["AVOID", "AVOID"],
    ["STRONG", "STRONG"],
    ["PREFERENCE", "NICE"],
  ] as const)(
    "maps a model strength of %s to %s, never to an eligibility rule",
    (strength, expected) => {
      expect(preferenceClassFor(strength)).toBe(expected);
    },
  );

  it("has no strength at all that produces HARD_EXCLUSION", () => {
    const strengths: MandateStrength[] = [
      "EXCLUSION_CLAIMED",
      "STRONG",
      "PREFERENCE",
      "AVOID",
    ];
    for (const strength of strengths) {
      expect(preferenceClassFor(strength)).not.toBe("HARD_EXCLUSION");
    }
  });

  it("reaches HARD_EXCLUSION only through the investor's confirmation", () => {
    expect(confirmedExclusionClass({ confirmedByInvestor: true })).toBe(
      "HARD_EXCLUSION",
    );
  });

  it("keeps a proposed exclusion soft while nobody has answered it", () => {
    // Silence is not consent to make candidates disappear.
    const confirmed = confirmMandate({
      synthesis: synthesis({
        constraints: [
          constraint({ proposesExclusion: true, value: "hardware" }),
        ],
      }),
      exclusionDecisions: [],
      discoveryMode: "BALANCED",
      rawMandateText: null,
    });
    expect(confirmed.constraints[0]?.importance).toBe("AVOID");
    expect(confirmed.constraints[0]?.isHardExclusion).toBe(false);
  });

  it("makes it a hard exclusion once the investor confirms it", () => {
    const confirmed = confirmMandate({
      synthesis: synthesis({
        constraints: [
          constraint({ proposesExclusion: true, value: "hardware" }),
        ],
      }),
      exclusionDecisions: [
        { dimension: "business_models", value: "hardware", confirmed: true },
      ],
      discoveryMode: "BALANCED",
      rawMandateText: null,
    });
    expect(confirmed.constraints[0]?.importance).toBe("HARD_EXCLUSION");
    // The two representations can never disagree — the DB has a CHECK for
    // this and so does the mapper.
    expect(confirmed.constraints[0]?.isHardExclusion).toBe(true);
  });

  it("falls back to a soft negative when the investor declines it", () => {
    const confirmed = confirmMandate({
      synthesis: synthesis({
        constraints: [
          constraint({ proposesExclusion: true, value: "hardware" }),
        ],
      }),
      exclusionDecisions: [
        {
          dimension: "business_models",
          value: "hardware",
          confirmed: false,
          fallback: "AVOID",
        },
      ],
      discoveryMode: null,
      rawMandateText: null,
    });
    expect(confirmed.constraints[0]?.importance).toBe("AVOID");
  });

  it("drops it entirely when the investor says it was wrong", () => {
    const confirmed = confirmMandate({
      synthesis: synthesis({
        constraints: [
          constraint({ proposesExclusion: true, value: "hardware" }),
        ],
      }),
      exclusionDecisions: [
        {
          dimension: "business_models",
          value: "hardware",
          confirmed: false,
          fallback: "DROP",
        },
      ],
      discoveryMode: null,
      rawMandateText: null,
    });
    expect(confirmed.constraints).toHaveLength(0);
  });

  it("lists every exclusion awaiting an answer, so the screen can ask", () => {
    const pending = pendingExclusions(
      synthesis({
        constraints: [
          constraint({ proposesExclusion: true, value: "hardware" }),
          constraint({ proposesExclusion: false, value: "marketplaces" }),
        ],
        taxonomy: [
          {
            phrase: "consumer social",
            preferenceClass: "AVOID",
            proposesExclusion: true,
            nodeIds: ["11111111-1111-4111-8111-111111111111"],
          },
        ],
      }),
    );
    expect(pending.map((p) => p.value)).toEqual([
      "hardware",
      "consumer social",
    ]);
  });
});

// ---------------------------------------------------------------------------
// QIM-003 · taxonomy uses canonical ids, never a phrase
// ---------------------------------------------------------------------------

describe("QIM-003 · sector language becomes canonical ids or nothing", () => {
  it("files a resolved phrase under its node ids", () => {
    const confirmed = confirmMandate({
      synthesis: synthesis({
        taxonomy: [
          {
            phrase: "payments infrastructure",
            preferenceClass: "STRONG",
            proposesExclusion: false,
            nodeIds: [
              "11111111-1111-4111-8111-111111111111",
              "22222222-2222-4222-8222-222222222222",
            ],
          },
        ],
      }),
      exclusionDecisions: [],
      discoveryMode: null,
      rawMandateText: null,
    });
    expect(confirmed.constraints).toHaveLength(2);
    expect(confirmed.constraints[0]?.dimension).toBe("sector");
    expect(confirmed.constraints[0]?.value).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("files nothing for a phrase Capital Q could not resolve", () => {
    // A free string would never match a company's node ids, so filing it
    // would look like a criterion while matching nothing.
    const confirmed = confirmMandate({
      synthesis: synthesis({
        taxonomy: [
          {
            phrase: "vibes-based commerce",
            preferenceClass: "STRONG",
            proposesExclusion: false,
            nodeIds: [],
          },
        ],
      }),
      exclusionDecisions: [],
      discoveryMode: null,
      rawMandateText: "we like vibes-based commerce",
    });
    expect(confirmed.constraints).toHaveLength(0);
    // It survives where a person will read it.
    expect(confirmed.rawMandateText).toContain("vibes-based commerce");
  });

  it("knows which dimensions need canonical mapping", () => {
    expect(requiresTaxonomyMapping("sectors")).toBe(true);
    expect(requiresTaxonomyMapping("sectors_avoid")).toBe(true);
    expect(requiresTaxonomyMapping("stages")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QIM-015 · protected characteristics are refused, never encoded
// ---------------------------------------------------------------------------

describe("QIM-015 · Capital Q will not screen on a protected characteristic", () => {
  it.each([
    "Only white founders please.",
    "We prefer male founders.",
    "No muslim founders.",
    "Founders must be under 30 years old.",
    "Never invest in female founders.",
  ])("recognises %s as a request Capital Q refuses", (text) => {
    expect(requestsProtectedScreening(text)).toBe(true);
  });

  it.each([
    "We back technical founders with enterprise sales experience.",
    "We like repeat founders and deep industry expertise.",
    "We invest in B2B software across Africa.",
    "We back female founders through our diversity fund.",
  ])("leaves a legitimate criterion alone: %s", (text) => {
    // A filter that flagged the noun alone would be both wrong and
    // insulting. It matches requests to screen BY a characteristic.
    expect(requestsProtectedScreening(text)).toBe(false);
  });

  it("says what it does rather than accusing anyone", () => {
    expect(PROTECTED_SCREENING_MESSAGE).toContain("business and experience");
    expect(PROTECTED_SCREENING_MESSAGE.toLowerCase()).not.toContain(
      "discriminat",
    );
    expect(PROTECTED_SCREENING_MESSAGE.toLowerCase()).not.toContain("illegal");
  });

  it("has no canonical dimension a protected criterion could occupy", () => {
    // The real defence is the allowlist itself: a closed set of
    // investment-relevant dimensions with nothing about a person's
    // identity in it. Asserted whole rather than by substring, because a
    // substring test would happily let "gender" through while tripping on
    // "stage".
    expect([...MANDATE_CONSTRAINT_DIMENSIONS].sort()).toEqual(
      [
        "business.attribute",
        "cheque.typical",
        "custom.text",
        "founder.business_attribute",
        "geography.country",
        "green_flag",
        "investment_role",
        "red_flag",
        "sector",
        "stage",
      ].sort(),
    );
    // And everything Q can synthesise lands inside that set.
    for (const dimension of [
      "stages",
      "geography",
      "sectors",
      "business_models",
      "founder_preferences",
      "green_flags",
    ] as const) {
      const mapped = constraintDimensionFor(dimension);
      expect(mapped).not.toBeNull();
      expect(MANDATE_CONSTRAINT_DIMENSIONS).toContain(mapped);
    }
  });
});

// ---------------------------------------------------------------------------
// QIM-011 / QIM-012 · what may never rewrite a declared mandate
// ---------------------------------------------------------------------------

describe("QIM-011 · inference and observation stay out of the mandate", () => {
  it("writes nothing from an inference, however confident", () => {
    const confirmed = confirmMandate({
      synthesis: synthesis({
        inferences: [
          {
            dimension: "sectors",
            value: "logistics",
            basis: "opened many logistics profiles",
            confidence: "HIGH",
          },
        ],
        tensions: ["Declared fintech; observed logistics interest."],
      }),
      exclusionDecisions: [],
      discoveryMode: null,
      rawMandateText: null,
    });
    // The declared mandate is unchanged by what Q noticed.
    expect(confirmed.constraints).toHaveLength(0);
  });

  it("keeps the discovery mode the investor chose, never one derived from constraints", () => {
    const confirmed = confirmMandate({
      synthesis: synthesis({
        constraints: [
          constraint({ proposesExclusion: true, value: "hardware" }),
          constraint({ proposesExclusion: true, value: "crypto" }),
        ],
      }),
      exclusionDecisions: [],
      // A mandate full of exclusions is not automatically STRICT.
      discoveryMode: "EXPLORATORY",
      rawMandateText: null,
    });
    expect(confirmed.discoveryMode).toBe("EXPLORATORY");
  });

  it("reads a discovery mode only from the locked vocabulary", () => {
    expect(discoveryModeFrom("balanced")).toBe("BALANCED");
    expect(discoveryModeFrom("STRICT")).toBe("STRICT");
    expect(discoveryModeFrom("aggressive")).toBeNull();
    expect(discoveryModeFrom(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// QIM-017 / QIM-018 · staleness and idempotency
// ---------------------------------------------------------------------------

describe("QIM-017 · a stale synthesis cannot overwrite newer choices", () => {
  it("is current only for the revision it was computed from", () => {
    expect(synthesisIsCurrent(synthesis({ computedFromRevision: 4 }), 4)).toBe(
      true,
    );
    expect(synthesisIsCurrent(synthesis({ computedFromRevision: 3 }), 4)).toBe(
      false,
    );
  });
});

describe("QIM-018 · confirming twice is the same mandate", () => {
  const build = () =>
    confirmMandate({
      synthesis: synthesis({
        constraints: [
          constraint({ value: "b2b", preferenceClass: "STRONG" }),
          constraint({ value: "hardware", proposesExclusion: true }),
        ],
      }),
      exclusionDecisions: [
        { dimension: "business_models", value: "hardware", confirmed: true },
      ],
      discoveryMode: "BALANCED",
      rawMandateText: "thesis",
    });

  it("produces an identical mandate for an identical confirmation", () => {
    expect(sameMandate(build(), build())).toBe(true);
  });

  it("notices a real change", () => {
    const edited = confirmMandate({
      synthesis: synthesis({
        constraints: [constraint({ value: "b2b", preferenceClass: "STRONG" })],
      }),
      exclusionDecisions: [],
      discoveryMode: "BALANCED",
      rawMandateText: "thesis",
    });
    expect(sameMandate(build(), edited)).toBe(false);
  });

  it("notices a discovery-mode change", () => {
    const edited = confirmMandate({
      synthesis: synthesis(),
      exclusionDecisions: [],
      discoveryMode: "STRICT",
      rawMandateText: null,
    });
    const original = confirmMandate({
      synthesis: synthesis(),
      exclusionDecisions: [],
      discoveryMode: "BALANCED",
      rawMandateText: null,
    });
    expect(sameMandate(original, edited)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QIM-002 / QIM-008 · columns are not constraints
// ---------------------------------------------------------------------------

describe("QIM-002 · cheque, currency and mode are columns, not constraint rows", () => {
  it.each([
    "cheque_min",
    "cheque_typical",
    "cheque_max",
    "currency",
    "discovery_mode",
    "inbound_preference",
  ] as const)("treats %s as a mandate column", (dimension) => {
    expect(isColumnDimension(dimension)).toBe(true);
  });

  it.each(["stages", "sectors", "green_flags"] as const)(
    "treats %s as a constraint dimension",
    (dimension) => {
      expect(isColumnDimension(dimension)).toBe(false);
      expect(constraintDimensionFor(dimension)).not.toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// QIM-004 · edits remove what the investor removed
// ---------------------------------------------------------------------------

describe("QIM-004 · the investor's edit is respected", () => {
  it("keeps only what they accepted", () => {
    const confirmed = confirmMandate({
      synthesis: synthesis({
        constraints: [
          constraint({ value: "b2b" }),
          constraint({ value: "marketplaces" }),
        ],
      }),
      exclusionDecisions: [],
      acceptedValues: new Set(["b2b"]),
      discoveryMode: null,
      rawMandateText: null,
    });
    expect(confirmed.constraints.map((c) => c.value)).toEqual(["b2b"]);
  });

  it("keeps everything when they did not edit", () => {
    const confirmed = confirmMandate({
      synthesis: synthesis({
        constraints: [
          constraint({ value: "b2b" }),
          constraint({ value: "marketplaces" }),
        ],
      }),
      exclusionDecisions: [],
      discoveryMode: null,
      rawMandateText: null,
    });
    expect(confirmed.constraints).toHaveLength(2);
  });
});

describe("QIM-006 · a proposal marked as an exclusion is still just a proposal", () => {
  it("reports which readings ask to exclude", () => {
    expect(proposesExclusion("EXCLUSION_CLAIMED")).toBe(true);
    expect(proposesExclusion("AVOID")).toBe(false);
    expect(proposesExclusion("STRONG")).toBe(false);
    expect(proposesExclusion("PREFERENCE")).toBe(false);
  });
});
