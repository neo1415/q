import { describe, expect, it } from "vitest";

import {
  claimKeyAccepts,
  createDeterministicClaimProposer,
  derivedSensitivity,
  derivedVisibility,
  evidenceStatusFor,
  excerptIsPresent,
  isMultiSourceSupported,
  locatorFor,
  parseLabelledValue,
  PERMITTED_CLAIM_KEYS,
  proposeDeterministically,
  reliabilityFor,
  structuredValueFor,
  truthClassFor,
  valuesAgree,
  type EvidenceSource,
} from "../src/index.js";

/**
 * The deterministic half of CQ-KNW-001: everything a proposer is not
 * allowed to decide. No model, no database, no clock — so every assertion
 * here is exact rather than approximate.
 */

const source = (overrides: Partial<EvidenceSource> = {}): EvidenceSource =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    sourceType: "DOCUMENT",
    subjectType: "COMPANY",
    subjectId: "33333333-3333-4333-8333-333333333333",
    provider: null,
    externalReference: null,
    title: "Seed deck",
    sourceUrl: null,
    createdByUserId: null,
    retrievedAt: null,
    publishedAt: null,
    reliabilityClass: null,
    visibilityScope: "founder_private",
    sensitivityClass: "CONFIDENTIAL",
    metadata: {},
    createdAt: "2026-09-07T10:00:00.000Z",
    ...overrides,
  }) as EvidenceSource;

const documentLocator = {
  kind: "document" as const,
  documentVersionId: "44444444-4444-4444-8444-444444444444",
  page: 8,
};

describe("truth class policy", () => {
  it("never returns VERIFIED, whatever the source or the proposal says", () => {
    const kinds = [
      "SOURCE_ASSERTION",
      "SOURCE_ESTIMATE",
      "MODEL_INFERENCE",
    ] as const;
    const types = [
      "DOCUMENT",
      "USER_STATEMENT",
      "CONVERSATION",
      "MEETING",
      "PLATFORM_EVENT",
      "INTEGRATION",
      "PUBLIC_WEB",
      "REGULATORY_RECORD",
      "ADMIN_VERIFICATION",
    ] as const;
    for (const sourceType of types) {
      for (const kind of kinds) {
        expect(truthClassFor(source({ sourceType }), kind)).not.toBe(
          "VERIFIED",
        );
      }
    }
  });

  it("treats a document as the subject speaking, not as verification", () => {
    // A pitch deck asserting its own ARR is the company making a claim. It
    // is a better-evidenced claim than a remark, which is the evidence
    // STATUS's job to say, on a different axis.
    expect(truthClassFor(source(), "SOURCE_ASSERTION")).toBe("USER_CLAIM");
    expect(evidenceStatusFor(source(), documentLocator)).toBe(
      "DOCUMENT_SUPPORTED",
    );
  });

  it("keeps a bare statement self-reported", () => {
    const spoken = source({ sourceType: "USER_STATEMENT" });
    expect(truthClassFor(spoken, "SOURCE_ASSERTION")).toBe("USER_CLAIM");
    expect(evidenceStatusFor(spoken, { kind: "statement" })).toBe(
      "SELF_REPORTED",
    );
  });

  it("keeps an estimate an estimate and an inference an inference", () => {
    expect(truthClassFor(source(), "SOURCE_ESTIMATE")).toBe("ESTIMATE");
    expect(truthClassFor(source(), "MODEL_INFERENCE")).toBe("Q_INFERENCE");
  });

  it("never produces a verified evidence status from an extraction", () => {
    for (const sourceType of ["DOCUMENT", "USER_STATEMENT"] as const) {
      const status = evidenceStatusFor(source({ sourceType }), documentLocator);
      expect(["EXTERNALLY_VERIFIED", "PLATFORM_VERIFIED"]).not.toContain(
        status,
      );
    }
  });

  it("does not call one source agreeing with itself multi-source support", () => {
    const one = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const two = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const version = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    // Two slides of one deck are one source saying a thing twice.
    expect(isMultiSourceSupported([one, one], [version, version])).toBe(false);
    // Two sources that resolve to the same document version are, too.
    expect(isMultiSourceSupported([one, two], [version, version])).toBe(false);
    expect(isMultiSourceSupported([one, two], [version, null])).toBe(false);
  });
});

