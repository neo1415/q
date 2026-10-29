import { describe, expect, it } from "vitest";

import {
  crossCheck,
  independenceKeys,
  isStale,
  openGaps,
  parseFigure,
  periodKey,
  rankFacts,
  registrableDomain,
  sourceTier,
  tierRank,
  numbersSupported,
  verifyFacts,
  type CheckableFact,
} from "../src/index.js";

/**
 * Investigation-grade research (owner 2026-10-29): tiers, corroboration,
 * contradiction, staleness and source independence decided by code.
 * Every fixture is synthetic: invented places, publishers and figures.
 */

const TODAY = new Date("2026-10-29T00:00:00Z");

function fact(
  overrides: Partial<CheckableFact> & Pick<CheckableFact, "id" | "source">,
): CheckableFact {
  return {
    statement:
      "The Zedland widget payments market was worth USD 120 million in 2025.",
    figure: "USD 120 million",
    asOf: "2025",
    lane: "MARKET_SIZE",
    kind: "FIGURE",
    domain: "example-news.test",
    title: null,
    publishedAt: "2026-03-01",
    tier: "SECONDARY",
    tierKind: null,
    ...overrides,
  };
}

describe("source tiers", () => {
  it("knows a publisher by its registrable domain, country second levels included", () => {
    expect(registrableDomain("www.alpha.co.zz")).toBe("alpha.co.zz");
    expect(registrableDomain("news.alpha.com")).toBe("alpha.com");
    expect(registrableDomain("alpha.com")).toBe("alpha.com");
  });

  it("government and supranational domains are primary, in any country", () => {
    for (const url of [
      "https://www.centralbank.gov.zz/circulars/2026-01",
      "https://registry.go.zz/search",
      "https://www.sec.gov/edgar",
      "https://ec.europa.eu/finance",
    ]) {
      expect(sourceTier({ url })).toEqual({
        tier: "PRIMARY",
        kind: "GOVERNMENT_OR_REGULATOR",
      });
    }
  });

  it("an official source is primary for the market in question, other governments are other (live 2026-10-29)", () => {
    const nigeria = new Set(["NG"]);
    for (const url of [
      "https://www.cbn.gov.ng/circulars",
      "https://www.irs.gov/payments",
      "https://www.congress.gov/bill",
      "https://www.mas.gov.sg/regulation",
      "https://www.worldbank.org/en/country/nigeria",
    ]) {
      const tier = sourceTier({ url, countries: nigeria }).tier;
      expect([url, tier]).toEqual([
        url,
        url.includes(".ng/") || url.includes("worldbank") ? "PRIMARY" : "OTHER",
      ]);
    }
    // An official body off a government domain: its own country.
    expect(
      sourceTier({
        url: "https://www.fca.org.uk/news",
        title: "Financial Conduct Authority | News",
        countries: nigeria,
      }).tier,
    ).toBe("OTHER");
    expect(
      sourceTier({
        url: "https://www.fca.org.uk/news",
        title: "Financial Conduct Authority | News",
        countries: new Set(["GB"]),
      }).tier,
    ).toBe("PRIMARY");
    // A global question: every official source is primary.
    expect(sourceTier({ url: "https://www.irs.gov/x" }).tier).toBe("PRIMARY");
  });

  it("an official body off a government domain needs its name AND matching domain", () => {
    expect(
      sourceTier({
        url: "https://www.zpa.org.zz/notices",
        title: "Zedland Payments Authority | Notices",
      }),
    ).toEqual({ tier: "PRIMARY", kind: "OFFICIAL_BODY" });
    // A title alone never makes a page primary.
    expect(
      sourceTier({
        url: "https://cheap-blog.test/post",
        title: "Zedland Payments Authority | Notices",
      }).tier,
    ).toBe("OTHER");
  });

  it("a company's own disclosure is primary, marked as its claim -- only on its own site", () => {
    // Live 2026-10-29: an investors path is not a company's own site.
    expect(
      sourceTier({
        url: "https://widgetco.test/investor-relations/annual-report",
      }),
    ).toEqual({ tier: "OTHER", kind: null });
    expect(
      sourceTier({
        url: "https://www.paymentsdive.com/news/stablecoin-startups/832871/",
        companyDomains: new Set(["widgetco.test"]),
      }).tier,
    ).toBe("OTHER");
    expect(
      sourceTier({
        url: "https://widgetco.test/about",
        companyDomains: new Set(["widgetco.test"]),
      }).kind,
    ).toBe("COMPANY_DISCLOSURE");
  });

  it("accountable press is secondary, everything else other, and primary ranks first", () => {
    expect(sourceTier({ url: "https://www.reuters.com/x" }).tier).toBe(
      "SECONDARY",
    );
    expect(sourceTier({ url: "https://someone.blog.test/x" }).tier).toBe(
      "OTHER",
    );
    const verified = verifyFacts(
      [
        {
          statement: "Press says A.",
          figure: null,
          asOf: null,
          source: 1,
          lane: "REGULATION",
          kind: "FACT",
        },
        {
          statement: "Regulator says B.",
          figure: null,
          asOf: null,
          source: 2,
          lane: "REGULATION",
          kind: "FACT",
        },
      ],
      [
        {
          index: 1,
          url: "https://www.reuters.com/a",
          domain: "reuters.com",
          title: null,
          publishedAt: null,
          excerpt: "A",
        },
        {
          index: 2,
          url: "https://cb.gov.zz/b",
          domain: "cb.gov.zz",
          title: null,
          publishedAt: null,
          excerpt: "B",
        },
      ],
    ).verified;
    const ranked = rankFacts(verified, 10, (one) =>
      tierRank(sourceTier({ url: one.url }).tier),
    );
    expect(ranked[0]?.statement).toBe("Regulator says B.");
  });
});

