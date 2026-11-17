import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createCounterpartDiscovery } from "../src/application/counterpart-discovery.js";
import {
  createInMemoryKnownEntityStore,
  createKnownEntityIndex,
} from "../src/application/known-entities.js";
import { createPersonSearch } from "../src/application/person-search.js";
import type { PublicWebSearchRequest } from "../src/contracts.js";
import {
  composeEgressQuery,
  createPublicWebResearchService,
  type ResearchCommand,
  type ResearchEvidenceRecorder,
  type ResearchSubject,
} from "../src/index.js";
import type { PublicWebResearchProvider } from "../src/ports.js";
import { createFakeResearchProvider } from "../src/providers/fake.js";
import { createFallbackResearchProvider } from "../src/providers/fallback.js";
import {
  createLastResortSearchProvider,
  createModelHostedSearchProvider,
  type ModelHostedSearchCall,
} from "../src/providers/model-hosted-search.js";

/**
 * The outbound Context Firewall's narrow private layer (CQ-Q-RESEARCH-001
 * §9-§10): a word that only private material this run holds says -- a
 * figure from management accounts, a person named in a private document,
 * an internal note's phrasing -- reaches no search provider (Serper, Brave,
 * Tavily, the model-hosted fallback), in any letter case. A word a public
 * source also holds (the person's words this turn, the public identity,
 * place names, research vocabulary) is kept: detailed public queries go
 * out unchanged. Fakes only; no network.
 */

const actor: ActorContext = ActorContextSchema.parse({
  userId: "44444444-4444-4444-8444-444444444444",
  tenantId: "33333333-3333-4333-8333-333333333333",
  organisationId: "22222222-2222-4222-8222-222222222222",
  actorType: "HUMAN",
});

const kibo: ResearchSubject = {
  kind: "COMPANY",
  companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "Kibo Health Systems",
  websiteUrl: "https://www.kibohealth.example",
  headquartersCountry: "NG",
  identityAuthorised: true,
  persistAsEvidence: false,
};

/** Private material the run read: management accounts, a board pack, a note. */
const MANAGEMENT_ACCOUNTS =
  "Management accounts Q3: cash USD 840,000; monthly burn 120k; Runway 7 months; payroll 64,500.";
const BOARD_PACK =
  "Board pack (confidential): Amina Okafor joins as CFO in March; Zelalem Haile leaves.";
const INTERNAL_NOTE =
  "Internal note: Project Bluefinch -- exit talks with Halvard Capital, keep quiet.";
const PRIVATE_TEXT = [MANAGEMENT_ACCOUNTS, BOARD_PACK, INTERNAL_NOTE];
/** Words that must never reach a provider, any case. */
const PRIVATE_WORDS = [
  "840",
  "120k",
  "64,500",
  "runway",
  "burn",
  "payroll",
  "amina",
  "okafor",
  "zelalem",
  "haile",
  "bluefinch",
  "halvard",
];

const noEvidence: ResearchEvidenceRecorder = {
  listSources: () => Promise.resolve([]),
  registerSource: () => Promise.resolve({ id: "src-1" }),
  listItems: () => Promise.resolve([]),
  createItem: () => Promise.resolve({ id: "item-1" }),
};

function named(
  code: PublicWebResearchProvider["code"],
  provider: PublicWebResearchProvider,
): PublicWebResearchProvider {
  return {
    code,
    search: (request, context) => provider.search(request, context),
    extract: (request, context) => provider.extract(request, context),
  };
}

/** Serper, Brave and Tavily all refuse; the hosted search answers last. */
function everyProvider() {
  const indexes = (["serper", "brave", "tavily"] as const).map((code) => ({
    code,
    fake: createFakeResearchProvider({
      pages: [],
      behaviour: { kind: "FAIL_SEARCH", failureClass: "AUTHENTICATION" },
    }),
  }));
  const hostedCalls: ModelHostedSearchCall[] = [];
  const provider = createLastResortSearchProvider({
    primary: createFallbackResearchProvider({
      providers: indexes.map((one) => named(one.code, one.fake)),
    }),
    lastResort: createModelHostedSearchProvider({
      search: (call) => {
        hostedCalls.push(call);
        return Promise.resolve({
          ok: true,
          sources: [
            {
              url: "https://kibohealth.example/news",
              title: "Kibo Health Systems news",
              quotedText: "Kibo Health Systems raised a seed round.",
              pageAge: null,
            },
          ],
          latencyMs: 1,
        });
      },
    }),
  });
  const sent = () => [
    ...indexes.flatMap((one) => one.fake.searches.map((s) => s.query)),
    ...hostedCalls.map((call) => call.query),
  ];
  return { provider, indexes, hostedCalls, sent };
}