describe("visibility and sensitivity inheritance", () => {
  it("returns the source's scope and cannot widen it", () => {
    for (const scope of [
      "founder_private",
      "investor_private",
      "organisation_private",
      "personal_private",
    ] as const) {
      expect(derivedVisibility(source({ visibilityScope: scope }))).toBe(scope);
    }
  });

  it("climbs to the strongest sensitivity and never descends", () => {
    expect(derivedSensitivity(source({ sensitivityClass: "RESTRICTED" }))).toBe(
      "RESTRICTED",
    );
    expect(
      derivedSensitivity(
        source({ sensitivityClass: "RESTRICTED" }),
        "INTERNAL",
      ),
    ).toBe("RESTRICTED");
    expect(
      derivedSensitivity(
        source({ sensitivityClass: "INTERNAL" }),
        "RESTRICTED",
      ),
    ).toBe("RESTRICTED");
    // The floor applies upward only: a PUBLIC source still yields at least
    // the caller's floor, because derived material can be more sensitive
    // than any single input.
    expect(derivedSensitivity(source({ sensitivityClass: "PUBLIC" }))).toBe(
      "CONFIDENTIAL",
    );
  });

  it("narrows a shared source to organisation-private rather than widening", () => {
    // A claim is the organisation's own record of what a source said, and
    // CQ-EVD-001 refuses to record one at a shared scope. Narrowing is the
    // only direction available.
    expect(
      derivedVisibility(source({ visibilityScope: "network_visible" })),
    ).toBe("organisation_private");
    expect(
      derivedVisibility(source({ visibilityScope: "public_external" })),
    ).toBe("organisation_private");
    expect(
      derivedVisibility(source({ visibilityScope: "relationship_shared" })),
    ).toBe("organisation_private");
  });

  it("records a model reading as model-derived, not as a score", () => {
    expect(reliabilityFor(source(), "MODEL")).toBe("MODEL_DERIVED");
    expect(reliabilityFor(source(), "DETERMINISTIC")).toBe("UNKNOWN");
    expect(
      reliabilityFor(source({ sourceType: "USER_STATEMENT" }), "MODEL"),
    ).toBe("USER_STATEMENT");
  });
});

describe("claim keys and values", () => {
  it("refuses a key outside the permitted set", () => {
    const permitted = new Set(["financial.arr"]);
    expect(claimKeyAccepts("financial.arr", null, permitted)).toBe(true);
    expect(claimKeyAccepts("financial.mrr", null, permitted)).toBe(false);
    expect(claimKeyAccepts("anything.invented", null, permitted)).toBe(false);
  });

  it("refuses a value of the wrong shape for its key", () => {
    const permitted = new Set(Object.keys(PERMITTED_CLAIM_KEYS));
    // A customer count denominated in dollars is a different claim, not a
    // formatting slip, and storing it would corrupt every later comparison.
    expect(
      claimKeyAccepts(
        "traction.customer_count",
        { kind: "MONEY", amount: 120, currency: "USD" },
        permitted,
      ),
    ).toBe(false);
    expect(
      claimKeyAccepts(
        "traction.customer_count",
        { kind: "COUNT", value: 120 },
        permitted,
      ),
    ).toBe(true);
  });

  it("keeps ARR and a raise target apart when both are two million", () => {
    const permitted = new Set(Object.keys(PERMITTED_CLAIM_KEYS));
    const twoMillion = {
      kind: "MONEY" as const,
      amount: 2_000_000,
      currency: "USD",
    };
    expect(claimKeyAccepts("financial.arr", twoMillion, permitted)).toBe(true);
    expect(claimKeyAccepts("capital.raise_target", twoMillion, permitted)).toBe(
      true,
    );
    // Same number, same currency, different facts. Identity is the key.
    expect(PERMITTED_CLAIM_KEYS["financial.arr"]?.claimType).not.toBe(
      PERMITTED_CLAIM_KEYS["capital.raise_target"]?.claimType,
    );
  });

  it("never treats different currencies as the same value", () => {
    const usd = structuredValueFor({
      kind: "MONEY",
      amount: 2_400_000,
      currency: "USD",
    });
    const gbp = structuredValueFor({
      kind: "MONEY",
      amount: 2_400_000,
      currency: "GBP",
    });
    expect(valuesAgree(usd, gbp)).toBe(false);
    expect(valuesAgree(usd, usd)).toBe(true);
  });

  it("does not treat a missing value as agreement with a present one", () => {
    const value = structuredValueFor({ kind: "COUNT", value: 0 });
    expect(valuesAgree(value, null)).toBe(false);
    expect(valuesAgree(null, null)).toBe(true);
  });
});

