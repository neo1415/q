import { IdentityCardSchema } from "@capital-q/contracts/q";
import { describe, expect, it } from "vitest";

import {
  createInMemoryKnownEntityStore,
  createKnownEntityIndex,
  preparedEntityIdFor,
  type PreparedEntityUpsert,
} from "../src/application/known-entities.js";
import { createPersonLookup } from "../src/application/person-lookup.js";
import type { PersonSearchRun } from "../src/application/person-search.js";
import {
  admitAssertions,
  quoteOccursIn,
  withUnknowns,
  type BriefSource,
} from "../src/domain/person-brief.js";

const NO_IMAGE = {
  status: "NOT_ATTACHED",
  assetUrl: null,
  attribution: null,
  licenseNote: null,
} as const;

const shadi: PreparedEntityUpsert = {
  profileKey: "qa-demo-shadi-qishta",
  entityKind: "PERSON",
  requiresRefresh: true,
  displayName: "Shadi Qishta",
  aliases: ["Shadi Qishta Doha", "Shadi Qishta Midmac"],
  profileUrl: "https://www.linkedin.com/in/shadi-qishta-282453a/",
  role: "Finance and business ventures executive",
  organization: null,
  location: "Doha, Qatar",
  confidence: "STRONG",
  facts: [
    {
      claim: "Public IFRS commentary",
      sourceIds: ["S02"],
      evidenceClass: "publicly documented",
    },
  ],
  sources: [
    {
      sourceId: "S01",
      url: "https://www.linkedin.com/in/shadi-qishta-282453a/",
      description: "Public professional profile",
      publishedAt: null,
      evidenceClass: "publicly documented",
    },
  ],
  quotes: [],
  image: NO_IMAGE,
  profile: {},
  lastResearchedAt: "2026-10-09T00:00:00Z",
};
const invest: PreparedEntityUpsert = {
  ...shadi,
  profileKey: "qa-demo-invest-qatar",
  entityKind: "GOVERNMENT_AGENCY",
  displayName: "Invest Qatar",
  aliases: ["Invest Qatar", "Investment Promotion Agency Qatar"],
  profileUrl: null,
  role: null,
  requiresRefresh: false,
  sources: [
    {
      description: "Agency website",
      publishedAt: null,
      evidenceClass: "official",
      sourceId: "S20",
      url: "https://www.investqatar.qa/",
    },
  ],
};

async function warmed() {
  const store = createInMemoryKnownEntityStore();
  await store.upsertPrepared(shadi);
  await store.upsertPrepared(invest);
  const index = createKnownEntityIndex({ store });
  await index.warm();
  return { store, index };
}

const webRun = {
  result: {
    outcome: "NOT_FOUND",
    card: null,
    candidates: [],
    clarifyingQuestion: null,
    elapsedMs: 5,
  },
  calls: [],
  queries: [],
  chosen: null,
  profileKey: null,
  spec: {
    name: "x",
    place: null,
    organization: null,
    role: null,
    variants: [],
  },
  budgetExceeded: false,
} as unknown as PersonSearchRun;

describe("known entity index", () => {
  it("resolves an exact alias, a variant spelling and a name+place alias with no web call", async () => {
    const { index } = await warmed();
    expect(index.lookup("Shadi Qishta").kind).toBe("FOUND");
    expect(index.lookup("shadi kishta").kind).toBe("FOUND");
    expect(index.lookup("Shadi Qishta Doha").kind).toBe("FOUND");
    expect(index.lookup("Invest Qatar").kind).toBe("FOUND");
    expect(index.lookup("Somebody Else").kind).toBe("NONE");
  });

  it("is synchronous and store-free once warm", async () => {
    const { store, index } = await warmed();
    let calls = 0;
    const counting = {
      ...store,
      findByAlias: (key: string) => {
        calls += 1;
        return store.findByAlias(key);
      },
      listPrepared: () => {
        calls += 1;
        return store.listPrepared();
      },
    };
    const warm = createKnownEntityIndex({ store: counting });
    await warm.warm();
    const before = calls;
    for (let i = 0; i < 50; i += 1) warm.lookup("Shadi Qishta");
    await warm.resolve("Invest Qatar");
    expect(calls).toBe(before);
    expect(index.size()).toBe(2);
  });

  it("derives a stable id the loader and the reader agree on", async () => {
    const { store } = await warmed();
    const ids = store.all().map((r) => r.externalPersonId);
    expect(ids).toContain(preparedEntityIdFor("qa-demo-shadi-qishta"));
  });
});

