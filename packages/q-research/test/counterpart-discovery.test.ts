import { describe, expect, it } from "vitest";

import {
  createCounterpartDiscovery,
  publicTerm,
} from "../src/application/counterpart-discovery.js";
import {
  createInMemoryKnownEntityStore,
  createKnownEntityIndex,
  type PreparedEntityUpsert,
} from "../src/application/known-entities.js";
import { externalPersonIdFor } from "../src/application/person-search.js";
import { regionCountries } from "../src/domain/geography.js";
import { createFakeResearchProvider } from "../src/providers/fake.js";

const NO_IMAGE = {
  status: "NOT_ATTACHED",
  assetUrl: null,
  attribution: null,
  licenseNote: null,
} as const;

function entity(
  partial: Partial<PreparedEntityUpsert> &
    Pick<PreparedEntityUpsert, "profileKey" | "displayName" | "entityKind">,
  oneLine: string,
): PreparedEntityUpsert {
  return {
    requiresRefresh: true,
    aliases: [],
    profileUrl: null,
    role: null,
    organization: null,
    location: null,
    confidence: "STRONG",
    facts: [],
    sources: [
      {
        sourceId: "S01",
        url: `https://example.org/${partial.profileKey}`,
        description: "Public page",
        publishedAt: null,
        evidenceClass: "publicly documented",
      },
    ],
    quotes: [],
    image: NO_IMAGE,
    profile: { oneLine },
    lastResearchedAt: "2026-10-09T00:00:00Z",
    ...partial,
  };
}

// Mirrors the prepared Qatar five as the seed loader stores them: place often
// lives only in the one-line description, never as a field.
const FIVE: readonly PreparedEntityUpsert[] = [
  entity(
    {
      profileKey: "shadi",
      entityKind: "PERSON",
      displayName: "Shadi Qishta",
      aliases: ["Shadi Qishta Doha"],
    },
    "Doha-based finance and business-ventures executive who writes publicly about financial transparency.",
  ),
  entity(
    {
      profileKey: "qinvest",
      entityKind: "ORGANIZATION",
      displayName: "QInvest LLC",
      aliases: ["QInvest", "Q Invest"],
    },
    "Qatar-based Islamic investment group spanning investment banking, principal investments and asset management.",
  ),
  entity(
    {
      profileKey: "taslaq",
      entityKind: "PERSON",
      displayName: "Muhannad Taslaq",
      role: "Director of Investments",
      organization: "Alchemist Doha",
      location: "Doha, Qatar",
      profileUrl: "https://www.linkedin.com/in/muhannadtaslaq/",
    },
    "Alchemist Doha's Director of Investments, backing early-stage tech startups as they reach investors and scale.",
  ),
  entity(
    {
      profileKey: "investqatar",
      entityKind: "GOVERNMENT_AGENCY",
      displayName: "Invest Qatar",
      aliases: ["IPA Qatar"],
      location: "Qatar",
    },
    "Qatar's national investment promotion agency, helping companies enter and grow in Qatar; not a venture fund.",
  ),
  entity(
    {
      profileKey: "alrayan",
      entityKind: "ORGANIZATION",
      displayName: "AlRayan Investment LLC",
      aliases: ["AlRayan Investment", "Al Rayan Investment"],
      location: "Qatar",
    },
    "Qatar investment and advisory firm owned by AlRayan Bank, covering asset management, sukuk and M&A advisory.",
  ),
];

async function index() {
  const store = createInMemoryKnownEntityStore();
  for (const one of FIVE) await store.upsertPrepared(one);
  const known = createKnownEntityIndex({ store });
  await known.warm();
  return known;
}

const SCOPE = { tenantId: "t-1", userId: "u-1" };
const TOP_THREE = ["AlRayan Investment LLC", "Muhannad Taslaq", "QInvest LLC"];
const names = (found: {
  candidates: readonly { card: { subject: { displayName: string } } }[];
}) => found.candidates.map((one) => one.card.subject.displayName);