describe("provenance checks", () => {
  it("refuses an excerpt the passage does not contain", () => {
    const passage = "ARR reached $2.4m in the quarter to June.";
    expect(excerptIsPresent("ARR reached $2.4m", passage)).toBe(true);
    // Whitespace is forgiven because renderers reflow; invention is not.
    expect(excerptIsPresent("ARR   reached\n$2.4m", passage)).toBe(true);
    expect(excerptIsPresent("ARR reached $50m", passage)).toBe(false);
  });

  it("cannot move a claim to another document by naming one", () => {
    const narrowed = locatorFor(documentLocator, { page: 3, cell: "B7" });
    expect(narrowed).toEqual({ ...documentLocator, page: 3, cell: "B7" });
    // The document version is the server's and is not in the hint's reach.
    expect(narrowed).toHaveProperty(
      "documentVersionId",
      documentLocator.documentVersionId,
    );
  });

  it("leaves a statement locator alone", () => {
    expect(locatorFor({ kind: "statement" }, { page: 4 })).toEqual({
      kind: "statement",
    });
  });
});

describe("deterministic extraction", () => {
  it("reads a labelled money line with its own currency", () => {
    expect(parseLabelledValue("$2.4m", "MONEY")).toEqual({
      kind: "MONEY",
      amount: 2_400_000,
      currency: "USD",
    });
    expect(parseLabelledValue("£2.4m", "MONEY")).toEqual({
      kind: "MONEY",
      amount: 2_400_000,
      currency: "GBP",
    });
    expect(parseLabelledValue("₦2,400,000", "MONEY")).toEqual({
      kind: "MONEY",
      amount: 2_400_000,
      currency: "NGN",
    });
  });

  it("refuses a bare number where money was expected", () => {
    // "2.4m" is not dollars. A claim whose currency was guessed is worse
    // than a claim with no number at all.
    expect(parseLabelledValue("2.4m", "MONEY")).toBeNull();
    expect(parseLabelledValue("2400000", "MONEY")).toBeNull();
  });

  it("refuses ranges, prose and unknown units", () => {
    for (const text of ["$2-3m", "about $2.4m", "$2.4 zillion", "TBC", ""]) {
      expect(parseLabelledValue(text, "MONEY")).toBeNull();
    }
  });

  it("reads counts and percentages", () => {
    expect(parseLabelledValue("120", "COUNT")).toEqual({
      kind: "COUNT",
      value: 120,
    });
    expect(parseLabelledValue("71%", "PERCENTAGE")).toEqual({
      kind: "PERCENTAGE",
      value: 71,
    });
  });

  it("extracts labelled lines and skips everything else", () => {
    const passage = [
      "ARR: $2.4m",
      "Customers: 120",
      "Gross margin: 71%",
      "We are the leading platform in our category.",
      "Runway: as long as we need",
    ].join("\n");
    const proposals = proposeDeterministically(
      passage,
      Object.keys(PERMITTED_CLAIM_KEYS),
    );
    expect(proposals.map((p) => p.claimKey).sort()).toEqual([
      "financial.arr",
      "financial.gross_margin",
      "traction.customer_count",
    ]);
    expect(proposals.every((p) => p.assertionKind === "SOURCE_ASSERTION")).toBe(
      true,
    );
    // Marketing prose produced nothing, and the unparseable runway line
    // produced nothing rather than a guess.
    expect(proposals).toHaveLength(3);
  });

  it("never attaches a date the passage did not state", () => {
    const proposals = proposeDeterministically("ARR: $2.4m", ["financial.arr"]);
    expect(proposals[0]?.asOf).toBeNull();
  });

  it("reports permitted keys the passage does not establish", async () => {
    const proposer = createDeterministicClaimProposer();
    const batch = await proposer.propose({
      passage: {
        sourceId: "11111111-1111-4111-8111-111111111111",
        subject: {
          subjectType: "COMPANY",
          subjectId: "33333333-3333-4333-8333-333333333333",
        },
        locator: documentLocator,
        text: "ARR: $2.4m",
        description: "a deck",
      } as never,
      claimKeys: ["financial.arr", "traction.customer_count"],
      actor: {} as never,
    });
    // The customer count is absent, which is not the same as zero.
    expect(batch.absent).toEqual(["traction.customer_count"]);
    expect(batch.provenance.proposerKind).toBe("DETERMINISTIC");
    expect(batch.provenance.providerCode).toBeNull();
  });
});
