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
  ])(
    "maps %s to the Qatar investors, the public search beside",
    async (...regions) => {
      const web = createFakeResearchProvider({ pages: [] });
      const discovery = createCounterpartDiscovery({
        known: await index(),
        providers: [web],
      });
      const found = await discovery.discover({ ...SCOPE, regions, count: 3 });
      expect(found.outcome).toBe("FOUND");
      expect(names(found).sort()).toEqual(TOP_THREE);
      // Prepared entities fill the three; the public search still runs
      // beside them (it found nothing here). The agency and the finance
      // executive (not an investor) are not in the three.
      expect(found.webSearched).toBe(true);
      expect(web.searches.length).toBeGreaterThan(0);
      expect(names(found)).not.toContain("Invest Qatar");
      expect(names(found)).not.toContain("Shadi Qishta");
    },
  );

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
    // A few phrasings side by side (owner's own conversation, 2026-10-24).
    expect(web.searches.length).toBeGreaterThanOrEqual(1);
    expect(web.searches.length).toBeLessThanOrEqual(3);
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
    expect(web.searches.length).toBeLessThanOrEqual(4);
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
    expect(web.searches.length).toBeGreaterThanOrEqual(1);
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

/**
 * Owner's own conversation (2026-10-24): discovery asks name a kind of
 * investor and a place; they are searched as discoveries -- the kind, the
 * place and the sector, in a few phrasings side by side -- and only that
 * kind is offered.
 */
// Coordinator 2026-10-24, live on bbb4b6773: "From a public web search,
// not confirmed: Qatari Investors Group and Qatari Investors Group" (a listed
// company, named twice) and "DVC and Home" (a page title named as a firm).
describe("public finds are firms that invest, each named once by its name", () => {
  const page = (url: string, title: string, snippet: string) => ({
    url,
    title,
    snippet,
    text: snippet,
  });

  it("a listed company named like an investor is not one; a firm found twice is one; a title's 'Home' is never a name", async () => {
    const web = createFakeResearchProvider({
      pages: [
        page(
          "https://www.linkedin.com/company/qatari-investors-group",
          "Qatari Investors Group | LinkedIn",
          "Qatari Investors Group Q.P.S.C. is a public shareholding company listed on the Qatar Stock Exchange, with interests in cement and Qatar real estate.",
        ),
        page(
          "https://www.qig.com.qa/",
          "Home - Qatari Investors Group",
          "Qatari Investors Group, a Qatar public shareholding company in cement and real estate.",
        ),
        page(
          "https://www.linkedin.com/company/doha-venture-partners",
          "Doha Venture Partners | LinkedIn",
          "Doha Venture Partners invests in early-stage startups in Qatar.",
        ),
        page(
          "https://dohaventurepartners.qa/",
          "Home - Doha Venture Partners",
          "Doha Venture Partners backs early-stage founders across Qatar.",
        ),
        page(
          "https://dvc.qa/",
          "Home - DVC",
          "DVC invests in seed-stage startups in Qatar.",
        ),
      ],
    });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Qatari"],
      count: 5,
    });
    const publicNames = found.candidates
      .filter((one) => one.source === "WEB")
      .map((one) => one.card.subject.displayName);
    expect(publicNames).not.toContain("Qatari Investors Group");
    expect(publicNames).not.toContain("Home");
    expect(
      publicNames.filter((name) => name === "Doha Venture Partners"),
    ).toHaveLength(1);
    expect(publicNames).toContain("DVC");
  });

  it("short of the count, one more phrasing is searched before answering", async () => {
    const web = createFakeResearchProvider({
      pages: [
        page(
          "https://www.linkedin.com/company/alajlan-family-office",
          "Alajlan Family Office | LinkedIn",
          "A Riyadh family office backing fintech in Saudi Arabia.",
        ),
      ],
    });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Saudi"],
      kinds: ["family offices"],
      sector: "fintech",
      count: 3,
    });
    const queries = web.searches.map((search) => search.query.toLowerCase());
    expect(queries.at(-1)).toBe(
      "list of family offices in saudi arabia fintech",
    );
    expect(names(found)).toEqual(["Alajlan Family Office"]);
  });
});

