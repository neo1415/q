import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  FIT_PARAMETERS,
  FitComparisonDtoSchema,
  FitProfileDtoSchema,
  type FitOutcome,
  type FitParameter,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { EligibilityReasonCode } from "../src/eligibility/contracts.js";
import type { RecommendationFeatureSnapshot } from "../src/features/contracts.js";
import {
  FIT_CONFIG_CURRENT,
  FIT_CONFIG_V4,
  FIT_CONFIGS,
  FitConfigSchema,
  fitConfigByVersion,
} from "../src/fit/config.js";
import {
  assessFit,
  notApplicableObservation,
  unknownObservation,
  type FitInputs,
  type FitObservation,
} from "../src/fit/model.js";
import {
  formatMoney,
  observeFit,
  type DeclaredFitFacts,
} from "../src/fit/observe.js";
import {
  buildFitComparison,
  createFitService,
  fitComparisonText,
  type FitCandidate,
  type FitCompanyInputs,
} from "../src/fit/service.js";
import {
  FIT_REASON_TEMPLATES,
  renderFitReason,
  type FitReasonKey,
} from "../src/fit/templates.js";

const AT = "2026-10-05T21:40:00.000Z";
const NOW = new Date(AT);
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function known(
  outcome: Exclude<FitOutcome, "UNKNOWN">,
  evidence: FitObservation["evidenceStatus"] = "DOCUMENT_SUPPORTED",
): FitObservation {
  return {
    outcome,
    applicable: true,
    evidenceStatus: evidence,
    stale: false,
    facts: {},
  };
}

function inputs(
  outcomes: Partial<Record<FitParameter, FitObservation>>,
  companyId = ID(1),
): FitInputs {
  const observations = Object.fromEntries(
    FIT_PARAMETERS.map((p) => [p, outcomes[p] ?? unknownObservation()]),
  ) as Record<FitParameter, FitObservation>;
  return { companyId, observations, hardRule: null };
}

/** S strong, P partial, M mismatch, U unknown, - no preference; FIT_PARAMETERS order. */
function row(
  pattern: string,
  evidence: FitObservation["evidenceStatus"] = "DOCUMENT_SUPPORTED",
  companyId = ID(1),
): FitInputs {
  const map: Record<string, () => FitObservation> = {
    S: () => known("STRONG", evidence),
    P: () => known("PARTIAL", evidence),
    M: () => known("MISMATCH", evidence),
    U: () => unknownObservation(),
    "-": () => notApplicableObservation(),
  };
  const outcomes: Partial<Record<FitParameter, FitObservation>> = {};
  FIT_PARAMETERS.forEach((p, i) => {
    const make = map[pattern[i] ?? "U"];
    if (make !== undefined) outcomes[p] = make();
  });
  return inputs(outcomes, companyId);
}

describe("fit config ranking-config.v4", () => {
  it("is valid, frozen, nine parameters in order, weights summing to one", () => {
    expect(FitConfigSchema.parse(FIT_CONFIG_V4)).toEqual(FIT_CONFIG_V4);
    expect(Object.isFrozen(FIT_CONFIG_V4)).toBe(true);
    expect(Object.isFrozen(FIT_CONFIG_V4.parameters[0])).toBe(true);
    expect(FIT_CONFIG_V4.parameters.map((p) => p.parameter)).toEqual([
      ...FIT_PARAMETERS,
    ]);
    expect(
      FIT_CONFIG_V4.parameters.reduce((s, p) => s + p.weight, 0),
    ).toBeCloseTo(1, 12);
    expect(FIT_CONFIG_V4.extends).toBe("ranking-config.v3");
    expect(FIT_CONFIG_CURRENT).toBe(FIT_CONFIG_V4);
    expect(fitConfigByVersion("ranking-config.v4")).toBe(FIT_CONFIG_V4);
    expect(fitConfigByVersion("ranking-config.v99")).toBeNull();
  });

  it("a published version is never edited (its content is pinned)", () => {
    // Changing a weight, threshold or template version is a NEW version.
    const digest = createHash("sha256")
      .update(JSON.stringify(FIT_CONFIG_V4))
      .digest("hex");
    expect(digest).toBe(PINNED_V4_DIGEST);
    expect(new Set(FIT_CONFIGS.map((c) => c.version)).size).toBe(
      FIT_CONFIGS.length,
    );
  });

  it("refuses a config whose weights do not sum to one or whose bands are not ordered", () => {
    expect(() =>
      FitConfigSchema.parse({
        ...FIT_CONFIG_V4,
        parameters: FIT_CONFIG_V4.parameters.map((p, i) =>
          i === 0 ? { ...p, weight: 0.5 } : p,
        ),
      }),
    ).toThrow();
    expect(() =>
      FitConfigSchema.parse({
        ...FIT_CONFIG_V4,
        bands: { ...FIT_CONFIG_V4.bands, good: { minValue: 0.95 } },
      }),
    ).toThrow();
  });
});

