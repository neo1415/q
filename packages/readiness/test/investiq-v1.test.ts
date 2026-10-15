import { describe, expect, it } from "vitest";

import {
  assessInvestIQV1,
  bandOf,
  confidenceOf,
  CORE_DIMENSIONS,
  EVIDENCE_WEIGHT,
  FDN_DIMENSIONS,
  GRADED_DIMENSIONS,
  INVESTIQ_V1_CRITERIA,
  InvestIQInputError,
  observationWeight,
  OUTPUT_GROUPS,
  STAGE_BANDS,
  STAGE_WEIGHTS,
  stageBandOf,
  type GradedDimension,
  type InvestIQInput,
  type InvestIQObservation,
  type InvestIQV1Assessment,
} from "../src/index.js";

/* Synthetic cases only: the FDN brief has no worked examples. */

const AS_OF = "2026-10-15T00:00:00.000Z";
let n = 0;

function obs(
  criterion: string,
  over: Partial<InvestIQObservation> = {},
): InvestIQObservation {
  n += 1;
  return {
    id: `v1-${String(n).padStart(4, "0")}`,
    criterion,
    reading: "RECORDED",
    statement: `statement ${criterion}`,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    lifecycleStatus: "CURRENT",
    provenance: { sourceKind: "CLAIM", sourceRef: null, observedAt: null },
    ...over,
  };
}