describe("person lookup order", () => {
  it("answers a prepared entity with zero web calls and a valid card", async () => {
    const { index } = await warmed();
    let webCalls = 0;
    const lookup = createPersonLookup({
      known: index,
      search: {
        search: () => {
          webCalls += 1;
          return Promise.resolve(webRun);
        },
      },
    });
    const out = await lookup.find({
      tenantId: "t",
      userId: "u",
      name: "Shadi Qishta",
      place: "Doha",
      userText: "find Shadi Qishta, Doha",
    });
    expect(out.source).toBe("KNOWN_ENTITY");
    expect(webCalls).toBe(0);
    expect(IdentityCardSchema.safeParse(out.result.card).success).toBe(true);
    expect(out.result.card?.subject.researchStatus).toBe(
      "PREPARED_PUBLIC_SEED",
    );
    expect(out.result.card?.uncertainty.join(" ")).toContain("fresh search");
  });

  it("an organisation card carries no personal role and no representative", async () => {
    const { index } = await warmed();
    const lookup = createPersonLookup({
      known: index,
      search: { search: () => Promise.resolve(webRun) },
    });
    const out = await lookup.find({
      tenantId: "t",
      userId: "u",
      name: "Invest Qatar",
      userText: "invest qatar",
    });
    expect(out.result.card?.subject.entityKind).toBe("GOVERNMENT_AGENCY");
    expect(out.result.card?.subject.role).toBeNull();
  });

  it("searches the web only on an explicit fresh search or an unknown name", async () => {
    const { index } = await warmed();
    let webCalls = 0;
    const lookup = createPersonLookup({
      known: index,
      search: {
        search: () => {
          webCalls += 1;
          return Promise.resolve(webRun);
        },
      },
    });
    await lookup.find({
      tenantId: "t",
      userId: "u",
      name: "Shadi Qishta",
      userText: "x",
      freshSearch: true,
    });
    await lookup.find({
      tenantId: "t",
      userId: "u",
      name: "Unknown Person",
      userText: "x",
    });
    expect(webCalls).toBe(2);
  });
});

describe("brief admission", () => {
  const sources: BriefSource[] = [
    {
      id: null,
      description: null,
      evidenceClass: null,
      url: "https://a.example/x",
      domain: "a.example",
      title: "A",
      publishedAt: "2026-08-01",
      retrievedAt: "2026-10-10",
      provider: "tavily",
      excerpt:
        "He said investors should watch cash conversion closely every quarter.",
    },
    {
      id: null,
      description: null,
      evidenceClass: null,
      url: "https://b.example/y",
      domain: "b.example",
      title: "B",
      publishedAt: "2019-01-01",
      retrievedAt: "2026-10-10",
      provider: "tavily",
      excerpt: "Finance director at a contracting firm.",
    },
  ];
  const now = new Date("2026-10-10T00:00:00Z");

  it("admits a view only with a quote a cited source really contains", () => {
    const good = admitAssertions(
      [
        {
          topic: "MARKET_VIEWS",
          text: "Stresses cash conversion",
          assertionClass: "PUBLIC_STATEMENT",
          sourceRefs: [0],
          quote: "investors should watch cash conversion closely",
        },
      ],
      sources,
      now,
    );
    expect(good.admitted).toHaveLength(1);
    const invented = admitAssertions(
      [
        {
          topic: "INVESTMENT_INTERESTS",
          text: "Backs early-stage fintech",
          assertionClass: "REASONABLE_INFERENCE",
          sourceRefs: [0],
          quote: null,
        },
      ],
      sources,
      now,
    );
    expect(invented.admitted).toHaveLength(0);
    expect(invented.rejected[0]?.reason).toContain("quote");
  });

  it("a single-domain 'verified fact' is only a public statement; old sources go stale", () => {
    const out = admitAssertions(
      [
        {
          topic: "BACKGROUND",
          text: "x",
          assertionClass: "VERIFIED_PUBLIC_FACT",
          sourceRefs: [0],
          quote: "watch cash conversion closely",
        },
        {
          topic: "CURRENT_ROLE",
          text: "Finance director",
          assertionClass: "PUBLIC_STATEMENT",
          sourceRefs: [1],
          quote: "Finance director at a contracting firm",
        },
      ],
      sources,
      now,
    );
    expect(out.admitted[0]?.assertionClass).toBe("PUBLIC_STATEMENT");
    expect(out.admitted[1]?.assertionClass).toBe("CONTRADICTORY_OR_STALE");
  });

  it("records unknown for topics nothing supports and never invents a source ref", () => {
    const out = admitAssertions(
      [
        {
          topic: "SECTORS",
          text: "Fintech",
          assertionClass: "PUBLIC_STATEMENT",
          sourceRefs: [9],
          quote: "fintech sector focus",
        },
      ],
      sources,
      now,
    );
    expect(out.admitted).toHaveLength(0);
    const all = withUnknowns(out.admitted, "Shadi");
    expect(all.every((a) => a.assertionClass === "UNKNOWN")).toBe(true);
    expect(quoteOccursIn("cash  conversion", "Cash conversion matters")).toBe(
      true,
    );
  });
});