describe("the fit model is reproducible", () => {
  it("the same inputs under the same config give the same profile", () => {
    const a = assessFit(row("SSSSSPSPU"), FIT_CONFIG_V4, AT);
    const b = assessFit(row("SSSSSPSPU"), FIT_CONFIG_V4, AT);
    expect(a).toEqual(b);
    expect(JSON.stringify(a.profile)).toBe(JSON.stringify(b.profile));
    expect(FitProfileDtoSchema.parse(a.profile)).toEqual(a.profile);
    expect(a.profile.configVersion).toBe("ranking-config.v4");
    expect(a.profile.configLabel).toBe("4");
  });

  it("no number reaches the profile a person sees", () => {
    const { profile } = assessFit(row("SSSSSSSSS"), FIT_CONFIG_V4, AT);
    const shown = JSON.stringify({ ...profile, computedAt: "", companyId: "" });
    expect(shown).not.toMatch(/\d+(\.\d+)?%/);
    expect(Object.keys(profile)).not.toContain("value");
    expect(Object.keys(profile)).not.toContain("score");
  });

  it("matches the approved mockup's four requests", () => {
    // Sunline: thesis partial, everything else strong, documents behind it.
    const sunline = assessFit(
      row("SSSSSSSPS", "DOCUMENT_SUPPORTED"),
      FIT_CONFIG_V4,
      AT,
    );
    expect([sunline.profile.band, sunline.profile.confidence]).toEqual([
      "STRONG_FIT",
      "HIGH",
    ]);
    // Kora: traction partial, round unknown, mostly self-reported.
    const kora = assessFit(
      row("SSSSSPSSU", "SELF_REPORTED"),
      FIT_CONFIG_V4,
      AT,
    );
    expect([kora.profile.band, kora.profile.confidence]).toEqual([
      "GOOD_FIT",
      "MEDIUM",
    ]);
    // Harvest Ledger: four unknowns.
    const harvest = assessFit(
      row("SPPSUUPSU", "SELF_REPORTED"),
      FIT_CONFIG_V4,
      AT,
    );
    expect([harvest.profile.band, harvest.profile.confidence]).toEqual([
      "PARTIAL_FIT",
      "LOW",
    ]);
    // Freightly: a good company outside the mandate on stage, cheque and region.
    const freightly = assessFit(
      row("MPMMSSSPP", "DOCUMENT_SUPPORTED"),
      FIT_CONFIG_V4,
      AT,
    );
    expect([freightly.profile.band, freightly.profile.confidence]).toEqual([
      "WEAK_FIT",
      "HIGH",
    ]);
  });
});