describe("cross-source validation in code", () => {
  it("parses figures with scale and unit, never a bare year", () => {
    expect(parseFigure("USD 1.2 billion")).toEqual({
      value: 1.2e9,
      unit: "USD",
    });
    expect(parseFigure("$1,200m")).toEqual({ value: 1.2e9, unit: "USD" });
    expect(parseFigure("45%")).toEqual({ value: 45, unit: "%" });
    expect(parseFigure("in 2024")).toBeNull();
    expect(periodKey("Q2 2025")).toBe("q2 2025");
  });

  it("two independent publishers agreeing is MULTI_SOURCE_SUPPORTED", () => {
    const checked = crossCheck(
      [
        fact({ id: "F1", source: 1, domain: "alpha-news.test" }),
        fact({
          id: "F2",
          source: 2,
          domain: "beta-research.test",
          statement:
            "Zedland's widget payments market was about USD 121 million in 2025.",
          figure: "USD 121 million",
        }),
      ],
      TODAY,
    );
    expect(checked.map((one) => one.evidenceStatus)).toEqual([
      "MULTI_SOURCE_SUPPORTED",
      "MULTI_SOURCE_SUPPORTED",
    ]);
    expect(checked[0]?.corroboratedBy).toEqual(["F2"]);
    expect(checked[0]?.lifecycleStatus).toBe("CURRENT");
  });

  it("the same publisher twice, or one story syndicated, never corroborates", () => {
    const sameDomain = crossCheck(
      [
        fact({ id: "F1", source: 1, domain: "www.alpha-news.test" }),
        fact({ id: "F2", source: 2, domain: "markets.alpha-news.test" }),
      ],
      TODAY,
    );
    expect(
      sameDomain.every((one) => one.evidenceStatus === "DOCUMENT_SUPPORTED"),
    ).toBe(true);
    const title = "Zedland widget payments market hits USD 120 million";
    const syndicated = crossCheck(
      [
        fact({ id: "F1", source: 1, domain: "alpha-news.test", title }),
        fact({ id: "F2", source: 2, domain: "gamma-wire.test", title }),
      ],
      TODAY,
    );
    expect(syndicated.every((one) => one.corroboratedBy.length === 0)).toBe(
      true,
    );
    const keys = independenceKeys([
      { source: 1, domain: "alpha-news.test", title },
      { source: 2, domain: "gamma-wire.test", title },
    ]);
    expect(keys.get(1)).toBe(keys.get(2));
  });

  it("disagreeing figures are both CONTRADICTORY, each naming the other, both kept", () => {
    const checked = crossCheck(
      [
        fact({ id: "F1", source: 1, domain: "alpha-news.test" }),
        fact({
          id: "F2",
          source: 2,
          domain: "beta-research.test",
          statement:
            "The Zedland widget payments market was worth USD 300 million in 2025.",
          figure: "USD 300 million",
        }),
      ],
      TODAY,
    );
    expect(checked).toHaveLength(2);
    expect(checked.map((one) => one.lifecycleStatus)).toEqual([
      "CONTRADICTORY",
      "CONTRADICTORY",
    ]);
    expect(checked[0]?.contradicts).toEqual(["F2"]);
    expect(checked[1]?.contradicts).toEqual(["F1"]);
  });

  it("never compares different periods or different units", () => {
    const checked = crossCheck(
      [
        fact({ id: "F1", source: 1 }),
        fact({
          id: "F2",
          source: 2,
          domain: "beta.test",
          asOf: "2021",
          statement:
            "The Zedland widget payments market was worth USD 40 million in 2021.",
          figure: "USD 40 million",
        }),
        fact({
          id: "F3",
          source: 3,
          domain: "gamma.test",
          statement: "The Zedland widget payments market grew 30% in 2025.",
          figure: "30%",
        }),
      ],
      TODAY,
    );
    expect(checked.every((one) => one.contradicts.length === 0)).toBe(true);
  });

  it("uses the reader's measure and entity labels to group, code to compare", () => {
    const checked = crossCheck(
      [
        fact({
          id: "F1",
          source: 1,
          measure: "licensed operators",
          entity: "Zedland",
          figure: "14",
          statement: "Zedland has 14 licensed widget operators.",
          asOf: "2026",
          lane: "REGULATION",
        }),
        fact({
          id: "F2",
          source: 2,
          domain: "other.test",
          measure: "Licensed operators",
          entity: "zedland",
          figure: "22",
          statement: "Twenty-two firms hold the licence, 22 in all.",
          asOf: "2026",
          lane: "COMPETITORS",
        }),
      ],
      TODAY,
    );
    expect(checked.map((one) => one.lifecycleStatus)).toEqual([
      "CONTRADICTORY",
      "CONTRADICTORY",
    ]);
  });

  it("STALE by the lane's horizon; undated is never stale; a company's disclosure is SELF_REPORTED", () => {
    expect(
      isStale(
        { asOf: "2023", publishedAt: null, lane: "NEWS", kind: "NEWS" },
        TODAY,
      ),
    ).toBe(true);
    expect(
      isStale(
        {
          asOf: "2024",
          publishedAt: null,
          lane: "MARKET_SIZE",
          kind: "FIGURE",
        },
        TODAY,
      ),
    ).toBe(false);
    expect(
      isStale(
        { asOf: null, publishedAt: null, lane: "NEWS", kind: "NEWS" },
        TODAY,
      ),
    ).toBe(false);
    const [own] = crossCheck(
      [
        fact({
          id: "F1",
          source: 1,
          tier: "PRIMARY",
          tierKind: "COMPANY_DISCLOSURE",
          asOf: "2019",
          lane: "TRACTION",
          kind: "NEWS",
        }),
      ],
      TODAY,
    );
    expect(own?.evidenceStatus).toBe("SELF_REPORTED");
    expect(own?.lifecycleStatus).toBe("STALE");
    expect(own?.dated).toBe(true);
  });

  it("names the open questions: no fact, could not run, contradictory, stale only, no primary source", () => {
    const facts = crossCheck(
      [
        fact({ id: "F1", source: 1, lane: "MARKET_SIZE" }),
        fact({
          id: "F2",
          source: 2,
          domain: "b.test",
          lane: "MARKET_SIZE",
          figure: "USD 300 million",
          statement:
            "The Zedland widget payments market was worth USD 300 million in 2025.",
        }),
        fact({
          id: "F3",
          source: 3,
          lane: "NEWS",
          kind: "NEWS",
          asOf: "2022",
          statement: "A widget firm launched.",
          figure: null,
        }),
        fact({
          id: "F4",
          source: 4,
          lane: "REGULATION",
          kind: "REGULATION",
          statement: "The press reports a new widget licence.",
          figure: null,
        }),
      ],
      TODAY,
    );
    const gaps = openGaps({
      lanes: [
        { lane: "MARKET_SIZE", ran: true, primary: false },
        { lane: "NEWS", ran: true, primary: false },
        { lane: "REGULATION", ran: true, primary: true },
        { lane: "COMPETITORS", ran: true, primary: false },
        { lane: "FUNDING", ran: false, primary: false },
        { lane: "TRIED_ENOUGH", ran: true, primary: false },
      ],
      facts,
      tries: new Map([["TRIED_ENOUGH", 2]]),
      maxTries: 2,
    });
    expect(gaps).toEqual([
      { lane: "MARKET_SIZE", reason: "CONTRADICTORY" },
      { lane: "NEWS", reason: "STALE_ONLY" },
      { lane: "REGULATION", reason: "NO_PRIMARY_SOURCE" },
      { lane: "COMPETITORS", reason: "NO_FACT" },
      { lane: "FUNDING", reason: "COULD_NOT_RUN" },
    ]);
  });
});

