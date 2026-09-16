import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import { createDiscoveryService } from "../src/application/discover.js";
import { DISCOVERY_RANKING_VERSION } from "../src/contracts.js";
import {
  declaredProfileFit,
  explicitFit,
  isExcluded,
  stageInRange,
} from "../src/domain/fit.js";
import type {
  CandidateCompany,
  CandidateInvestor,
  DiscoveryRepository,
  OwnMandate,
} from "../src/ports.js";

const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  organisationId: "33333333-3333-4333-8333-333333333333",
  membershipId: "44444444-4444-4444-8444-444444444444",
  actorType: "HUMAN",
} as unknown as ActorContext;

const FINTECH = "aaaaaaaa-0000-4000-8000-000000000001";
const LOGISTICS = "aaaaaaaa-0000-4000-8000-000000000002";
const NIGERIA = "aaaaaaaa-0000-4000-8000-000000000003";
const GAMBLING = "aaaaaaaa-0000-4000-8000-000000000004";

function company(
  id: string,
  overrides: Partial<CandidateCompany> = {},
): CandidateCompany {
  return {
    companyId: id,
    canonicalName: `Company ${id.slice(-1)}`,
    websiteUrl: null,
    headquartersCountry: "NG",
    currentStageCode: "seed",
    shortDescription: null,
    classifications: [],
    ...overrides,
  };
}

function investor(
  id: string,
  overrides: Partial<CandidateInvestor> = {},
): CandidateInvestor {
  return {
    investorOrganisationId: id,
    displayName: `Investor ${id.slice(-1)}`,
    investorType: "VC",
    websiteUrl: null,
    hqCountry: null,
    publicDescription: null,
    deploymentState: null,
    ...overrides,
  };
}

function repository(input: {
  readonly companies?: readonly CandidateCompany[];
  readonly investors?: readonly CandidateInvestor[];
  readonly mandate?: OwnMandate | null;
}): DiscoveryRepository {
  return {
    discoverableCompanies: () => Promise.resolve(input.companies ?? []),
    discoverableInvestors: () => Promise.resolve(input.investors ?? []),
    ownActiveMandate: () => Promise.resolve(input.mandate ?? null),
    ownSide: () => Promise.resolve("INVESTOR"),
  };
}

const MANDATE: OwnMandate = {
  mandateId: "bbbbbbbb-0000-4000-8000-000000000001",
  minStageCode: "pre_seed",
  maxStageCode: "series_a",
  preferences: [
    {
      nodeId: FINTECH,
      vocabulary: "industry",
      label: "Fintech",
      strength: "STRONG",
      isExclusion: false,
    },
    {
      nodeId: NIGERIA,
      vocabulary: "geography",
      label: "Nigeria",
      strength: "MUST",
      isExclusion: false,
    },
    {
      nodeId: GAMBLING,
      vocabulary: "industry",
      label: "Gambling",
      strength: "STRONG",
      isExclusion: true,
    },
  ],
};

describe("declared stage ranges", () => {
  it("includes both ends and treats an open end as open", () => {
    expect(stageInRange("pre_seed", "pre_seed", "series_a")).toBe(true);
    expect(stageInRange("series_a", "pre_seed", "series_a")).toBe(true);
    expect(stageInRange("series_b", "pre_seed", "series_a")).toBe(false);
    expect(stageInRange("series_c_plus", "series_b", null)).toBe(true);
    expect(stageInRange("pre_seed", null, "seed")).toBe(true);
  });

  it("earns nothing from a stage nobody declared, and never penalises it", () => {
    expect(stageInRange(null, "pre_seed", "series_a")).toBe(false);
    expect(stageInRange("seed", null, null)).toBe(false);
    // An unrecognised code is unknown, not wrong.
    expect(stageInRange("growth", "pre_seed", "series_c_plus")).toBe(false);
  });
});

describe("a declared hard exclusion", () => {
  it("removes a counterpart outright rather than scoring it low", () => {
    expect(
      isExcluded(MANDATE.preferences, [
        { nodeId: GAMBLING, vocabulary: "industry", label: "Gambling" },
      ]),
    ).toBe(true);
    expect(
      isExcluded(MANDATE.preferences, [
        { nodeId: FINTECH, vocabulary: "industry", label: "Fintech" },
      ]),
    ).toBe(false);
    expect(isExcluded([], [])).toBe(false);
  });
});