describe("unknown is never counted against a company", () => {
  it("only stage and sector known, both strong: never a high-confidence strong fit", () => {
    const { profile } = assessFit(row("SSUUUUUUU"), FIT_CONFIG_V4, AT);
    expect(profile.band).toBe("NOT_ENOUGH_INFORMATION");
    expect(profile.confidence).toBe("LOW");
  });

  it("an unknown leaves the value unchanged and lowers confidence; a mismatch lowers the value", () => {
    const all = assessFit(row("SSSSSSSSS"), FIT_CONFIG_V4, AT);
    const unknownRound = assessFit(row("SSSSSSSSU"), FIT_CONFIG_V4, AT);
    const mismatchRound = assessFit(row("SSSSSSSSM"), FIT_CONFIG_V4, AT);
    expect(unknownRound.value).toBe(all.value);
    expect(unknownRound.confidenceScore).toBeLessThan(all.confidenceScore);
    expect(mismatchRound.value ?? 1).toBeLessThan(all.value ?? 0);
  });

  it("an unknown is never the main mismatch and never a top reason", () => {
    const { profile } = assessFit(row("SUUUUUUUU"), FIT_CONFIG_V4, AT);
    expect(profile.mainMismatch).toBeNull();
    expect(profile.topReasons.every((r) => r.outcome !== "UNKNOWN")).toBe(true);
  });

  it("a parameter with no declared preference counts toward neither fit nor confidence", () => {
    const declared = assessFit(row("SSSSSSSSS"), FIT_CONFIG_V4, AT);
    const noPreference = assessFit(row("SSSSSSSS-"), FIT_CONFIG_V4, AT);
    expect(noPreference.value).toBe(declared.value);
    expect(noPreference.coverage).toBe(1);
    const round = noPreference.profile.parameters.find(
      (p) => p.parameter === "ROUND_TERMS",
    );
    expect(round?.applicable).toBe(false);
    expect(round?.reason).toBe("You have not said whether you lead.");
  });

  it("nothing known at all is not enough information, not a weak fit", () => {
    const { profile, value } = assessFit(row("UUUUUUUUU"), FIT_CONFIG_V4, AT);
    expect(value).toBeNull();
    expect(profile.band).toBe("NOT_ENOUGH_INFORMATION");
  });

  it("observing a company with no inputs at all gives no mismatch anywhere", () => {
    const observed = observeFit({
      companyId: ID(1),
      snapshot: null,
      declared: {},
      eligibilityReasons: [],
      config: FIT_CONFIG_V4,
      now: NOW,
    });
    for (const o of Object.values(observed.observations)) {
      expect(o.outcome).toBe("UNKNOWN");
    }
    expect(observed.hardRule).toBeNull();
  });

  it("a stale traction input lowers confidence, not fit", () => {
    const declared: DeclaredFitFacts = {
      tractionMinimum: { amount: "50000", currency: "USD" },
      monthlyRevenue: {
        amount: "58000",
        currency: "USD",
        observedAt: "2026-09-01T00:00:00.000Z",
        evidenceStatus: "DOCUMENT_SUPPORTED",
      },
    };
    const fresh = observeFit({
      companyId: ID(1),
      snapshot: null,
      declared,
      eligibilityReasons: [],
      config: FIT_CONFIG_V4,
      now: NOW,
    });
    const stale = observeFit({
      companyId: ID(1),
      snapshot: null,
      declared: {
        ...declared,
        monthlyRevenue: {
          amount: "58000",
          currency: "USD",
          observedAt: "2025-01-01T00:00:00.000Z",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
      },
      eligibilityReasons: [],
      config: FIT_CONFIG_V4,
      now: NOW,
    });
    expect(fresh.observations.TRACTION.outcome).toBe("STRONG");
    expect(stale.observations.TRACTION.outcome).toBe("STRONG");
    expect(stale.observations.TRACTION.stale).toBe(true);
    const a = assessFit(fresh, FIT_CONFIG_V4, AT);
    const b = assessFit(stale, FIT_CONFIG_V4, AT);
    expect(b.value).toBe(a.value);
    expect(b.confidenceScore).toBeLessThan(a.confidenceScore);
  });
});

describe("comparators", () => {
  const observe = (
    declared: DeclaredFitFacts,
    reasons: readonly EligibilityReasonCode[] = [],
    snapshot: RecommendationFeatureSnapshot | null = null,
  ) =>
    observeFit({
      companyId: ID(1),
      snapshot,
      declared,
      eligibilityReasons: reasons,
      config: FIT_CONFIG_V4,
      now: NOW,
    });

  it("cheque: a share of the round, never across currencies", () => {
    const cheque = {
      currency: "USD",
      min: "100000",
      typical: "300000",
      max: "500000",
    };
    const at = (amount: string, currency = "USD") =>
      observe({
        cheque,
        round: { amount, currency, evidenceStatus: "SELF_REPORTED" },
      }).observations.CHEQUE_SIZE;
    expect(at("2000000").outcome).toBe("STRONG");
    expect(at("8000000").outcome).toBe("PARTIAL");
    expect(at("20000000").outcome).toBe("MISMATCH");
    expect(at("2000000", "EUR").outcome).toBe("UNKNOWN");
    expect(observe({ cheque }).observations.CHEQUE_SIZE.outcome).toBe(
      "UNKNOWN",
    );
    expect(
      observe({ round: { amount: "1", currency: "USD", evidenceStatus: null } })
        .observations.CHEQUE_SIZE.applicable,
    ).toBe(false);
  });

  it("business model, team and round terms compare only declared preferences", () => {
    const prefs = { preferred: ["B2B_SUBSCRIPTION"], avoided: ["HARDWARE"] };
    const bm = (code: string) =>
      observe({
        businessModelPreferences: prefs,
        businessModel: { code, label: code, evidenceStatus: null },
      }).observations.BUSINESS_MODEL.outcome;
    expect([bm("B2B_SUBSCRIPTION"), bm("MARKETPLACE"), bm("HARDWARE")]).toEqual(
      ["STRONG", "PARTIAL", "MISMATCH"],
    );

    const team = (
      fullTimeFounders: boolean | null,
      technicalCofounder: boolean | null,
    ) =>
      observe({
        teamRequirements: { fullTime: "MUST", technical: "PREFER" },
        team: {
          fullTimeFounders,
          technicalCofounder,
          evidenceStatus: "SELF_REPORTED",
        },
      }).observations.TEAM.outcome;
    expect([
      team(true, true),
      team(true, false),
      team(false, true),
      team(true, null),
    ]).toEqual(["STRONG", "PARTIAL", "MISMATCH", "UNKNOWN"]);

    const round = (
      needsLead: boolean | null,
      leadPolicy: "ALWAYS" | "SOMETIMES" | "NEVER",
    ) =>
      observe({ leadPolicy, roundTerms: { needsLead, evidenceStatus: null } })
        .observations.ROUND_TERMS.outcome;
    expect([
      round(false, "NEVER"),
      round(true, "ALWAYS"),
      round(true, "SOMETIMES"),
      round(true, "NEVER"),
      round(null, "NEVER"),
    ]).toEqual(["STRONG", "STRONG", "PARTIAL", "MISMATCH", "UNKNOWN"]);
  });

  it("the four snapshot parameters read the ranker's own features", () => {
    const snapshot = snapshotWith({
      "declared_fit.stage": "MATCH",
      "declared_fit.taxonomy": "DESCENDANT_OVERLAP",
      "declared_fit.geography": "NO_MATCH",
      "semantic_fit.mandate_similarity": 0.3,
    });
    const o = observe({}, [], snapshot).observations;
    expect([
      o.STAGE.outcome,
      o.SECTOR.outcome,
      o.GEOGRAPHY.outcome,
      o.THESIS.outcome,
    ]).toEqual(["STRONG", "PARTIAL", "MISMATCH", "PARTIAL"]);
    const noPreference = observe(
      {},
      [],
      snapshotWith(
        {},
        {
          "declared_fit.stage": "NO_DECLARED_PREFERENCE",
          "declared_fit.taxonomy": "COMPANY_TAXONOMY_UNKNOWN",
        },
      ),
    ).observations;
    expect(noPreference.STAGE.applicable).toBe(false);
    expect(noPreference.SECTOR.outcome).toBe("UNKNOWN");
    expect(noPreference.SECTOR.applicable).toBe(true);
  });

  it("a hard rule comes only from a declared mandate rule, and names it", () => {
    expect(
      observe({}, ["COMPANY_STAGE_UNKNOWN", "RELATIONSHIP_CLOSED"]).hardRule,
    ).toBeNull();
    const excluded = observe({}, ["EXPLICIT_HARD_EXCLUSION"]);
    expect(excluded.hardRule?.code).toBe("DECLARED_EXCLUSION");
    const { profile } = assessFit(
      { ...row("SSSSSSSSS"), hardRule: excluded.hardRule },
      FIT_CONFIG_V4,
      AT,
    );
    expect(profile.band).toBe("OUTSIDE_MANDATE");
    expect(profile.hardRule?.label).toMatch(/rule you set/);
  });

  it("formats money short and deterministically", () => {
    expect([
      formatMoney("1500000", "USD"),
      formatMoney("250000", "USD"),
      formatMoney("31000", "GBP"),
      formatMoney("900", "ZAR"),
    ]).toEqual(["$1.5M", "$250k", "£31k", "ZAR 900"]);
  });
});

describe("reason templates fit-reasons.v1", () => {
  const keys: FitReasonKey[] = [
    "STRONG",
    "PARTIAL",
    "MISMATCH",
    "UNKNOWN",
    "NO_PREFERENCE",
  ];

  it("every parameter has a sentence for every outcome, and plain ones have no slots", () => {
    for (const p of FIT_PARAMETERS) {
      for (const k of keys) {
        const t = FIT_REASON_TEMPLATES[p][k];
        expect(t.withFacts.length, `${p}.${k}`).toBeGreaterThan(0);
        expect(t.plain, `${p}.${k}`).not.toMatch(/\{/);
        expect(t.plain.endsWith("."), `${p}.${k}`).toBe(true);
      }
    }
  });

  it("fills slots when every fact is present, and falls back to plain otherwise", () => {
    expect(
      renderFitReason("STAGE", "STRONG", {
        companyStage: "seed",
        mandateStages: "seed",
      }),
    ).toBe("Raising seed; you invest at seed.");
    expect(renderFitReason("STAGE", "STRONG", { companyStage: "seed" })).toBe(
      "Their stage is one you invest at.",
    );
    expect(
      renderFitReason("STAGE", "STRONG", {
        companyStage: " ",
        mandateStages: "seed",
      }),
    ).toBe("Their stage is one you invest at.");
  });

  it("unknown says what is missing; a low thesis overlap is never called bad", () => {
    for (const p of FIT_PARAMETERS) {
      expect(FIT_REASON_TEMPLATES[p].UNKNOWN.plain).not.toMatch(
        /poor|bad|weak/i,
      );
    }
    expect(FIT_REASON_TEMPLATES.THESIS.MISMATCH.plain).toBe(
      "Little overlap with your thesis.",
    );
  });
});

describe("top N side by side", () => {
  const item = (
    pattern: string,
    n: number,
    evidence: FitObservation["evidenceStatus"] = "DOCUMENT_SUPPORTED",
  ) => ({
    assessment: assessFit(row(pattern, evidence, ID(n)), FIT_CONFIG_V4, AT),
    name: `Company ${n}`,
    line: null,
  });

  it("orders by fit, leaves out declared exclusions and thin profiles, marks a strict best", () => {
    const outside = item("SSSSSSSSS", 9);
    const items = [
      item("SSSSSPSSU", 2, "SELF_REPORTED"),
      item("SSSSSSSPS", 1),
      item("SUUUUUUUU", 3),
      {
        ...outside,
        assessment: assessFit(
          {
            ...row("SSSSSSSSS", "DOCUMENT_SUPPORTED", ID(9)),
            hardRule: {
              code: "DECLARED_EXCLUSION",
              label: "Outside a rule you set.",
            },
          },
          FIT_CONFIG_V4,
          AT,
        ),
      },
      item("SPSSSSPPS", 4),
    ];
    const comparison = buildFitComparison({
      items,
      sources: new Map(),
      limit: 3,
      config: FIT_CONFIG_V4,
      computedAt: AT,
    });
    expect(FitComparisonDtoSchema.parse(comparison)).toEqual(comparison);
    expect(comparison.entries.map((e) => e.companyId)).toEqual([
      ID(1),
      ID(2),
      ID(4),
    ]);
    expect(comparison.entries.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(comparison.considered).toBe(5);
    expect(comparison.leftOut).toEqual({
      outsideMandate: 1,
      notEnoughInformation: 1,
    });
    // Thesis: only entry 2 is strong there. Traction: 1 and 4 tie, so no best.
    expect(comparison.entries[0]?.bestOn).toEqual([]);
    expect(comparison.entries[1]?.bestOn).toEqual(["THESIS"]);
    expect(
      comparison.entries.every(
        (e) => !e.bestOn.includes("ROUND_TERMS") || e.position !== 2,
      ),
    ).toBe(true);
    expect(fitComparisonText(comparison)).toMatch(
      /^1\. Company 1: Strong fit, high confidence\./,
    );
    expect(fitComparisonText(comparison)).toMatch(/fit rules version 4/);
  });

  it("is the same order on every run", () => {
    const items = [
      item("SSSSSSSSS", 3),
      item("SSSSSSSSS", 1),
      item("SSSSSSSSS", 2),
    ];
    const a = buildFitComparison({
      items,
      sources: new Map(),
      limit: 3,
      config: FIT_CONFIG_V4,
      computedAt: AT,
    });
    const b = buildFitComparison({
      items: [...items].reverse(),
      sources: new Map(),
      limit: 3,
      config: FIT_CONFIG_V4,
      computedAt: AT,
    });
    expect(a.entries.map((e) => e.companyId)).toEqual([ID(1), ID(2), ID(3)]);
    expect(b).toEqual(a);
  });
});

describe("the fit service authorises before it reads (Context Firewall)", () => {
  const actor = {
    userId: ID(100),
    tenantId: ID(101),
    organisationId: ID(102),
    membershipId: ID(103),
    actorType: "USER",
  } as unknown as ActorContext;
  const MANDATE = ID(200);

  function world(options: {
    readonly investor?: boolean;
    readonly candidates?: readonly FitCandidate[];
    readonly reasons?: Readonly<
      Record<string, readonly EligibilityReasonCode[]>
    >;
    readonly mandateId?: string | null;
  }) {
    const read: string[][] = [];
    const evaluated: string[][] = [];
    const service = createFitService({
      investorSubject: {
        investorOrganisationFor: () =>
          Promise.resolve(
            options.investor === false
              ? null
              : { investorOrganisationId: ID(300) },
          ),
      },
      eligibility: {
        evaluate: (query) => {
          evaluated.push([...query.companyIds]);
          expect(query.purpose).toBe("VIEW");
          expect(query.viewpoint).toBe("ACTOR");
          return Promise.resolve({
            context: {} as never,
            results: query.companyIds.map((companyId) => ({
              companyId,
              mandateId:
                options.mandateId === undefined ? MANDATE : options.mandateId,
              reasonCodes: [...(options.reasons?.[companyId] ?? [])],
            })) as never,
          });
        },
      },
      inputs: {
        read: (query) => {
          read.push([...query.companyIds]);
          const map = new Map<string, FitCompanyInputs>();
          for (const id of query.companyIds) {
            map.set(id, {
              snapshot: snapshotWith({
                "declared_fit.stage": "MATCH",
                "declared_fit.taxonomy": "EXACT_OVERLAP",
                "declared_fit.geography": "COUNTRY_MATCH",
              }),
              declared: {},
              name: `Co ${id.slice(-2)}`,
              line: null,
            });
          }
          return Promise.resolve(map);
        },
      },
      candidates: () => Promise.resolve(options.candidates ?? []),
      clock: () => NOW,
    });
    return { service, read, evaluated };
  }

  it("a non-investor gets nothing, and nothing is read", async () => {
    const w = world({ investor: false });
    expect(await w.service.profiles(actor, [ID(1)])).toEqual({
      kind: "NOT_INVESTOR",
    });
    expect(await w.service.top(actor, 3)).toEqual({ kind: "NOT_INVESTOR" });
    expect(w.read).toEqual([]);
    expect(w.evaluated).toEqual([]);
  });

  it("a company the reader may not see is absent, and its inputs are never read", async () => {
    const w = world({
      reasons: { [ID(2)]: ["COMPANY_NOT_DISCOVERABLE_BY_INVESTOR"] },
    });
    const result = await w.service.profiles(actor, [ID(1), ID(2)]);
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") return;
    expect(result.items.map((i) => i.assessment.profile.companyId)).toEqual([
      ID(1),
    ]);
    expect(w.read).toEqual([[ID(1)]]);
  });

  it("no active mandate is said as such, not as a poor fit", async () => {
    const w = world({
      mandateId: null,
      reasons: { [ID(1)]: ["NO_ACTIVE_MANDATE"] },
    });
    expect(await w.service.profiles(actor, [ID(1)])).toEqual({
      kind: "NO_MANDATE",
    });
    expect(w.read).toEqual([]);
  });

  it("top N ranks only the investor's own candidates, merging their sources", async () => {
    const w = world({
      candidates: [
        { companyId: ID(1), source: "REQUEST" },
        { companyId: ID(1), source: "FEED" },
        { companyId: ID(2), source: "RELATIONSHIP" },
      ],
    });
    const result = await w.service.top(actor, 3);
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") return;
    expect(w.evaluated).toEqual([[ID(1), ID(2)]]);
    expect(result.comparison.entries.map((e) => e.companyId).sort()).toEqual([
      ID(1),
      ID(2),
    ]);
    expect(
      result.comparison.entries.find((e) => e.companyId === ID(1))?.sources,
    ).toEqual(["FEED", "REQUEST"]);
  });

  it("with no candidates, top N is empty and evaluates nothing", async () => {
    const w = world({ candidates: [] });
    const result = await w.service.top(actor, 3);
    expect(result.kind === "OK" && result.comparison.entries).toEqual([]);
    expect(w.read).toEqual([]);
  });
});

function snapshotWith(
  present: Readonly<Record<string, string | number>>,
  missing: Readonly<Record<string, string>> = {},
): RecommendationFeatureSnapshot {
  const features = [
    ...Object.entries(present).map(([featureId, value]) => ({
      featureId,
      featureVersion: "v1",
      status: "PRESENT" as const,
      value,
      missingReason: null,
      sourceClasses: [],
      sensitivity: "NETWORK_VISIBLE",
      provenance: {},
    })),
    ...Object.entries(missing).map(([featureId, missingReason]) => ({
      featureId,
      featureVersion: "v1",
      status: "MISSING" as const,
      value: null,
      missingReason,
      sourceClasses: [],
      sensitivity: "NETWORK_VISIBLE",
      provenance: {},
    })),
  ];
  return { features } as unknown as RecommendationFeatureSnapshot;
}

const PINNED_V4_DIGEST =
  "d248597c4bf8195b241d66c813c9b923889333bd0411a7226812db94dc684b83";