describe("public search down (live 2026-10-25)", () => {
  it("names the known firms and says the web could not be searched", async () => {
    const web = createFakeResearchProvider({
      pages: [],
      behaviour: { kind: "FAIL_SEARCH", failureClass: "AUTHENTICATION" },
    });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Qatar"],
      count: 3,
    });
    expect(found.outcome).toBe("FOUND");
    expect(found.webUnavailable).toBe(true);
  });
});

describe("discovery by kind, place and sector", () => {
  it("three Qatari VCs: the known three, and public firms named beside them", async () => {
    const web = createFakeResearchProvider({
      pages: [
        {
          url: "https://www.linkedin.com/company/qatar-investment-authority",
          title: "Qatar Investment Authority | LinkedIn",
          snippet:
            "Doha sovereign fund; its venture capital programme invests in startups in Qatar.",
          text: "Doha sovereign fund; its venture capital programme invests in startups in Qatar.",
        },
      ],
    });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Qatar"],
      count: 3,
    });
    expect(names(found).slice(0, 3).sort()).toEqual(TOP_THREE);
    expect(names(found)).toContain("Qatar Investment Authority");
    expect(found.candidates.at(-1)?.source).toBe("WEB");
  });

  it("three Saudi family offices that back fintech: searched as family offices in Saudi Arabia, never a VC instead", async () => {
    const web = createFakeResearchProvider({
      pages: [
        {
          url: "https://www.linkedin.com/company/olayan-family-office",
          title: "Olayan Family Office | LinkedIn",
          snippet:
            "Riyadh family office backing fintech and growth companies in Saudi Arabia.",
          text: "Riyadh family office backing fintech and growth companies in Saudi Arabia.",
        },
        {
          url: "https://www.linkedin.com/company/stv-vc",
          title: "STV | LinkedIn",
          snippet: "Riyadh venture capital firm investing in Saudi startups.",
          text: "Riyadh venture capital firm investing in Saudi startups.",
        },
      ],
    });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Saudi"],
      kinds: ["family offices"],
      sector: "fintech",
      count: 3,
    });
    const queries = web.searches.map((search) => search.query.toLowerCase());
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.every((query) => query.includes("family offices"))).toBe(
      true,
    );
    expect(queries.some((query) => query.includes("saudi arabia"))).toBe(true);
    expect(queries.some((query) => query.includes("fintech"))).toBe(true);
    // The Qatar VCs prepared are not family offices; STV is a VC.
    expect(names(found)).toEqual(["Olayan Family Office"]);
  });

  it("a page that says only 'family offices' (plural) is one", async () => {
    const web = createFakeResearchProvider({
      pages: [
        {
          url: "https://www.linkedin.com/company/al-faisaliah-holding",
          title: "Al Faisaliah Holding | LinkedIn",
          snippet:
            "One of the Riyadh family offices backing fintech in Saudi Arabia.",
          text: "One of the Riyadh family offices backing fintech in Saudi Arabia.",
        },
      ],
    });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Saudi"],
      kinds: ["family offices"],
      sector: "fintech",
      count: 3,
    });
    expect(names(found)).toEqual(["Al Faisaliah Holding"]);
  });

  it("five Kenyan angel networks: searched as angel networks in Kenya", async () => {
    const web = createFakeResearchProvider({ pages: [] });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    await discovery.discover({
      ...SCOPE,
      regions: ["Kenyan"],
      kinds: ["angel networks"],
      count: 5,
    });
    const queries = web.searches.map((search) => search.query.toLowerCase());
    expect(queries.some((query) => query.includes("angel networks"))).toBe(
      true,
    );
    expect(queries.some((query) => query.includes("kenya"))).toBe(true);
    // A discovery, never a lookup of anyone's company.
    expect(queries.join(" ")).not.toContain("capital q");
  });

  it("three Qatari investors, any kind: the prepared Qatar investors, searched as a discovery", async () => {
    const web = createFakeResearchProvider({ pages: [] });
    const discovery = createCounterpartDiscovery({
      known: await index(),
      providers: [web],
    });
    const found = await discovery.discover({
      ...SCOPE,
      regions: ["Qatari"],
      count: 3,
    });
    expect(found.countries).toContain("QA");
    expect(found.candidates.length).toBe(3);
  });
});
