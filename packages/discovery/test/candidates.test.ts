import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  CANDIDATE_POOL_MAX,
  StructuredCandidateResultSchema,
} from "../src/candidates/contracts.js";
import {
  createNotComputableChequeRetrieval,
  type StructuredRetrievalPorts,
} from "../src/candidates/ports.js";
import { createStructuredCandidateService } from "../src/candidates/service.js";
import {
  deriveStructuredIntent,
  mergeDimensionHits,
  type DimensionHit,
} from "../src/candidates/structured.js";
import type {
  ActiveMandateLookup,
  EligibilityPorts,
  MandateSnapshotForEligibility,
} from "../src/eligibility/ports.js";
import type { EligibilityService } from "../src/eligibility/service.js";
import { evaluateHardEligibility } from "../src/eligibility/policy.js";

/**
 * The structured mandate generator over a fake world (CQ-REC-002). The
 * world holds canonical facts and, deliberately, everything that must not
 * matter: founder-private memory, a conversation summary, a private
 * document, public-web findings, observed behaviour. Eligibility is the
 * real REC-001 policy over the same facts, so "found" and "rankable" are
 * proven to be different things.
 */

const TENANT_I = "11111111-0000-4000-8000-000000000011";
const ORG_I = "11111111-0000-4000-8000-000000000012";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const TENANT_C = "22222222-0000-4000-8000-000000000021";
const ORG_C = "22222222-0000-4000-8000-000000000022";
const ACTIVE_MANDATE = "33333333-0000-4000-8000-000000000031";
const DRAFT_MANDATE = "33333333-0000-4000-8000-000000000032";
const FINTECH = "44444444-0000-4000-8000-000000000041";
const PAYMENTS = "44444444-0000-4000-8000-000000000042";
const HARDWARE = "44444444-0000-4000-8000-000000000043";
const GAMBLING = "44444444-0000-4000-8000-000000000044";
const AFRICA = "44444444-0000-4000-8000-000000000045";
const WEST_AFRICA = "44444444-0000-4000-8000-000000000046";
const GLOBAL = "44444444-0000-4000-8000-000000000047";
const MARKER = "REC002_PRIVATE_FOUNDER_CONTEXT_MUST_NOT_AFFECT_CANDIDATES";

const ACTOR = {
  userId: "11111111-0000-4000-8000-000000000014",
  tenantId: TENANT_I,
  organisationId: ORG_I,
  membershipId: "11111111-0000-4000-8000-000000000015",
  actorType: "HUMAN",
} as unknown as ActorContext;

const companyId = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Company = {
  id: string;
  tenantId: string;
  organisationId: string;
  status: "active" | "closed";
  visibility: string;
  ready: boolean;
  stage: string | null;
  country: string | null;
  nodes: { nodeId: string; vocabularyCode: string }[];
  permitted: boolean;
  // Never read by retrieval or eligibility.
  founderMemory: string[];
  conversationSummary: string;
  privateDocument: string;
  publicWeb: string[];
};

type World = {
  companies: Company[];
  mandates: MandateSnapshotForEligibility[];
  activeIds: string[];
  /** node → descendants (reference hierarchy) */
  hierarchy: Record<string, string[]>;
  nodeVocabulary: Record<string, string>;
  unrestricted: string[];
  queries: string[];
};

function company(n: number, overrides: Partial<Company> = {}): Company {
  return {
    id: companyId(n),
    tenantId: TENANT_C,
    organisationId: ORG_C,
    status: "active",
    visibility: "network_visible",
    ready: true,
    stage: null,
    country: null,
    nodes: [],
    permitted: true,
    founderMemory: [],
    conversationSummary: "",
    privateDocument: "",
    publicWeb: [],
    ...overrides,
  };
}