describe("investor discovery by meaning", () => {
  it.each([
    ["Arab"],
    ["Gulf"],
    ["Middle Eastern"],
    ["GCC"],
    ["Qatar"],
    ["from the region", "Arab world"],
  ])("maps %s to the Qatar investors with no web call", async (...regions) => {
    const web = createFakeResearchProvider({ pages: [] });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({ ...SCOPE, regions, count: 3 });
    expect(found.outcome).toBe("FOUND");
    expect(names(found).sort()).toEqual(TOP_THREE);
    // Prepared entities suffice: not a single web search, and the agency
    // and the finance executive (not an investor) are not in the three.
    expect(found.webSearched).toBe(false);
    expect(web.searches).toHaveLength(0);
    expect(names(found)).not.toContain("Invest Qatar");
    expect(names(found)).not.toContain("Shadi Qishta");
  });

  it("ranks funds above the person, and every card can be rehearsed", async () => {
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Arab"],
      sector: "fintech",
      count: 3,
    });
    expect(names(found)[2]).toBe("Muhannad Taslaq");
    for (const one of found.candidates) {
      expect(one.card.actions).toContain("REHEARSE");
      expect(one.card.subject.externalPersonId).toMatch(/^[0-9a-f-]{36}$/u);
      // Soft words; no claim of interest, no figures.
      expect(one.fit.join(" ")).not.toMatch(/\binterested\b|\d/u);
      expect(one.fit.length).toBeGreaterThan(0);
    }
    const taslaq = found.candidates.find(
      (one) => one.card.subject.displayName === "Muhannad Taslaq",
    );
    expect(taslaq?.fit.join(" ")).toContain("Based in Qatar");
    expect(taslaq?.fit.join(" ")).toContain("not confirmed");
  });

  it("honours the count, with a maximum of five", async () => {
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [],
    });
    const two = await discovery.discover({
      ...SCOPE,
      regions: ["Arab"],
      count: 2,
    });
    expect(two.candidates).toHaveLength(2);
    expect(names(two)).not.toContain("Muhannad Taslaq");
    const lots = await discovery.discover({
      ...SCOPE,
      regions: ["Arab"],
      count: 50,
    });
    // Three investors, then the agency as the last, labelled, door-opener.
    expect(lots.candidates).toHaveLength(4);
    const last = lots.candidates[3];
    expect(last?.role).toBe("DOOR_OPENER");
    expect(last?.fit.join(" ")).toContain("Not a fund");
  });

  it("fills only the empty slots from the web, deduped against known entities", async () => {
    const web = createFakeResearchProvider({
      pages: [
        {
          url: "https://www.linkedin.com/company/qinvest-llc/",
          title: "QInvest - LinkedIn",
          snippet: "QInvest is an investment group in Doha, Qatar.",
          text: "",
        },
        {
          url: "https://www.linkedin.com/company/qatar-venture-fund/",
          title: "Qatar Venture Fund | LinkedIn",
          snippet: "Venture capital fund investing in startups in Doha, Qatar.",
          text: "",
        },
        {
          url: "https://www.linkedin.com/company/qatar-venture-fund/",
          title: "Qatar Venture Fund | LinkedIn",
          snippet: "Venture capital fund investing in startups in Doha, Qatar.",
          text: "",
        },
        {
          url: "https://www.example.com/best-vcs-in-qatar",
          title: "Best VCs in Qatar",
          snippet: "A list of investors in Qatar",
          text: "",
        },
        {
          url: "https://www.linkedin.com/company/london-capital/",
          title: "London Capital | LinkedIn",
          snippet: "Investment firm in London, United Kingdom.",
          text: "",
        },
      ],
    });
    const saved: string[] = [];
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
      persist: (scope, input) => {
        saved.push(input.profileKey);
        expect(scope).toEqual(SCOPE);
        return Promise.resolve({});
      },
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Gulf"],
      sector: "fintech",
      count: 4,
    });
    expect(web.searches).toHaveLength(1);
    expect(found.webSearched).toBe(true);
    // Three prepared, one new from the web: QInvest is not repeated, the
    // list article and the London firm are not investors in the region.
    expect(names(found).sort()).toEqual(
      [...TOP_THREE, "Qatar Venture Fund"].sort(),
    );
    const fund = found.candidates.find((one) => one.source === "WEB");
    expect(fund?.card.subject.displayName).toBe("Qatar Venture Fund");
    expect(fund?.card.subject.researchStatus).toBe("RESEARCHED");
    expect(fund?.card.actions).toContain("REHEARSE");
    expect(fund?.card.subject.externalPersonId).toBe(
      externalPersonIdFor(
        SCOPE.tenantId,
        SCOPE.userId,
        "discover:org:qatar-venture-fund",
      ),
    );
    expect(saved).toEqual(["discover:org:qatar-venture-fund"]);
  });

  it("does not offer a rehearsal for a web lead it could not store", async () => {
    const web = createFakeResearchProvider({
      pages: [
        {
          url: "https://www.linkedin.com/company/qatar-venture-fund/",
          title: "Qatar Venture Fund | LinkedIn",
          snippet: "Venture capital fund in Doha, Qatar.",
          text: "",
        },
      ],
    });
    const discovery = createCounterpartDiscovery({
      known: createKnownEntityIndex({
        store: createInMemoryKnownEntityStore(),
      }),
      providers: [web],
      persist: () => Promise.reject(new Error("db down")),
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Qatar"],
      count: 3,
    });
    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0]?.card.actions).toEqual(["RESEARCH_FURTHER"]);
  });

  it("only region words and public taxonomy terms can leave in the web query", async () => {
    const web = createFakeResearchProvider({ pages: [] });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Arab", "we have $2m cash and 8 months runway"],
      sector: "fintech; burn is $40k a month",
      stage: "seed",
      count: 5,
    });
    expect(found.webSearched).toBe(true);
    expect(web.searches).toHaveLength(1);
    expect(web.searches[0]?.query).toBe("seed venture capital investors Arab");
    const everything = web.egressed().toLowerCase();
    for (const secret of [
      "burn",
      "40k",
      "cash",
      "runway",
      "$",
      "2m",
      "months",
    ]) {
      expect(everything).not.toContain(secret);
    }
    expect(found.regionWords).toEqual(["Arab"]);
  });

  it("asks only the web when the region words mean no known country", async () => {
    const web = createFakeResearchProvider({ pages: [] });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Martian"],
      count: 3,
    });
    expect(found.candidates).toHaveLength(0);
    expect(found.outcome).toBe("NONE");
    expect(web.searches).toHaveLength(1);
  });

  it("says unavailable, not none, when the search fails and nothing is known", async () => {
    const web = createFakeResearchProvider({
      pages: [],
      behaviour: { kind: "FAIL_SEARCH", failureClass: "TIMEOUT" },
    });
    const discovery = createCounterpartDiscovery({
      known: createKnownEntityIndex({
        store: createInMemoryKnownEntityStore(),
      }),
      providers: [web],
    });
    const found = await discovery.discover({ ...SCOPE, regions: ["Arab"] });
    expect(found.outcome).toBe("UNAVAILABLE");
  });
});