describe("explicit fit", () => {
  it("names at most one reason per vocabulary, strongest first, in a stable order", () => {
    const fit = explicitFit({
      preferences: MANDATE.preferences,
      classifications: [
        { nodeId: FINTECH, vocabulary: "industry", label: "Fintech" },
        { nodeId: LOGISTICS, vocabulary: "industry", label: "Logistics" },
        { nodeId: NIGERIA, vocabulary: "geography", label: "Nigeria" },
      ],
      companyStage: "seed",
      minStage: MANDATE.minStageCode,
      maxStage: MANDATE.maxStageCode,
    });
    expect(fit.reasons.map((reason) => reason.kind)).toEqual([
      "STAGE_IN_RANGE",
      "GEOGRAPHY_MATCH",
      "SECTOR_MATCH",
    ]);
    expect(fit.reasons.map((reason) => reason.detail)).toEqual([
      "seed",
      "Nigeria",
      "Fintech",
    ]);
    // stage 30 + geography MUST 40 + sector STRONG 25
    expect(fit.score).toBe(95);
  });

  it("gives nothing, and no reason, when nothing was declared in common", () => {
    const fit = explicitFit({
      preferences: MANDATE.preferences,
      classifications: [
        { nodeId: LOGISTICS, vocabulary: "industry", label: "Logistics" },
      ],
      companyStage: "series_b",
      minStage: MANDATE.minStageCode,
      maxStage: MANDATE.maxStageCode,
    });
    expect(fit).toEqual({ score: 0, reasons: [] });
  });

  it("is reproducible: the same inputs give the same score and the same words", () => {
    const input = {
      preferences: MANDATE.preferences,
      classifications: [
        { nodeId: NIGERIA, vocabulary: "geography", label: "Nigeria" },
      ],
      companyStage: "seed",
      minStage: MANDATE.minStageCode,
      maxStage: MANDATE.maxStageCode,
    };
    expect(explicitFit(input)).toEqual(explicitFit(input));
  });
});

describe("what a founder may rank an investor on", () => {
  it("uses the declared profile, and has nowhere to put a mandate", () => {
    const deploying = declaredProfileFit({
      deploymentState: "ACTIVELY_INVESTING",
      publicDescription: "We back African fintech.",
      websiteUrl: "https://apex.example",
      hqCountry: "GB",
    });
    expect(deploying.reasons.map((reason) => reason.kind)).toEqual([
      "DECLARED_DEPLOYING",
      "PROFILE_COMPLETE",
    ]);
    expect(deploying.score).toBe(30);

    const quiet = declaredProfileFit({
      deploymentState: "PAUSED",
      publicDescription: null,
      websiteUrl: null,
      hqCountry: null,
    });
    expect(quiet).toEqual({ score: 0, reasons: [] });
  });
});