function company(
  observations: InvestIQObservation[],
  stageCode: string | null = "seed",
): InvestIQInput {
  return {
    companyRef: "synthetic",
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

function keysOf(d: GradedDimension, gradedOnly = true): string[] {
  return INVESTIQ_V1_CRITERIA.filter(
    (c) => c.dimension === d && (!gradedOnly || c.graded),
  ).map((c) => c.key);
}

/** Every graded criterion of the dimensions, one observation each. */
function full(
  dims: readonly GradedDimension[],
  over: Partial<InvestIQObservation> = {},
): InvestIQObservation[] {
  return dims.flatMap((d) => keysOf(d).map((k) => obs(k, over)));
}

const STRONG_DOC: Partial<InvestIQObservation> = {
  reading: "SUPPORTS_STRENGTH",
  anchor: 4,
  evidenceStatus: "DOCUMENT_SUPPORTED",
};

function dim(a: InvestIQV1Assessment, d: GradedDimension) {
  const r = a.dimensions.find((x) => x.dimension === d);
  if (r === undefined) throw new Error(d);
  return r;
}

describe("stage weight tables", () => {
  it.each(STAGE_BANDS)(
    "%s sums to 100 over the eight graded dimensions",
    (s) => {
      const w = STAGE_WEIGHTS[s];
      expect(Object.keys(w).sort()).toEqual([...GRADED_DIMENSIONS].sort());
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBe(100);
      for (const v of Object.values(w)) expect(v).toBeGreaterThan(0);
    },
  );

  it("Investor Fit is canonical but never weighted (C3)", () => {
    expect(FDN_DIMENSIONS).toContain("INVESTOR_FIT");
    expect(GRADED_DIMENSIONS as readonly string[]).not.toContain(
      "INVESTOR_FIT",
    );
    const a = assessInvestIQV1(company([]));
    expect(a.investorFit).toEqual({
      status: "ROUTED_TO_DISCOVERY_FIT",
      weight: 0,
    });
  });

  it("team and fundamentals lead early; commercial and financial grow with stage", () => {
    const order = STAGE_BANDS.map((s) => STAGE_WEIGHTS[s]);
    for (let i = 1; i < order.length; i += 1) {
      const prev = order[i - 1];
      const cur = order[i];
      if (prev === undefined || cur === undefined) throw new Error("stage");
      expect(cur.MANAGEMENT_AND_TEAM).toBeLessThanOrEqual(
        prev.MANAGEMENT_AND_TEAM,
      );
      expect(cur.BUSINESS_FUNDAMENTALS).toBeLessThanOrEqual(
        prev.BUSINESS_FUNDAMENTALS,
      );
      expect(cur.COMMERCIAL_STRENGTH).toBeGreaterThanOrEqual(
        prev.COMMERCIAL_STRENGTH,
      );
      expect(cur.FINANCIAL_READINESS).toBeGreaterThanOrEqual(
        prev.FINANCIAL_READINESS,
      );
      expect(cur.DILIGENCE_READINESS).toBeGreaterThanOrEqual(
        prev.DILIGENCE_READINESS,
      );
    }
    expect(STAGE_WEIGHTS.PRE_SEED.MANAGEMENT_AND_TEAM).toBe(30);
  });

  it("stage parsing is explicit; unrecognised or missing is null, never seed", () => {
    expect(stageBandOf("pre_seed")).toBe("PRE_SEED");
    expect(stageBandOf("idea")).toBe("PRE_SEED");
    expect(stageBandOf("seed")).toBe("SEED");
    expect(stageBandOf("series_a")).toBe("SERIES_A");
    expect(stageBandOf("series_b")).toBe("GROWTH");
    expect(stageBandOf("series_c_plus")).toBe("GROWTH");
    expect(stageBandOf("bridge")).toBeNull();
    expect(stageBandOf(null)).toBeNull();
  });

  it("the same evidence bands differently by stage only through the weights", () => {
    const list = [
      ...full(["MANAGEMENT_AND_TEAM", "BUSINESS_FUNDAMENTALS"], STRONG_DOC),
      ...full(
        ["COMMERCIAL_STRENGTH", "FINANCIAL_READINESS", "INVESTMENT_CASE"],
        {
          reading: "INDICATES_WEAKNESS",
          anchor: 0,
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
      ),
    ];
    const pre = assessInvestIQV1(company(list, "pre_seed")).overall.score ?? -1;
    const growth =
      assessInvestIQV1(company(list, "series_b")).overall.score ?? -1;
    expect(pre).toBeGreaterThan(growth);
  });
});

describe("band edges (lower bound inclusive)", () => {
  it.each([
    [0, "NOT_YET_READY"],
    [1.49, "NOT_YET_READY"],
    [1.5, "DEVELOPING"],
    [1.99, "DEVELOPING"],
    [2, "READY"],
    [2.74, "READY"],
    [2.75, "STRONG"],
    [4, "STRONG"],
  ] as const)("%s -> %s", (score, band) => {
    expect(bandOf(score)).toBe(band);
  });

  it("an exact 2.75 criterion score (anchor 3, document-supported) bands STRONG end to end", () => {
    const a = assessInvestIQV1(
      company(
        full(
          ["MANAGEMENT_AND_TEAM", "BUSINESS_FUNDAMENTALS", "INVESTMENT_CASE"],
          {
            reading: "SUPPORTS_STRENGTH",
            anchor: 3,
            evidenceStatus: "DOCUMENT_SUPPORTED",
          },
        ),
      ),
    );
    expect(a.overall.score).toBe(2.75);
    expect(a.overall.band).toBe("STRONG");
  });
});

describe("evidence multiplier", () => {
  it("self-reported < document-supported < verified, both directions shrink to baseline", () => {
    const at = (
      status: InvestIQObservation["evidenceStatus"],
      reading: InvestIQObservation["reading"],
      anchor: number,
    ) =>
      assessInvestIQV1(
        company([
          obs("fl.founder_quality", {
            evidenceStatus: status,
            reading,
            anchor,
          }),
        ]),
      )
        .dimensions.flatMap((d) => d.criteria)
        .find((c) => c.criterion === "fl.founder_quality")?.score;
    expect(at("SELF_REPORTED", "SUPPORTS_STRENGTH", 4)).toBe(3);
    expect(at("DOCUMENT_SUPPORTED", "SUPPORTS_STRENGTH", 4)).toBe(3.5);
    expect(at("EXTERNALLY_VERIFIED", "SUPPORTS_STRENGTH", 4)).toBe(4);
    expect(at("SELF_REPORTED", "INDICATES_WEAKNESS", 0)).toBe(1);
    expect(at("EXTERNALLY_VERIFIED", "INDICATES_WEAKNESS", 0)).toBe(0);
    expect(EVIDENCE_WEIGHT.SELF_REPORTED).toBeLessThan(
      EVIDENCE_WEIGHT.DOCUMENT_SUPPORTED,
    );
  });

  it("truth class and staleness lower the weight; estimates and inference count less", () => {
    const w = (over: Partial<InvestIQObservation>) =>
      observationWeight(
        obs("cp.traction", { evidenceStatus: "DOCUMENT_SUPPORTED", ...over }),
      );
    expect(w({})).toBe(0.75);
    expect(w({ truthClass: "ESTIMATE" })).toBeCloseTo(0.5625);
    expect(w({ truthClass: "Q_INFERENCE" })).toBe(0.375);
    expect(w({ lifecycleStatus: "STALE" })).toBe(0.375);
  });

  it("no volume bonus: ten self-reported copies do not beat one document", () => {
    const copies = Array.from({ length: 10 }, () =>
      obs("cp.traction", { reading: "SUPPORTS_STRENGTH", anchor: 4 }),
    );
    const doc = obs("cp.traction", {
      reading: "SUPPORTS_STRENGTH",
      anchor: 3,
      evidenceStatus: "DOCUMENT_SUPPORTED",
    });
    const c = assessInvestIQV1(company([...copies, doc]))
      .dimensions.flatMap((d) => d.criteria)
      .find((x) => x.criterion === "cp.traction");
    expect(c?.score).toBe(2.75);
    expect(c?.evidenceWeight).toBe(0.75);
  });

  it("rejects an anchor that disagrees with its reading", () => {
    expect(() =>
      assessInvestIQV1(
        company([
          obs("cp.traction", { reading: "SUPPORTS_STRENGTH", anchor: 1 }),
        ]),
      ),
    ).toThrow(InvestIQInputError);
    expect(() =>
      assessInvestIQV1(
        company([obs("cp.traction", { reading: "RECORDED", anchor: 3 })]),
      ),
    ).toThrow(/disagrees/);
  });
});

describe("coverage rules: below threshold is insufficient evidence, never a low grade", () => {
  it("dimension edge: 2 of 5 criteria (0.4) scores; 1 of 5 is INSUFFICIENT_EVIDENCE", () => {
    const keys = keysOf("MANAGEMENT_AND_TEAM");
    expect(keys).toHaveLength(5);
    const two = assessInvestIQV1(company(keys.slice(0, 2).map((k) => obs(k))));
    expect(dim(two, "MANAGEMENT_AND_TEAM").status).toBe("SCORED");
    const one = assessInvestIQV1(company(keys.slice(0, 1).map((k) => obs(k))));
    expect(dim(one, "MANAGEMENT_AND_TEAM").status).toBe(
      "INSUFFICIENT_EVIDENCE",
    );
    expect(dim(one, "MANAGEMENT_AND_TEAM").score).toBeNull();
  });

  it("weighted edge at seed: Team+Fundamentals (50%) insufficient; + Investment Case (60%) bands", () => {
    const fifty = assessInvestIQV1(
      company(
        full(["MANAGEMENT_AND_TEAM", "BUSINESS_FUNDAMENTALS"], STRONG_DOC),
      ),
    );
    expect(fifty.overall.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(fifty.overall.band).toBeNull();
    expect(fifty.overall.reasons).toContain("WEIGHTED_COVERAGE_BELOW_MIN");
    const sixty = assessInvestIQV1(
      company(
        full(
          ["MANAGEMENT_AND_TEAM", "BUSINESS_FUNDAMENTALS", "INVESTMENT_CASE"],
          STRONG_DOC,
        ),
      ),
    );
    expect(sixty.overall.weightedCoverage).toBe(0.6);
    expect(sixty.overall.status).toBe("BANDED");
  });

  it("the overall band requires Team and Fundamentals scored, whatever else is known", () => {
    const a = assessInvestIQV1(
      company(
        full(
          [
            "BUSINESS_FUNDAMENTALS",
            "COMMERCIAL_STRENGTH",
            "FINANCIAL_READINESS",
            "GOVERNANCE",
            "LEGAL_AND_CORPORATE",
            "INVESTMENT_CASE",
            "DILIGENCE_READINESS",
          ],
          STRONG_DOC,
        ),
      ),
    );
    expect(a.overall.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(a.overall.reasons).toContain(
      "REQUIRED_DIMENSION_UNSCORED:MANAGEMENT_AND_TEAM",
    );
  });

  it("unknown stage gives no band at all (no default weights)", () => {
    const a = assessInvestIQV1(
      company(full([...GRADED_DIMENSIONS], STRONG_DOC), null),
    );
    expect(a.stageBand).toBeNull();
    expect(a.weights).toBeNull();
    expect(a.overall.reasons).toEqual(["STAGE_UNKNOWN"]);
  });

  it("unknown never becomes zero: adding unknown criteria does not lower a score", () => {
    const base = full(
      ["MANAGEMENT_AND_TEAM", "BUSINESS_FUNDAMENTALS", "INVESTMENT_CASE"],
      STRONG_DOC,
    );
    const a = assessInvestIQV1(company(base));
    const b = assessInvestIQV1(
      company([
        ...base,
        obs("fh.cash_flow", {
          truthClass: "UNKNOWN",
          evidenceStatus: "NO_EVIDENCE",
          statement: "Cash flow not known",
        }),
      ]),
    );
    expect(b.overall.score).toBe(a.overall.score);
    expect(dim(b, "FINANCIAL_READINESS").status).toBe("INSUFFICIENT_EVIDENCE");
    expect(
      dim(b, "FINANCIAL_READINESS").criteria.find(
        (c) => c.criterion === "fh.cash_flow",
      )?.knownUnknowns,
    ).toEqual(["Cash flow not known"]);
  });

  it("pre-seed N/A criteria leave the coverage denominator", () => {
    const a = assessInvestIQV1(company([], "pre_seed"));
    expect(dim(a, "COMMERCIAL_STRENGTH").applicableGradedCriteria).toBe(
      keysOf("COMMERCIAL_STRENGTH").length - 1,
    );
  });
});

describe("confidence: discrete levels, never multiplied into the score", () => {
  it.each([
    [0.75, 0.75, false, "HIGH"],
    [0.74, 0.75, false, "MODERATE"],
    [0.75, 0.74, false, "MODERATE"],
    [0.5, 0.6, false, "MODERATE"],
    [0.49, 0.6, false, "LOW"],
    [0.5, 0.59, false, "LOW"],
    [1, 1, true, "MODERATE"],
    [0.5, 0.6, true, "LOW"],
    [0.1, 0.1, true, "LOW"],
  ] as const)(
    "coverage %s quality %s conflict %s -> %s",
    (c, q, conflict, level) => {
      expect(confidenceOf(c, q, conflict)).toBe(level);
    },
  );

  it("self-reported-only strength is capped at DEVELOPING (unsupported claims never read Ready)", () => {
    const a = assessInvestIQV1(
      company(
        full([...GRADED_DIMENSIONS], {
          reading: "SUPPORTS_STRENGTH",
          anchor: 4,
        }),
      ),
    );
    expect(a.overall.score).toBe(3);
    expect(a.overall.confidence).toBe("LOW");
    expect(a.overall.band).toBe("DEVELOPING");
    expect(a.overall.cappedByConfidence).toBe(true);
  });

  it("document-supported full evidence reads STRONG with HIGH confidence", () => {
    const a = assessInvestIQV1(
      company(full([...GRADED_DIMENSIONS], STRONG_DOC)),
    );
    expect(a.overall.band).toBe("STRONG");
    expect(a.overall.confidence).toBe("HIGH");
  });

  it("an open conflict is withheld, lowers confidence and never lowers the score", () => {
    const base = full([...GRADED_DIMENSIONS], STRONG_DOC);
    const a = assessInvestIQV1(company(base));
    const b = assessInvestIQV1(
      company([
        ...base,
        obs("cp.traction", { lifecycleStatus: "CONTRADICTORY" }),
      ]),
    );
    const c = b.dimensions
      .flatMap((d) => d.criteria)
      .find((x) => x.criterion === "cp.traction");
    expect(c?.state).toBe("CONFLICTED");
    expect(c?.score).toBeNull();
    expect(b.overall.score).toBe(a.overall.score);
    expect(b.overall.confidence).toBe("MODERATE");
  });
});

describe("separate outputs and locked rules", () => {
  it("Business Quality and Investment Readiness are disjoint and each banded on its own", () => {
    const bq = new Set<string>(OUTPUT_GROUPS.BUSINESS_QUALITY);
    expect(OUTPUT_GROUPS.INVESTMENT_READINESS.some((d) => bq.has(d))).toBe(
      false,
    );
    const a = assessInvestIQV1(
      company([
        ...full(OUTPUT_GROUPS.BUSINESS_QUALITY, STRONG_DOC),
        ...full(OUTPUT_GROUPS.INVESTMENT_READINESS, {
          reading: "INDICATES_WEAKNESS",
          anchor: 0,
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ]),
    );
    expect(a.businessQuality.band).toBe("STRONG");
    expect(a.investmentReadiness.band).toBe("NOT_YET_READY");
  });

  it("valuation and dilution are recorded but never graded (C8)", () => {
    const a = assessInvestIQV1(
      company([
        obs("cs.valuation", {
          reading: "INDICATES_WEAKNESS",
          anchor: 0,
          evidenceStatus: "EXTERNALLY_VERIFIED",
        }),
      ]),
    );
    const ic = dim(a, "INVESTMENT_CASE");
    expect(
      ic.criteria.find((c) => c.criterion === "cs.valuation")?.graded,
    ).toBe(false);
    expect(ic.scoredCriteria).toBe(0);
    expect(ic.applicableGradedCriteria).toBe(keysOf("INVESTMENT_CASE").length);
  });

  it("emits no capital-form recommendation, fit, interest or probability (C3, C4)", () => {
    const a = assessInvestIQV1(
      company(full([...GRADED_DIMENSIONS], STRONG_DOC)),
    );
    expect(a.notComputedHere).toEqual(
      expect.arrayContaining([
        "INVESTOR_FIT",
        "CAPITAL_FORM_RECOMMENDATION",
        "VALUATION",
      ]),
    );
    expect(JSON.stringify(a)).not.toMatch(
      /"(recommendedInstrument|capitalForm|probability|percent|fitScore)"/i,
    );
  });

  it("every FDN criterion maps to one Core Seven dimension; the projection covers all seven", () => {
    for (const c of INVESTIQ_V1_CRITERIA)
      expect(CORE_DIMENSIONS).toContain(c.coreSeven);
    const a = assessInvestIQV1(
      company(full([...GRADED_DIMENSIONS], STRONG_DOC)),
    );
    expect(a.coreSevenProjection.map((p) => p.dimension)).toEqual([
      ...CORE_DIMENSIONS,
    ]);
    expect(a.coreSevenProjection.every((p) => p.score !== null)).toBe(true);
  });

  it("is deterministic and order-independent", () => {
    const list = full([...GRADED_DIMENSIONS], STRONG_DOC);
    expect(assessInvestIQV1(company([...list].reverse()))).toEqual(
      assessInvestIQV1(company(list)),
    );
  });
});
