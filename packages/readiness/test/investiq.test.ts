import { describe, expect, it } from "vitest";

import {
  assessInvestIQ,
  compareShadowWithLegacy,
  CORE_DIMENSIONS,
  FDN_DIMENSIONS,
  INVESTIQ_SHADOW_METHOD_V0,
  InvestIQInputError,
  investiqInputFromLegacyReadiness,
  type InvestIQAssessment,
  type InvestIQInput,
  type InvestIQObservation,
} from "../src/index.js";

/*
 * The FDN InvestIQ brief (Oct 2026) contains no worked examples, weights or
 * bands, so every case here is synthetic and exercises one stated rule.
 */

const AS_OF = "2026-10-15T00:00:00.000Z";

function input(
  observations: InvestIQObservation[],
  stageCode: string | null = "seed",
): InvestIQInput {
  return {
    companyRef: "company-synthetic-1",
    asOf: AS_OF,
    context: {
      stageCode,
      sectorCodes: [],
      businessModel: null,
      instrument: null,
    },
    observations,
  };
}

let n = 0;
function obs(
  criterion: string,
  over: Partial<InvestIQObservation> = {},
): InvestIQObservation {
  n += 1;
  return {
    id: `o${String(n).padStart(3, "0")}`,
    criterion,
    reading: "RECORDED",
    statement: `statement for ${criterion}`,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    lifecycleStatus: "CURRENT",
    provenance: { sourceKind: "CLAIM", sourceRef: null, observedAt: null },
    ...over,
  };
}

function criterion(a: InvestIQAssessment, key: string) {
  for (const d of a.dimensions) {
    const c = d.criteria.find((x) => x.criterion === key);
    if (c !== undefined) return c;
  }
  throw new Error(`no criterion ${key}`);
}

function dim(a: InvestIQAssessment, code: (typeof CORE_DIMENSIONS)[number]) {
  const d = a.dimensions.find((x) => x.dimension === code);
  if (d === undefined) throw new Error(code);
  return d;
}