describe("the company slate", () => {
  it("removes an excluded company, ranks the rest, and never returns a score to the caller's screen", async () => {
    const service = createDiscoveryService({
      repository: repository({
        mandate: MANDATE,
        companies: [
          company("aaaaaaaa-1111-4000-8000-00000000000a", {
            classifications: [
              { nodeId: GAMBLING, vocabulary: "industry", label: "Gambling" },
            ],
          }),
          company("aaaaaaaa-1111-4000-8000-00000000000b", {
            classifications: [
              { nodeId: FINTECH, vocabulary: "industry", label: "Fintech" },
              { nodeId: NIGERIA, vocabulary: "geography", label: "Nigeria" },
            ],
          }),
          company("aaaaaaaa-1111-4000-8000-00000000000c", {
            currentStageCode: "series_b",
            classifications: [],
          }),
        ],
      }),
    });
    const slate = await service.discoverCompanies({ actor: ACTOR });
    expect(slate.rankingVersion).toBe(DISCOVERY_RANKING_VERSION);
    expect(slate.items.map((item) => item.companyId)).toEqual([
      "aaaaaaaa-1111-4000-8000-00000000000b",
      "aaaaaaaa-1111-4000-8000-00000000000c",
    ]);
    expect(slate.items[0]?.reasons.length).toBeGreaterThan(0);
    // The one with nothing in common is still eligible, just last and
    // unexplained. Eligible is not the same as recommended.
    expect(slate.items[1]?.reasons).toEqual([]);
  });

  it("says why a slate is unmatched rather than pretending it is a shortlist", async () => {
    const service = createDiscoveryService({
      repository: repository({
        mandate: null,
        companies: [company("aaaaaaaa-1111-4000-8000-00000000000b")],
      }),
    });
    const slate = await service.discoverCompanies({ actor: ACTOR });
    expect(slate.notes).toEqual(["NO_ACTIVE_MANDATE"]);
    expect(slate.items).toHaveLength(1);
    expect(slate.items[0]?.reasons).toEqual([]);
  });

  it("says when nobody is discoverable at all", async () => {
    const service = createDiscoveryService({ repository: repository({}) });
    const slate = await service.discoverCompanies({ actor: ACTOR });
    expect(slate.notes).toEqual(["NO_DISCOVERABLE_COUNTERPARTS"]);
    expect(slate.items).toEqual([]);
  });

  it("gives the same order twice, and breaks ties by id rather than by luck", async () => {
    const tied = [
      company("aaaaaaaa-1111-4000-8000-0000000000ff"),
      company("aaaaaaaa-1111-4000-8000-0000000000aa"),
      company("aaaaaaaa-1111-4000-8000-0000000000bb"),
    ];
    const service = createDiscoveryService({
      repository: repository({ companies: tied, mandate: null }),
    });
    const first = await service.discoverCompanies({ actor: ACTOR });
    const second = await service.discoverCompanies({ actor: ACTOR });
    expect(first.items.map((item) => item.companyId)).toEqual(
      second.items.map((item) => item.companyId),
    );
    expect(first.items.map((item) => item.companyId)).toEqual([
      "aaaaaaaa-1111-4000-8000-0000000000aa",
      "aaaaaaaa-1111-4000-8000-0000000000bb",
      "aaaaaaaa-1111-4000-8000-0000000000ff",
    ]);
  });

  it("lets the disclosure layer have the last word", async () => {
    const service = createDiscoveryService({
      repository: repository({
        mandate: null,
        companies: [
          company("aaaaaaaa-1111-4000-8000-00000000000a"),
          company("aaaaaaaa-1111-4000-8000-00000000000b"),
        ],
      }),
      disclosure: {
        permitted: (_actor, resources) =>
          Promise.resolve(
            resources.map((resource) =>
              resource.id.endsWith("b") ? true : false,
            ),
          ),
      },
    });
    const slate = await service.discoverCompanies({ actor: ACTOR });
    expect(slate.items.map((item) => item.companyId)).toEqual([
      "aaaaaaaa-1111-4000-8000-00000000000b",
    ]);
  });
});

describe("the investor slate", () => {
  it("always says it was ranked on the declared profile alone", async () => {
    const service = createDiscoveryService({
      repository: repository({
        investors: [
          investor("cccccccc-1111-4000-8000-00000000000a", {
            deploymentState: "ACTIVELY_INVESTING",
          }),
          investor("cccccccc-1111-4000-8000-00000000000b"),
        ],
      }),
    });
    const slate = await service.discoverInvestors({ actor: ACTOR });
    expect(slate.notes).toContain("RANKED_ON_DECLARED_PROFILE_ONLY");
    // The one who says they are deploying comes first.
    expect(slate.items[0]?.investorOrganisationId).toBe(
      "cccccccc-1111-4000-8000-00000000000a",
    );
  });

  it("never reads a mandate: the repository is not even asked for one", async () => {
    let mandateReads = 0;
    const service = createDiscoveryService({
      repository: {
        discoverableCompanies: () => Promise.resolve([]),
        discoverableInvestors: () =>
          Promise.resolve([investor("cccccccc-1111-4000-8000-00000000000a")]),
        ownActiveMandate: () => {
          mandateReads += 1;
          return Promise.resolve(null);
        },
        ownSide: () => Promise.resolve("FOUNDER"),
      },
    });
    await service.discoverInvestors({ actor: ACTOR });
    expect(mandateReads).toBe(0);
  });
});

describe("paging", () => {
  it("bounds the page and hands back a keyset cursor, never an offset", async () => {
    const many = Array.from({ length: 5 }, (_value, index) =>
      company(`aaaaaaaa-1111-4000-8000-00000000000${String(index)}`),
    );
    const service = createDiscoveryService({
      repository: repository({ companies: many, mandate: null }),
    });
    const slate = await service.discoverCompanies({ actor: ACTOR, limit: 2 });
    expect(slate.items).toHaveLength(2);
    expect(slate.nextCursor).toBe(slate.items[1]?.companyId);

    const whole = await service.discoverCompanies({ actor: ACTOR, limit: 50 });
    expect(whole.items).toHaveLength(5);
    expect(whole.nextCursor).toBeNull();
  });
});