describe("a fact is on its own page (live 2026-10-29, run A)", () => {
  const page =
    "B2B cross-border payments in 2025: Wise reported revenue of $1.2bn; transaction volumes grew 32% and 778 firms responded.";
  const fact = (
    statement: string,
    figure: string | null,
    entity: string | null,
  ) => ({
    statement,
    figure,
    asOf: "2025",
    source: 1,
    lane: "COMPETITORS",
    kind: "COMPETITOR" as const,
    measure: "revenue",
    entity,
  });
  const source = {
    index: 1,
    url: "https://www.fxcintel.test/report",
    domain: "fxcintel.test",
    title: "B2B cross-border payments in 2025",
    publishedAt: null,
    excerpt: page,
  };

  it("refuses an organisation its page never names, however its numbers fall", () => {
    const { verified, refused } = verifyFacts(
      [
        fact(
          "Corpay's revenue grew 32% to $1.15bn in 2025.",
          "$1.15bn",
          "Corpay",
        ),
      ],
      [source],
    );
    expect(verified).toHaveLength(0);
    expect(refused[0]?.reason).toBe("FIGURE_NOT_IN_SOURCE");
    const named = verifyFacts(
      [fact("Payoneer grew 32% in 2025.", "32%", "Payoneer")],
      [source],
    );
    expect(named.refused[0]?.reason).toBe("ENTITY_NOT_IN_SOURCE");
    // A market label is not a name to find.
    expect(
      verifyFacts(
        [fact("Volumes grew 32% in 2025.", "32%", "global B2B payments")],
        [source],
      ).verified,
    ).toHaveLength(1);
  });

  it("matches a figure only at its own scale", () => {
    expect(
      numbersSupported(
        { statement: "Wise made $1.2bn.", figure: "$1.2bn" },
        page,
      ),
    ).toBe(true);
    expect(
      numbersSupported(
        { statement: "There are 778 million users.", figure: "778 million" },
        page,
      ),
    ).toBe(true);
    expect(
      numbersSupported(
        { statement: "Volumes grew 1.2%.", figure: "1.2%" },
        page,
      ),
    ).toBe(false);
  });
});