/** Every numeric leaf in the output, with its path. */
function numericLeaves(value: unknown, path = ""): string[] {
  if (typeof value === "number") return [path];
  if (Array.isArray(value))
    return value.flatMap((v, i) => numericLeaves(v, `${path}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      numericLeaves(v, `${path}.${k}`),
    );
  }
  return [];
}

describe("InvestIQ shadow v0: no false precision", () => {
  it("emits no score, weight, percentage or composite; only counts and trace order are numbers", () => {
    const a = assessInvestIQ(
      input([
        obs("cp.traction", {
          reading: "SUPPORTS_STRENGTH",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ]),
    );
    const leaves = numericLeaves(a);
    expect(leaves.length).toBeGreaterThan(0);
    for (const p of leaves) {
      expect(p).toMatch(
        /\.(counts\.[a-zA-Z]+|applicableCriteria|observedCriteria|staleObservations|seq)$/,
      );
    }
    expect(JSON.stringify(a)).not.toMatch(
      /"(score|weight|percent|probability|composite)"/i,
    );
    for (const d of a.dimensions) {
      expect(d.grade).toBeNull();
      expect(d.confidence.level).toBeNull();
    }
    expect(a.businessQuality.headline).toBeNull();
    expect(a.investmentReadiness.headline).toBeNull();
    expect(a.intelligenceConfidence.level).toBeNull();
    expect(a.finalisation.status).toBe("PROVISIONAL");
    expect(a.finalisation.reasons[0]).toBe("METHOD_NOT_APPROVED");
  });
});

describe("unknown stays unknown", () => {
  it("an empty company is UNKNOWN everywhere, never weak", () => {
    const a = assessInvestIQ(input([]));
    for (const d of a.dimensions) {
      expect(d.subscore.counts.weaknessEvidenced).toBe(0);
      expect(d.subscore.observedCriteria).toBe(0);
      expect(d.necessaryConditionMet).toBe(false);
    }
    expect(criterion(a, "fh.cash_flow").state).toBe("UNKNOWN");
  });

  it("a 'not disclosed' statement (truth UNKNOWN) is a known gap, not evidence", () => {
    const a = assessInvestIQ(
      input([
        obs("fh.capital_efficiency", {
          truthClass: "UNKNOWN",
          evidenceStatus: "NO_EVIDENCE",
          statement: "CAC not disclosed",
        }),
      ]),
    );
    const c = criterion(a, "fh.capital_efficiency");
    expect(c.state).toBe("UNKNOWN");
    expect(c.knownUnknowns).toEqual(["CAC not disclosed"]);
    expect(c.excluded[0]?.reason).toBe("TRUTH_UNKNOWN");
  });

  it("superseded observations and evidence-free Q inference are excluded", () => {
    const a = assessInvestIQ(
      input([
        obs("cp.retention", {
          lifecycleStatus: "SUPERSEDED",
          reading: "INDICATES_WEAKNESS",
        }),
        obs("mo.market_size", {
          truthClass: "Q_INFERENCE",
          evidenceStatus: "NO_EVIDENCE",
          reading: "SUPPORTS_STRENGTH",
        }),
        obs("mo.scalability", {
          truthClass: "Q_INFERENCE",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ]),
    );
    expect(criterion(a, "cp.retention").state).toBe("UNKNOWN");
    expect(criterion(a, "cp.retention").excluded[0]?.reason).toBe("SUPERSEDED");
    expect(criterion(a, "mo.market_size").state).toBe("UNKNOWN");
    expect(criterion(a, "mo.market_size").excluded[0]?.reason).toBe(
      "INFERENCE_WITHOUT_EVIDENCE",
    );
    expect(criterion(a, "mo.scalability").state).toBe("RECORDED");
  });
});

describe("applicability is contextual: NOT_APPLICABLE is not UNKNOWN", () => {
  it("pre-seed with no retention evidence: NOT_APPLICABLE by a versioned rule", () => {
    const a = assessInvestIQ(input([], "pre_seed"));
    const c = criterion(a, "cp.retention");
    expect(c.state).toBe("NOT_APPLICABLE");
    expect(c.applicabilityRule).toBe("na.early-stage-retention-profitability");
    expect(dim(a, "COMMERCIAL_PERFORMANCE").subscore.applicableCriteria).toBe(
      dim(a, "COMMERCIAL_PERFORMANCE").criteria.length - 1,
    );
  });

  it("unknown stage never grants N/A; seed does not either", () => {
    expect(
      criterion(assessInvestIQ(input([], null)), "cp.retention").state,
    ).toBe("UNKNOWN");
    expect(
      criterion(assessInvestIQ(input([], "seed")), "cp.retention").state,
    ).toBe("UNKNOWN");
  });

  it("evidence on record is assessed even where the rule would say N/A", () => {
    const a = assessInvestIQ(
      input(
        [obs("cp.retention", { reading: "SUPPORTS_STRENGTH" })],
        "pre_seed",
      ),
    );
    expect(criterion(a, "cp.retention").state).toBe("STRENGTH_INDICATED");
  });
});

describe("contradictions are investigated, not penalised", () => {
  it("a CONTRADICTORY observation makes the criterion CONFLICTED and blocks finalisation", () => {
    const a = assessInvestIQ(
      input([
        obs("cp.revenue_quality", {
          reading: "SUPPORTS_STRENGTH",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
        obs("cp.revenue_quality", { lifecycleStatus: "CONTRADICTORY" }),
      ]),
    );
    expect(criterion(a, "cp.revenue_quality").state).toBe("CONFLICTED");
    const p = dim(a, "COMMERCIAL_PERFORMANCE").subscore;
    expect(p.hasUnresolvedConflict).toBe(true);
    expect(p.counts.weaknessEvidenced).toBe(0);
    expect(a.finalisation.reasons).toContain(
      "UNRESOLVED_CONFLICT:cp.revenue_quality",
    );
  });

  it("strength and weakness on one criterion coexist as CONFLICTED; neither is picked", () => {
    const a = assessInvestIQ(
      input([
        obs("fh.cash_flow", { reading: "SUPPORTS_STRENGTH" }),
        obs("fh.cash_flow", {
          reading: "INDICATES_WEAKNESS",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ]),
    );
    expect(criterion(a, "fh.cash_flow").state).toBe("CONFLICTED");
    expect(criterion(a, "fh.cash_flow").observationIds).toHaveLength(2);
  });
});

describe("dimensions and outputs stay separate", () => {
  it("weak governance does not change commercial strength (no hidden blend)", () => {
    const strongCommercial = [
      obs("cp.traction", {
        reading: "SUPPORTS_STRENGTH",
        evidenceStatus: "DOCUMENT_SUPPORTED",
      }),
    ];
    const a = assessInvestIQ(input(strongCommercial));
    const b = assessInvestIQ(
      input([
        ...strongCommercial,
        obs("gir.board", {
          reading: "INDICATES_WEAKNESS",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ]),
    );
    expect(dim(b, "COMMERCIAL_PERFORMANCE")).toEqual(
      dim(a, "COMMERCIAL_PERFORMANCE"),
    );
    expect(
      dim(b, "GOVERNANCE_AND_INSTITUTIONAL_READINESS").subscore
        .hasEvidencedWeakness,
    ).toBe(true);
  });

  it("Business Quality and Investment Readiness name disjoint dimensions; fit is not computed", () => {
    const a = assessInvestIQ(input([]));
    const bq = new Set(a.businessQuality.dimensions);
    expect(a.investmentReadiness.dimensions.some((d) => bq.has(d))).toBe(false);
    expect(
      [
        ...a.businessQuality.dimensions,
        ...a.investmentReadiness.dimensions,
      ].sort(),
    ).toEqual([...CORE_DIMENSIONS].sort());
    expect(a.notComputedHere).toEqual(
      expect.arrayContaining([
        "INVESTOR_FIT",
        "INTEREST",
        "MATCH",
        "RELATIONSHIP_STATE",
        "OUTCOME",
      ]),
    );
  });

  it("the FDN nine are a lens: Investor Fit routes to discovery fit, the rest map to criteria", () => {
    const a = assessInvestIQ(input([]));
    expect(a.fdnLens.map((l) => l.fdn)).toEqual([...FDN_DIMENSIONS]);
    for (const l of a.fdnLens) {
      if (l.fdn === "INVESTOR_FIT") {
        expect(l.routedTo).toBe("DISCOVERY_FIT");
        expect(l.criteria).toEqual([]);
      } else {
        expect(l.routedTo).toBe("THIS_ASSESSMENT");
        expect(l.criteria.length).toBeGreaterThan(0);
      }
    }
  });

  it("a weakness needs an affirmative observation; strongest evidence and staleness are reported", () => {
    const a = assessInvestIQ(
      input([
        obs("fh.debt", {
          reading: "INDICATES_WEAKNESS",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
        obs("fl.founder_quality", {
          reading: "SUPPORTS_STRENGTH",
          evidenceStatus: "EXTERNALLY_VERIFIED",
        }),
        obs("fl.founder_quality", { lifecycleStatus: "STALE" }),
      ]),
    );
    expect(criterion(a, "fh.debt").state).toBe("WEAKNESS_EVIDENCED");
    const f = criterion(a, "fl.founder_quality");
    expect(f.state).toBe("STRENGTH_INDICATED");
    expect(f.strongestEvidenceStatus).toBe("EXTERNALLY_VERIFIED");
    expect(f.staleObservations).toBe(1);
    expect(
      dim(a, "FOUNDER_AND_LEADERSHIP").subscore.highestEvidenceStatus,
    ).toBe("EXTERNALLY_VERIFIED");
  });
});

describe("deterministic, versioned, validated", () => {
  it("observation order changes neither the result nor the hash", () => {
    const list = [
      obs("cp.traction"),
      obs("fh.debt"),
      obs("mo.market_size", { reading: "SUPPORTS_STRENGTH" }),
    ];
    const a = assessInvestIQ(input(list));
    const b = assessInvestIQ(input([...list].reverse()));
    expect(b).toEqual(a);
    expect(a.method.version).toBe("investiq-shadow/v0");
    expect(a.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a changed observation changes the hash", () => {
    const base = obs("cp.traction");
    const a = assessInvestIQ(input([base]));
    const b = assessInvestIQ(
      input([{ ...base, evidenceStatus: "DOCUMENT_SUPPORTED" }]),
    );
    expect(b.inputHash).not.toBe(a.inputHash);
  });

  it("rejects unknown criteria, duplicate ids, future observations and malformed input", () => {
    expect(() => assessInvestIQ(input([obs("xx.not_a_criterion")]))).toThrow(
      InvestIQInputError,
    );
    const dup = obs("cp.traction");
    expect(() => assessInvestIQ(input([dup, dup]))).toThrow(/duplicate/);
    expect(() =>
      assessInvestIQ(
        input([
          obs("cp.traction", {
            provenance: {
              sourceKind: "CLAIM",
              sourceRef: null,
              observedAt: "2027-01-01T00:00:00Z",
            },
          }),
        ]),
      ),
    ).toThrow(/after asOf/);
    expect(() => assessInvestIQ({ companyRef: "x" })).toThrow(
      InvestIQInputError,
    );
  });

  it("every method rule carries provenance; placeholders are counted so changes are deliberate", () => {
    const m = INVESTIQ_SHADOW_METHOD_V0;
    const keys = new Set(m.criteria.map((c) => c.key));
    expect(keys.size).toBe(m.criteria.length);
    for (const r of m.applicability)
      for (const k of r.criteria) expect(keys.has(k)).toBe(true);
    const placeholders = [
      ...m.criteria.map((c) => c.provenance),
      ...m.applicability.map((r) => r.provenance),
    ].filter((p) => p.kind === "PROPOSED_PLACEHOLDER");
    expect(placeholders).toHaveLength(1);
  });
});

describe("shadow adapter over a stored readiness-rules/v1 assessment", () => {
  const stored = {
    rulesVersion: "readiness-rules/v1",
    stageCode: "seed",
    uncertainty: [],
    pillars: [
      {
        pillar: "FOUNDER",
        status: "STRONG",
        evidence: [
          {
            label: "1 founder, 1 full-time",
            source: "PROFILE",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            note: null,
            ref: null,
          },
          {
            label: "1 founder identity",
            source: "VERIFICATION",
            truthClass: "VERIFIED",
            evidenceStatus: "PLATFORM_VERIFIED",
            note: null,
            ref: null,
          },
        ],
      },
      {
        pillar: "MARKET_OPPORTUNITY",
        status: "DEVELOPING",
        evidence: [
          {
            label: "2 categories",
            source: "PROFILE",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            note: null,
            ref: null,
          },
        ],
      },
      {
        pillar: "COMMERCIAL_VALIDATION",
        status: "DEVELOPING",
        evidence: [
          {
            label: "Monthly revenue of about USD 9000",
            source: "CLAIM",
            truthClass: "USER_CLAIM",
            evidenceStatus: "DOCUMENT_SUPPORTED",
            note: null,
            ref: null,
          },
        ],
      },
      {
        pillar: "BUSINESS_ECONOMICS",
        status: "UNKNOWN",
        evidence: [
          {
            label: "Gross margin has not been disclosed.",
            source: "CLAIM",
            truthClass: "UNKNOWN",
            evidenceStatus: "NO_EVIDENCE",
            note: null,
            ref: null,
          },
        ],
      },
      {
        pillar: "INVESTMENT_READINESS",
        status: "GAP",
        evidence: [
          {
            label: "Target 5000000 USD",
            source: "RAISE",
            truthClass: null,
            evidenceStatus: null,
            note: null,
            ref: null,
          },
        ],
      },
    ],
    blockers: [
      {
        id: "traction.revenue",
        kind: "CONTRADICTED",
        pillar: "COMMERCIAL_VALIDATION",
      },
      { id: "raise.deck", kind: "MISSING", pillar: "INVESTMENT_READINESS" },
    ],
  };

  const shadow = investiqInputFromLegacyReadiness(stored, {
    companyRef: "row-1",
    asOf: AS_OF,
  });
  const result = assessInvestIQ(shadow.input);
  const diff = new Map(
    compareShadowWithLegacy(shadow, result).map((c) => [c.dimension, c]),
  );

  it("excludes verification and taxonomy lines, keeps known unknowns as gaps", () => {
    expect(shadow.excluded.map((e) => e.reason).sort()).toEqual([
      "CONTEXT_NOT_EVIDENCE",
      "VERIFICATION_WORKFLOW",
    ]);
    expect(criterion(result, "fh.profitability").knownUnknowns).toHaveLength(1);
    expect(criterion(result, "fh.profitability").state).toBe("UNKNOWN");
  });

  it("maps a CONTRADICTED blocker to CONFLICTED and a MISSING blocker to nothing", () => {
    expect(criterion(result, "cp.revenue_quality").state).toBe("CONFLICTED");
    expect(
      shadow.input.observations.some((o) => o.statement.includes("raise.deck")),
    ).toBe(false);
  });

  it("records every assumption it made about lines without axes", () => {
    expect(shadow.assumptions.join("\n")).toMatch(
      /RAISE line without truth class/,
    );
  });

  it("reports the differences against v1", () => {
    expect(diff.get("FOUNDER_AND_LEADERSHIP")?.differences).toEqual([
      "LEGACY_STRONG_SELF_REPORTED",
      "LEGACY_STRONG_ON_PRESENCE",
    ]);
    expect(diff.get("MARKET_OPPORTUNITY")?.differences).toEqual([
      "LEGACY_KNOWN_SHADOW_UNKNOWN",
    ]);
    expect(diff.get("COMMERCIAL_PERFORMANCE")?.differences).toEqual([
      "CONFLICT_PRESENT",
    ]);
    expect(diff.get("CAPITAL_STRATEGY")?.differences).toEqual([
      "LEGACY_GAP_SHADOW_OBSERVED",
    ]);
  });
});