function service(provider: PublicWebResearchProvider) {
  return createPublicWebResearchService({
    provider,
    evidence: noEvidence,
    clock: () => new Date("2026-11-17T12:00:00.000Z"),
  });
}

const reachedAny = (sent: readonly string[], words: readonly string[]) => {
  const all = sent.join(" | ").toLowerCase();
  return words.filter((word) => all.includes(word.toLowerCase()));
};

describe("composeEgressQuery with private material", () => {
  it("withholds a private figure and its words from management accounts", () => {
    const outcome = composeEgressQuery({
      requestedQuery:
        "Kibo Health Systems RUNWAY 7 months Burn 120K payroll 64,500 funding news",
      userText: "any funding news on us?",
      // They talked about their accounts a turn before; not this request.
      earlierUserText: ["our runway is 7 months and burn is 120k, payroll too"],
      publicIdentity: ["Kibo Health Systems"],
      privateText: PRIVATE_TEXT,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.query).toBe("kibo health systems funding news");
    expect(reachedAny([outcome.query], PRIVATE_WORDS)).toEqual([]);
    expect(outcome.privateTokens).toBeGreaterThanOrEqual(3);
  });

  it("withholds a person named only in a private document", () => {
    const outcome = composeEgressQuery({
      requestedQuery: "amina OKAFOR Kibo Health Systems",
      userText: "look her up",
      earlierUserText: ["what did the board pack say about Amina Okafor?"],
      publicIdentity: ["Kibo Health Systems"],
      privateText: PRIVATE_TEXT,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(reachedAny([outcome.query], PRIVATE_WORDS)).toEqual([]);
    expect(outcome.privateTokens).toBe(2);
  });

  it("withholds an internal note's phrasing", () => {
    const outcome = composeEgressQuery({
      requestedQuery:
        "Kibo Health Systems Project BLUEFINCH Halvard exit talks",
      userText: "search for news about that",
      earlierUserText: ["remember Project Bluefinch with Halvard"],
      publicIdentity: ["Kibo Health Systems"],
      privateText: PRIVATE_TEXT,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(reachedAny([outcome.query], PRIVATE_WORDS)).toEqual([]);
    expect(outcome.query.toLowerCase()).not.toContain("project");
  });

  it("keeps a word the person typed this turn, even when a private document also holds it", () => {
    const outcome = composeEgressQuery({
      requestedQuery: "Amina Okafor CFO Lagos",
      userText: "Find Amina Okafor, CFO, Lagos",
      publicIdentity: [],
      privateText: PRIVATE_TEXT,
    });
    expect(outcome).toMatchObject({
      ok: true,
      query: "amina okafor cfo lagos",
      droppedTokens: 0,
      privateTokens: 0,
    });
  });

  it.each([
    [
      "Tensorgate",
      "Research Tensorgate confidential AI inference hardware enclave attestation regulated banks 2026 seed round",
      "Tensorgate confidential AI inference hardware enclave attestation regulated banks 2026 seed round",
      // Their own deck uses many of the same words: still public, still sent.
      "Tensorgate deck (confidential): inference hardware revenue 2.1m; regulated banks pipeline; seed round of 3m",
      // A deep-research question: its year travels (egress.ts YEAR).
      true,
    ],
    [
      "Nixo",
      "Nixo forward-deployed engineering services margin AI companies San Francisco",
      "Nixo forward-deployed engineering services margin AI companies San Francisco",
      "Nixo management accounts: services margin 38%; San Francisco office lease; engineering payroll 410k",
      false,
    ],
  ])(
    "a detailed public query about %s goes out intact",
    (identity, userText, requestedQuery, privateDoc, researchVocabulary) => {
      const without = composeEgressQuery({
        requestedQuery,
        userText,
        publicIdentity: [identity],
        researchVocabulary,
      });
      const withPrivate = composeEgressQuery({
        requestedQuery,
        userText,
        publicIdentity: [identity],
        researchVocabulary,
        privateText: [privateDoc, ...PRIVATE_TEXT],
      });
      expect(withPrivate).toEqual(without);
      expect(withPrivate).toMatchObject({
        ok: true,
        query: requestedQuery.toLowerCase(),
        droppedTokens: 0,
        privateTokens: 0,
      });
    },
  );
});

describe("research service: no provider receives a private word", () => {
  const command = (
    overrides: Partial<ResearchCommand> = {},
  ): ResearchCommand => ({
    actor,
    runId: "run-private-egress",
    correlationId: "cor_private_egress",
    requestedQuery:
      "Kibo Health Systems runway BURN 120k Amina Okafor Project Bluefinch Halvard funding news",
    userText: "Find funding news on Kibo Health Systems",
    earlierUserText: [
      "Our runway is 7 months, burn 120k a month",
      "The board pack says Amina Okafor joins as CFO",
      "Note: Project Bluefinch with Halvard",
    ],
    subject: kibo,
    extractCount: 1,
    privateText: PRIVATE_TEXT,
    ...overrides,
  });

  it("Serper, Brave, Tavily and the hosted fallback all receive only public words", async () => {
    const chain = everyProvider();
    const outcome = await service(chain.provider).research(command());
    expect(outcome.status).toBe("OK");
    // Every index was asked (and refused), then the hosted search.
    for (const one of chain.indexes)
      expect(one.fake.searches.length).toBeGreaterThan(0);
    expect(chain.hostedCalls.length).toBe(1);
    expect(reachedAny(chain.sent(), PRIVATE_WORDS)).toEqual([]);
    expect(
      reachedAny(chain.sent(), ["management accounts", "board pack"]),
    ).toEqual([]);
  });

  it("a legitimate public query (company name + funding news) goes through unchanged", async () => {
    const plain = everyProvider();
    await service(plain.provider).research(
      command({
        requestedQuery: "Kibo Health Systems funding news",
        earlierUserText: undefined,
        privateText: undefined,
      }),
    );
    const guarded = everyProvider();
    await service(guarded.provider).research(
      command({ requestedQuery: "Kibo Health Systems funding news" }),
    );
    expect(guarded.sent()).toEqual(plain.sent());
    expect(guarded.sent()[0]).toBe("kibo health systems funding news");
  });
});

describe("person search and counterpart discovery: private words stay", () => {
  function recordingIndex(code: PublicWebResearchProvider["code"]) {
    const requests: PublicWebSearchRequest[] = [];
    const provider: PublicWebResearchProvider = {
      code,
      search: (request) => {
        requests.push(request);
        return Promise.resolve({ hits: [], latencyMs: 0 });
      },
      extract: () =>
        Promise.resolve({ pages: [], failedUrls: [], latencyMs: 0 }),
    };
    return { provider, requests };
  }

  it("a name the model took from a private document is not searched", async () => {
    const serper = recordingIndex("serper");
    const tavily = recordingIndex("tavily");
    await createPersonSearch({
      providers: [serper.provider, tavily.provider],
    }).search({
      tenantId: actor.tenantId,
      userId: actor.userId,
      name: "Zelalem Haile",
      userText: "who is leaving, look them up",
      privateText: PRIVATE_TEXT,
    });
    const sent = [...serper.requests, ...tavily.requests].map((r) => r.query);
    expect(reachedAny(sent, PRIVATE_WORDS)).toEqual([]);
  });

  it("a name the member typed this turn is searched as before", async () => {
    const serper = recordingIndex("serper");
    await createPersonSearch({ providers: [serper.provider] }).search({
      tenantId: actor.tenantId,
      userId: actor.userId,
      name: "Amina Okafor",
      place: "Lagos",
      userText: "find Amina Okafor in Lagos",
      privateText: PRIVATE_TEXT,
    });
    expect(serper.requests.map((r) => r.query).join(" | ")).toContain(
      "amina okafor",
    );
  });

  it("counterpart discovery sends no region or kind word only private material holds", async () => {
    const web = createFakeResearchProvider({ pages: [] });
    const known = createKnownEntityIndex({
      store: createInMemoryKnownEntityStore(),
    });
    await known.warm();
    const discovery = createCounterpartDiscovery({
      known,
      providers: [web],
    });
    await discovery.discover({
      tenantId: actor.tenantId,
      userId: actor.userId,
      regions: ["Gulf", "Halvard"],
      kinds: ["family offices", "Bluefinch"],
      sector: "fintech",
      userText: "find Gulf family offices for this",
      privateText: PRIVATE_TEXT,
    });
    const sent = web.searches.map((s) => s.query);
    expect(sent.length).toBeGreaterThan(0);
    expect(reachedAny(sent, PRIVATE_WORDS)).toEqual([]);
    expect(sent.join(" | ").toLowerCase()).toContain("gulf");
    expect(sent.join(" | ").toLowerCase()).toContain("family offices");
  });
});