describe("region words as countries", () => {
  it("maps paraphrases to country sets", () => {
    expect(regionCountries("Gulf")).toEqual([
      "AE",
      "SA",
      "QA",
      "KW",
      "BH",
      "OM",
    ]);
    expect(regionCountries("Arab")).toContain("QA");
    expect(regionCountries("Arab")).toContain("EG");
    expect(regionCountries("Middle Eastern VCs")).toContain("SA");
    expect(regionCountries("Qatari")).toEqual(["QA"]);
    expect(regionCountries("Doha")).toEqual(["QA"]);
    expect(regionCountries("")).toEqual([]);
    expect(regionCountries("Martian")).toEqual([]);
  });

  it("a country that contains 'Arab' is that country, not the Arab world", () => {
    expect(regionCountries("United Arab Emirates")).toEqual(["AE"]);
    expect(regionCountries("Saudi Arabia")).toEqual(["SA"]);
  });
});

describe("public terms", () => {
  it("passes plain taxonomy words and refuses anything carrying private data", () => {
    expect(publicTerm("fintech")).toBe("fintech");
    expect(publicTerm("digital_health")).toBe("digital health");
    expect(publicTerm("Series A")).toBe("Series A");
    expect(publicTerm("$2m raise")).toBeNull();
    expect(publicTerm("burn rate")).toBeNull();
    expect(publicTerm("runway of 8 months")).toBeNull();
    expect(publicTerm("x".repeat(60))).toBeNull();
    expect(publicTerm(null)).toBeNull();
  });
});