function mandate(
  overrides: Partial<MandateSnapshotForEligibility> = {},
): MandateSnapshotForEligibility {
  return {
    mandateId: ACTIVE_MANDATE,
    investorOrganisationId: INVESTOR,
    version: 1,
    status: "ACTIVE",
    constraints: [
      {
        dimension: "stage",
        operator: "IN",
        value: { kind: "codes", values: ["seed"] },
        importance: "MUST",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
      {
        dimension: "geography.country",
        operator: "IN",
        value: { kind: "codes", values: ["NG"] },
        importance: "STRONG",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
    ],
    taxonomyPreferences: [
      {
        nodeId: FINTECH,
        vocabularyCode: "industry",
        preferenceStrength: "STRONG",
        isExclusion: false,
        source: "user_selected",
      },
      {
        nodeId: HARDWARE,
        vocabularyCode: "industry",
        preferenceStrength: "AVOID",
        isExclusion: false,
        source: "user_selected",
      },
    ],
    ...overrides,
  };
}

/** The declared hard exclusion, for the scenarios that test it (REC-001 owns its effect). */
function withGamblingExclusion(w: World): World {
  const active = w.mandates[0];
  if (active === undefined) throw new Error("fixture");
  w.mandates[0] = {
    ...active,
    taxonomyPreferences: [
      ...active.taxonomyPreferences,
      {
        nodeId: GAMBLING,
        vocabularyCode: "industry",
        preferenceStrength: "HARD_EXCLUSION",
        isExclusion: true,
        source: "user_selected",
      },
    ],
  };
  return w;
}

function world(overrides: Partial<World> = {}): World {
  return {
    companies: [
      // A: stage + geography + taxonomy (descendant of fintech)
      company(1, {
        stage: "seed",
        country: "NG",
        nodes: [{ nodeId: PAYMENTS, vocabularyCode: "industry" }],
      }),
      // B: geography only
      company(2, { stage: "series_b", country: "NG" }),
      // C: taxonomy only (exact)
      company(3, {
        stage: "series_a",
        country: "DE",
        nodes: [{ nodeId: FINTECH, vocabularyCode: "industry" }],
      }),
      // D: stage only, unknown taxonomy
      company(4, { stage: "seed", country: "GB" }),
      // E: AVOID node only → never found
      company(5, {
        stage: "series_c_plus",
        country: "FR",
        nodes: [{ nodeId: HARDWARE, vocabularyCode: "industry" }],
      }),
      // F: hard-excluded (gambling) but seed → found by stage, removed by REC-001
      company(6, {
        stage: "seed",
        country: "NG",
        nodes: [{ nodeId: GAMBLING, vocabularyCode: "industry" }],
      }),
      // G: not marketplace ready → found, never rankable
      company(7, { stage: "seed", country: "NG", ready: false }),
      // H: private / not disclosed (another tenant) → never listed as discoverable
      company(8, {
        tenantId: "99999999-0000-4000-8000-000000000099",
        visibility: "organisation_private",
        permitted: false,
        stage: "seed",
        country: "NG",
      }),
      // I: unknown stage but NG → geography; eligible
      company(9, { stage: null, country: "NG" }),
      // J: region overlap only (west_africa under africa)
      company(10, {
        stage: "series_a",
        country: "GH",
        nodes: [{ nodeId: WEST_AFRICA, vocabularyCode: "geography" }],
      }),
    ],
    mandates: [
      mandate(),
      mandate({
        mandateId: DRAFT_MANDATE,
        status: "DRAFT",
        constraints: [
          {
            dimension: "stage",
            operator: "IN",
            value: { kind: "codes", values: ["series_c_plus"] },
            importance: "MUST",
            isHardExclusion: false,
            automatedUse: "ELIGIBLE",
          },
        ],
        taxonomyPreferences: [
          {
            nodeId: HARDWARE,
            vocabularyCode: "industry",
            preferenceStrength: "MUST",
            isExclusion: false,
            source: "user_selected",
          },
        ],
      }),
    ],
    activeIds: [ACTIVE_MANDATE],
    hierarchy: { [FINTECH]: [PAYMENTS], [AFRICA]: [WEST_AFRICA] },
    nodeVocabulary: {
      [FINTECH]: "industry",
      [PAYMENTS]: "industry",
      [HARDWARE]: "industry",
      [GAMBLING]: "industry",
      [AFRICA]: "geography",
      [WEST_AFRICA]: "geography",
      [GLOBAL]: "geography",
    },
    unrestricted: [GLOBAL],
    queries: [],
    ...overrides,
  };
}

const discoverable = (c: Company) =>
  c.status === "active" &&
  (c.visibility === "network_visible" || c.visibility === "public_external");

function retrieval(w: World): StructuredRetrievalPorts {
  const ref = (c: Company) => ({
    companyId: c.id,
    tenantId: c.tenantId,
    organisationId: c.organisationId,
  });
  const byId = (a: Company, b: Company) => a.id.localeCompare(b.id);
  return {
    companies: {
      byStageCodes: (codes, limit) => {
        w.queries.push("companies.byStage");
        return Promise.resolve(
          w.companies
            .filter(
              (c) =>
                discoverable(c) && c.stage !== null && codes.includes(c.stage),
            )
            .sort(byId)
            .slice(0, limit)
            .map(ref),
        );
      },
      byHeadquartersCountries: (codes, limit) => {
        w.queries.push("companies.byCountry");
        return Promise.resolve(
          w.companies
            .filter(
              (c) =>
                discoverable(c) &&
                c.country !== null &&
                codes.includes(c.country),
            )
            .sort(byId)
            .slice(0, limit)
            .map(ref),
        );
      },
    },
    taxonomy: {
      subjectsByNodes: (nodeIds, limit) => {
        w.queries.push("taxonomy.subjectsByNodes");
        const hits = w.companies
          .filter(discoverable)
          .sort(byId)
          .flatMap((c) =>
            c.nodes
              .filter((n) => nodeIds.includes(n.nodeId))
              .map((n) => ({
                companyId: c.id,
                tenantId: c.tenantId,
                nodeId: n.nodeId,
                vocabularyCode: n.vocabularyCode,
              })),
          );
        return Promise.resolve(hits.slice(0, limit));
      },
      expandPreference: (nodeId) => {
        w.queries.push("taxonomy.expand");
        const vocabularyCode = w.nodeVocabulary[nodeId];
        if (vocabularyCode === undefined) return Promise.resolve(null);
        return Promise.resolve({
          preferredNodeId: nodeId,
          vocabularyCode,
          unrestricted: w.unrestricted.includes(nodeId),
          descendantNodeIds: [...(w.hierarchy[nodeId] ?? [])].sort(),
        });
      },
    },
    cheque: createNotComputableChequeRetrieval(),
  };
}

function eligibilityPorts(
  w: World,
): Pick<EligibilityPorts, "investorSubject" | "mandates" | "taxonomyVersions"> {
  return {
    investorSubject: {
      investorOrganisationFor: (actor) =>
        Promise.resolve(
          actor.organisationId === ORG_I
            ? { investorOrganisationId: INVESTOR }
            : null,
        ),
    },
    mandates: {
      activeMandate: ({ mandateId }) => {
        if (mandateId !== null) {
          const pinned = w.mandates.find((m) => m.mandateId === mandateId);
          return Promise.resolve<ActiveMandateLookup>(
            pinned === undefined
              ? { kind: "NONE" }
              : { kind: "FOUND", mandate: pinned },
          );
        }
        const active = w.mandates.filter(
          (m) => m.status === "ACTIVE" && w.activeIds.includes(m.mandateId),
        );
        if (active.length === 0)
          return Promise.resolve<ActiveMandateLookup>({ kind: "NONE" });
        if (active.length > 1)
          return Promise.resolve<ActiveMandateLookup>({ kind: "AMBIGUOUS" });
        const [only] = active;
        return Promise.resolve<ActiveMandateLookup>(
          only === undefined
            ? { kind: "NONE" }
            : { kind: "FOUND", mandate: only },
        );
      },
    },
    taxonomyVersions: {
      currentVersions: () => Promise.resolve({ industry: 1, geography: 1 }),
    },
  };
}

/** The real REC-001 policy over the world's canonical facts. */
function eligibility(w: World): EligibilityService {
  return {
    evaluate: ({ actor, mandateId, companyIds }) => {
      w.queries.push("eligibility.evaluate");
      const active = w.mandates.find(
        (m) => m.mandateId === mandateId && m.status === "ACTIVE",
      );
      const lookup: ActiveMandateLookup =
        active === undefined
          ? { kind: "NONE" }
          : { kind: "FOUND", mandate: active };
      const results = companyIds.flatMap((id) => {
        const c = w.companies.find((x) => x.id === id);
        if (c === undefined) return [];
        return [
          evaluateHardEligibility({
            mode: "INVESTOR_DISCOVER",
            investorOrganisationId: INVESTOR,
            mandate: lookup,
            company: {
              companyId: c.id,
              tenantId: c.tenantId,
              organisationId: c.organisationId,
              companyStatus: c.status,
              marketplaceVisibility: c.visibility,
              marketplaceParticipation: c.ready ? "ELIGIBLE" : "NOT_ELIGIBLE",
              currentStageCode: c.stage,
              headquartersCountry: c.country,
            },
            // The fake world's classifications are all a person's own.
            classifications: c.nodes.map((n) => ({
              ...n,
              source: "user_selected",
            })),
            permittedToView: c.permitted,
            relationship: { kind: "NONE" },
            taxonomyVersion: { industry: 1, geography: 1 },
            evaluatedAt: "2026-09-18T12:00:00.000Z",
          }),
        ];
      });
      return Promise.resolve({
        context: {
          tenantId: actor.tenantId,
          investorOrganisationId: INVESTOR,
          mode: "INVESTOR_DISCOVER",
          mandateId: active?.mandateId ?? null,
          taxonomyVersion: null,
          eligibilityPolicyVersion: "eligibility.v2",
        },
        results,
      });
    },
  };
}

function service(w: World) {
  return createStructuredCandidateService({
    ports: eligibilityPorts(w),
    retrieval: retrieval(w),
    eligibility: eligibility(w),
  });
}

async function generated(
  w: World,
  query: { mandateId?: string | null; limit?: number } = {},
) {
  const result = await service(w).generate({ actor: ACTOR, ...query });
  if (result.kind !== "GENERATED") throw new Error(result.kind);
  return result;
}

const ids = (r: Awaited<ReturnType<typeof generated>>) =>
  r.candidates.map((c) => c.companyId);
const reasons = (r: Awaited<ReturnType<typeof generated>>, n: number) =>
  r.candidates.find((c) => c.companyId === companyId(n))?.provenance
    .reasonCodes;

describe("structured intent (pure)", () => {
  it("reads positive stage, country and declared taxonomy intent; never AVOID, exclusions, Q-proposed or MANUAL_ONLY", () => {
    const intent = deriveStructuredIntent(
      mandate({
        constraints: [
          ...mandate().constraints,
          {
            dimension: "stage",
            operator: "NOT_IN",
            value: { kind: "codes", values: ["pre_seed", "series_c_plus"] },
            importance: "NICE",
            isHardExclusion: false,
            automatedUse: "ELIGIBLE",
          },
          {
            dimension: "geography.country",
            operator: "NOT_IN",
            value: { kind: "codes", values: ["US"] },
            importance: "STRONG",
            isHardExclusion: false,
            automatedUse: "ELIGIBLE",
          },
          {
            dimension: "stage",
            operator: "IN",
            value: { kind: "codes", values: ["series_b"] },
            importance: "AVOID",
            isHardExclusion: false,
            automatedUse: "ELIGIBLE",
          },
          {
            dimension: "custom.text",
            operator: "EQ",
            value: { kind: "text", text: "seed only please" },
            importance: "MUST",
            isHardExclusion: false,
            automatedUse: "MANUAL_ONLY",
          },
        ],
        taxonomyPreferences: [
          ...mandate().taxonomyPreferences,
          {
            nodeId: PAYMENTS,
            vocabularyCode: "industry",
            preferenceStrength: "MUST",
            isExclusion: false,
            source: "q_inferred",
          },
        ],
      }),
    );
    expect(intent.stageCodes).toEqual(["seed", "series_a", "series_b"]);
    expect(intent.countryCodes).toEqual(["NG"]);
    expect(intent.taxonomyNodeIds).toEqual([FINTECH]);
    expect(intent.cheque).toEqual({
      minCheque: null,
      maxCheque: null,
      currency: null,
    });
  });

  it("uses the declared min/max range when no stage constraint names codes", () => {
    const intent = deriveStructuredIntent({
      constraints: [],
      taxonomyPreferences: [],
      stage: { minStageCode: "seed", maxStageCode: "series_b" },
    });
    expect(intent.stageCodes).toEqual(["seed", "series_a", "series_b"]);
  });
});

describe("merge (pure)", () => {
  it("R. two paths, one company, every reason; ordered by canonical id; truncation is by id", () => {
    const hits: DimensionHit[] = [
      {
        companyId: companyId(2),
        tenantId: TENANT_C,
        dimension: "GEOGRAPHY",
        reasonCode: "GEOGRAPHY_OVERLAP",
      },
      {
        companyId: companyId(1),
        tenantId: TENANT_C,
        dimension: "TAXONOMY",
        reasonCode: "TAXONOMY_OVERLAP",
        matchedNode: {
          preferredNodeId: FINTECH,
          matchedNodeId: FINTECH,
          vocabularyCode: "industry",
          exact: true,
        },
      },
      {
        companyId: companyId(1),
        tenantId: TENANT_C,
        dimension: "STAGE",
        reasonCode: "STAGE_OVERLAP",
      },
      {
        companyId: companyId(1),
        tenantId: TENANT_C,
        dimension: "STAGE",
        reasonCode: "STAGE_OVERLAP",
      },
    ];
    const { candidates, truncated } = mergeDimensionHits(hits, {
      taxonomyVersion: null,
      poolMax: 10,
    });
    expect(candidates.map((c) => c.companyId)).toEqual([
      companyId(1),
      companyId(2),
    ]);
    expect(candidates[0]?.provenance.reasonCodes).toEqual([
      "STAGE_OVERLAP",
      "TAXONOMY_OVERLAP",
    ]);
    expect(candidates[0]?.provenance.matchedDimensions).toEqual([
      "STAGE",
      "TAXONOMY",
    ]);
    expect(truncated).toBe(false);
    const cut = mergeDimensionHits(hits, { taxonomyVersion: null, poolMax: 1 });
    expect(cut.candidates.map((c) => c.companyId)).toEqual([companyId(1)]);
    expect(cut.truncated).toBe(true);
  });
});

describe("structured candidate service", () => {
  it("A–G, R: high recall by union, dedupe by id, every reason kept, only ELIGIBLE rankable", async () => {
    const r = await generated(world());
    expect(ids(r)).toEqual([
      companyId(1),
      companyId(2),
      companyId(3),
      companyId(4),
      companyId(6),
      companyId(9),
    ]);
    // A: three dimensions on one company, descendant taxonomy match.
    expect(reasons(r, 1)).toEqual([
      "GEOGRAPHY_OVERLAP",
      "STAGE_OVERLAP",
      "TAXONOMY_DESCENDANT_OVERLAP",
    ]);
    expect(r.candidates[0]?.provenance.matchedNodes).toEqual([
      {
        preferredNodeId: FINTECH,
        matchedNodeId: PAYMENTS,
        vocabularyCode: "industry",
        exact: false,
      },
    ]);
    // B, C, D: one dimension each.
    expect(reasons(r, 2)).toEqual(["GEOGRAPHY_OVERLAP"]);
    expect(reasons(r, 3)).toEqual(["TAXONOMY_OVERLAP"]);
    expect(reasons(r, 4)).toEqual(["STAGE_OVERLAP"]);
    // F: unknown stage, geography match, eligible.
    expect(reasons(r, 9)).toEqual(["GEOGRAPHY_OVERLAP"]);
    // G: unknown taxonomy, stage match, eligible (D).
    expect(
      r.candidates.every((c) => c.eligibility.decision === "ELIGIBLE"),
    ).toBe(true);
    expect(r.diagnostics).toMatchObject({
      rawHits: 11,
      deduped: 7,
      eligible: 6,
      ineligible: 1,
      undetermined: 0,
      truncated: false,
      chequeSignal: "NOT_COMPUTABLE",
    });
    expect(r.diagnostics.rawHitsByDimension).toEqual({
      STAGE: 4,
      GEOGRAPHY: 5,
      TAXONOMY: 2,
      CHEQUE: 0,
    });
    expect(StructuredCandidateResultSchema.parse(r)).toEqual(r);
  });

  it("H. AVOID is never a positive source and never removes a company found another way", async () => {
    const w = world();
    const r = await generated(w);
    expect(ids(r)).not.toContain(companyId(5));
    // Company 1 also carries the avoided node; it stays.
    const one = w.companies.find((c) => c.id === companyId(1));
    one?.nodes.push({ nodeId: HARDWARE, vocabularyCode: "industry" });
    expect(ids(await generated(w))).toContain(companyId(1));
  });

  it("I, J. hard-excluded and not-ready companies are found raw and removed by REC-001, never rankable; unclassified ones become UNDETERMINED, not eligible", async () => {
    const r = await generated(withGamblingExclusion(world()));
    expect(r.diagnostics.rawHits).toBe(11);
    expect(ids(r)).toEqual([companyId(1), companyId(3)]);
    expect(ids(r)).not.toContain(companyId(6));
    expect(ids(r)).not.toContain(companyId(7));
    expect(r.diagnostics.ineligible).toBe(2);
    expect(r.diagnostics.undetermined).toBe(3);
  });

  it("K, Q. a private, undisclosed company in another organisation is never listed and never output", async () => {
    const r = await generated(world());
    expect(ids(r)).not.toContain(companyId(8));
    expect(JSON.stringify(r)).not.toContain(companyId(8));
  });

  it("P. a marketplace-visible company in another organisation and tenant is a candidate", async () => {
    const w = world();
    w.companies.push(
      company(11, {
        tenantId: "77777777-0000-4000-8000-000000000077",
        organisationId: "77777777-0000-4000-8000-000000000078",
        stage: "seed",
        country: "KE",
      }),
    );
    const r = await generated(w);
    expect(ids(r)).toContain(companyId(11));
    expect(reasons(r, 11)).toEqual(["STAGE_OVERLAP"]);
  });

  it("UNDETERMINED is not rankable: a hard rule the company cannot answer keeps it out, counted separately", async () => {
    const w = world();
    const active = w.mandates[0];
    if (active === undefined) throw new Error("fixture");
    w.mandates[0] = {
      ...active,
      constraints: [
        ...active.constraints,
        {
          dimension: "red_flag",
          operator: "IN",
          value: { kind: "codes", values: ["x"] },
          importance: "HARD_EXCLUSION",
          isHardExclusion: true,
          automatedUse: "ELIGIBLE",
        },
      ],
    };
    const r = await generated(w);
    expect(r.candidates).toEqual([]);
    expect(r.diagnostics.undetermined).toBe(6);
    expect(r.diagnostics.ineligible).toBe(1);
  });

  it("L. DRAFT preferences have no effect; no ACTIVE mandate is a typed empty result, never a DRAFT fallback", async () => {
    const r = await generated(world());
    expect(ids(r)).not.toContain(companyId(5));
    const none = await service(world({ activeIds: [] })).generate({
      actor: ACTOR,
    });
    expect(none.kind).toBe("NO_ACTIVE_MANDATE");
    expect(none.context.mandateId).toBeNull();
    const pinnedDraft = await service(world()).generate({
      actor: ACTOR,
      mandateId: DRAFT_MANDATE,
    });
    expect(pinnedDraft.kind).toBe("NO_ACTIVE_MANDATE");
  });

  it("M. an ACTIVE mandate update changes the set deterministically", async () => {
    const w = world();
    const before = ids(await generated(w));
    const active = w.mandates[0];
    if (active === undefined) throw new Error("fixture");
    w.mandates[0] = {
      ...active,
      version: 2,
      constraints: [],
      taxonomyPreferences: [],
    };
    const after = await generated(w);
    expect(ids(after)).toEqual([]);
    expect(before.length).toBe(6);
    expect(after.diagnostics.rawHits).toBe(0);
  });

  it("N, O. founder-private memory, conversation, document and public-web findings change nothing; the marker never appears", async () => {
    const w = world();
    const before = await generated(w);
    for (const c of w.companies) {
      c.founderMemory.push(
        `${MARKER}: the founder told Q they are seed and in Lagos`,
      );
      c.conversationSummary = `${MARKER}: customer leaving`;
      c.privateDocument = `${MARKER}: deck says fintech`;
      c.publicWeb.push(`${MARKER}: article says gambling`);
    }
    const during = await generated(w);
    expect({
      ...during,
      diagnostics: { ...during.diagnostics, durationMs: 0 },
    }).toEqual({
      ...before,
      diagnostics: { ...before.diagnostics, durationMs: 0 },
    });
    expect(JSON.stringify(during)).not.toContain(MARKER);
    for (const c of w.companies) {
      c.founderMemory.length = 0;
    }
    const after = await generated(w);
    expect(ids(after)).toEqual(ids(before));
  });

  it("geography: a `global` preference narrows nothing; a region preference reaches its sub-regions", async () => {
    const w = world();
    const active = w.mandates[0];
    if (active === undefined) throw new Error("fixture");
    w.mandates[0] = {
      ...active,
      constraints: [],
      taxonomyPreferences: [
        {
          nodeId: GLOBAL,
          vocabularyCode: "geography",
          preferenceStrength: "MUST",
          isExclusion: false,
          source: "user_selected",
        },
        {
          nodeId: AFRICA,
          vocabularyCode: "geography",
          preferenceStrength: "STRONG",
          isExclusion: false,
          source: "user_selected",
        },
      ],
    };
    const r = await generated(w);
    expect(ids(r)).toEqual([companyId(10)]);
    expect(reasons(r, 10)).toEqual(["GEOGRAPHY_REGION_OVERLAP"]);
    expect(r.diagnostics.rawHitsByDimension.GEOGRAPHY).toBe(1);
  });

  it("D. cheque: the seam reports NOT_COMPUTABLE and contributes nothing; a $3m raise against a $250k–$1m cheque is not excluded", async () => {
    const w = world();
    const active = w.mandates[0];
    if (active === undefined) throw new Error("fixture");
    w.mandates[0] = {
      ...active,
      constraints: [
        ...active.constraints,
        {
          dimension: "cheque.typical",
          operator: "EQ",
          value: { kind: "amount", amount: "500000", currency: "USD" },
          importance: "NEUTRAL",
          isHardExclusion: false,
          automatedUse: "ELIGIBLE",
        },
      ],
    };
    const r = await generated(w);
    expect(r.diagnostics.chequeSignal).toBe("NOT_COMPUTABLE");
    expect(r.diagnostics.rawHitsByDimension.CHEQUE).toBe(0);
    expect(
      r.candidates.every(
        (c) => !c.provenance.reasonCodes.includes("CHEQUE_OVERLAP"),
      ),
    ).toBe(true);
    expect(ids(r)).toContain(companyId(1));
  });

  it("S, T. repeat runs are identical; the pool is bounded and cut on canonical id order; retrieval is a fixed, small number of queries", async () => {
    const w = world();
    const first = await generated(w);
    for (let i = 0; i < 5; i += 1) {
      const again = await generated(w);
      expect({
        ...again,
        diagnostics: { ...again.diagnostics, durationMs: 0 },
      }).toEqual({
        ...first,
        diagnostics: { ...first.diagnostics, durationMs: 0 },
      });
    }
    const limited = await generated(w, { limit: 2 });
    expect(ids(limited).length).toBeLessThanOrEqual(2);
    expect(limited.diagnostics.truncated).toBe(true);
    expect(CANDIDATE_POOL_MAX).toBe(200);
    // One query per dimension asked, one expansion per preference node, one eligibility batch.
    w.queries.length = 0;
    await generated(w);
    expect(w.queries.sort()).toEqual([
      "companies.byCountry",
      "companies.byStage",
      "eligibility.evaluate",
      "taxonomy.expand",
      "taxonomy.subjectsByNodes",
    ]);
  });

  it("provenance carries the generator, version, dimensions, reasons and taxonomy versions on every candidate", async () => {
    const r = await generated(world());
    for (const c of r.candidates) {
      expect(c.provenance).toMatchObject({
        generatorId: "STRUCTURED_MANDATE",
        generatorVersion: "structured-mandate.v2",
        taxonomyVersion: { industry: 1, geography: 1 },
      });
      expect(c.provenance.reasonCodes.length).toBeGreaterThan(0);
      expect("score" in c).toBe(false);
      expect("rank" in c).toBe(false);
    }
    expect(r.generatorVersion).toBe("structured-mandate.v2");
    expect(r.eligibilityPolicyVersion).toBe("eligibility.v2");
  });
});
