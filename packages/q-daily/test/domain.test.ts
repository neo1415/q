import { describe, expect, it } from "vitest";

import {
  canonicalUrl,
  clusterKeyOf,
  clusterQueries,
  inventedNumbers,
  localDate,
  nextDueAt,
  parseFeed,
  publicInterests,
  quoteIsVerbatim,
  rankCandidates,
  sameStory,
  usdAmount,
  type Candidate,
  type InterestProfile,
} from "../src/index.js";

const NOW = new Date("2026-10-01T10:00:00Z"); // a Thursday

function profile(overrides: Partial<InterestProfile> = {}): InterestProfile {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-0000000000a1",
    readerName: "Kola",
    email: "kola@fictional.capitalq.local",
    role: "INVESTOR",
    sectors: ["Fintech", "Agriculture"],
    stages: ["Seed"],
    markets: ["Nigeria"],
    ownName: "Ventures Platform",
    knownNames: ["Chowdeck"],
    raise: null,
    ...overrides,
  };
}

describe("shared gatherings never carry personal facts (§8)", () => {
  it("keys a gathering by public interests and window only", () => {
    const a = clusterKeyOf(publicInterests(profile()), 7);
    const b = clusterKeyOf(
      publicInterests(
        profile({
          userId: "00000000-0000-4000-8000-000000000002",
          ownName: "Another Fund",
          knownNames: ["Secret Co"],
          raise: "Seed, 2000000 USD",
          readerName: "Ada",
          email: "ada@fictional.capitalq.local",
        }),
      ),
      7,
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(clusterKeyOf(publicInterests(profile()), 2)).not.toBe(a);
    expect(
      clusterKeyOf(
        publicInterests(profile({ sectors: ["Agriculture", "fintech"] })),
        7,
      ),
    ).toBe(a);
  });

  it("builds searches from the public interests alone", () => {
    const queries = clusterQueries(publicInterests(profile()), 4).join(" | ");
    expect(queries).toContain("Fintech startup funding Nigeria");
    expect(queries).not.toContain("Ventures Platform");
    expect(queries).not.toContain("Chowdeck");
    expect(
      clusterQueries(publicInterests(profile()), 4).length,
    ).toBeLessThanOrEqual(4);
  });

  it("falls back to general private-capital topics", () => {
    expect(
      clusterQueries(
        publicInterests(profile({ sectors: [], stages: [], markets: [] })),
        4,
      ),
    ).toEqual(["startup funding rounds", "venture capital news"]);
  });
});

describe("relevance in code", () => {
  const base: Candidate = {
    url: "https://techcabal.com/2026/09/30/fintech-raise/?utm_source=x",
    title: "Nigerian fintech Paystack-rival raises $12 million Series A",
    snippet: "The Lagos fintech raised $12 million.",
    publisher: "TechCabal",
    publishedAt: "2026-09-30T08:00:00Z",
    thumbnailUrl: null,
    providerRelevance: null,
    via: "FEED",
  };

  it("canonicalises addresses", () => {
    expect(
      canonicalUrl("https://www.TechCabal.com/a/b/?utm_source=x&id=2#top"),
    ).toBe("https://techcabal.com/a/b?id=2");
  });

  it("drops duplicates, stale items and feed items naming no topic", () => {
    const ranked = rankCandidates(
      [
        base,
        { ...base, url: "https://techcabal.com/2026/09/30/fintech-raise/" },
        {
          ...base,
          url: "https://other.example/fintech",
          title:
            "Nigerian fintech Paystack-rival raises $12 million in Series A round",
          via: "SEARCH",
        },
        {
          ...base,
          url: "https://techcabal.com/old",
          title: "Fintech old news",
          publishedAt: "2026-08-01T00:00:00Z",
        },
        {
          ...base,
          url: "https://techcabal.com/football",
          title: "Football results",
          snippet: "Goals.",
        },
      ],
      ["Fintech", "Nigeria"],
      { now: NOW, windowDays: 7 },
    );
    expect(ranked.map((item) => canonicalUrl(item.url))).toEqual([
      "https://techcabal.com/2026/09/30/fintech-raise",
    ]);
    expect(ranked[0]?.topicHits).toEqual(["Fintech"]);
    expect(
      sameStory("Chowdeck raises $5m", "Lagos food startup wins award"),
    ).toBe(false);
    expect(
      sameStory(
        "Fintech startup Paystack raises $2 million",
        "Fintech startup Flutterwave raises $3 million",
      ),
    ).toBe(false);
    expect(
      sameStory(
        "Nigerian fintech Moniepoint raises $110 million Series C",
        "Moniepoint raises $110 million in Series C round, Nigerian fintech",
      ),
    ).toBe(true);
  });
});

describe("honesty checks (G4)", () => {
  const source =
    "“We are building rails for the continent,” said CEO Ada Obi. The company raised $12 million.";
  it("keeps verbatim quotes only", () => {
    expect(
      quoteIsVerbatim('"We are building rails for the continent,"', [source]),
    ).toBe(true);
    expect(quoteIsVerbatim("We are building rails for Africa", [source])).toBe(
      false,
    );
  });
  it("finds numbers no source prints", () => {
    expect(inventedNumbers("It raised $12 million.", [source])).toEqual([]);
    expect(
      inventedNumbers("It raised $15 million from 3 funds.", [source]),
    ).toEqual(["15", "3"]);
  });
  it("reads dollars only as printed", () => {
    expect(usdAmount("$12 million")).toBe(12_000_000);
    expect(usdAmount("US$1.5M")).toBe(1_500_000);
    expect(usdAmount("$800,000")).toBe(800_000);
    expect(usdAmount("₦2 billion")).toBeNull();
    expect(usdAmount(null)).toBeNull();
  });
});

describe("feeds", () => {
  it("reads RSS items with CDATA, entities and media thumbnails", () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>T</title>
      <item><title><![CDATA[Fintech &amp; agri: Acme raises $3M]]></title>
        <link>https://techcabal.com/acme</link>
        <pubDate>Tue, 30 Sep 2026 08:00:00 GMT</pubDate>
        <description>&lt;p&gt;Acme, a &lt;b&gt;Lagos&lt;/b&gt; startup.&lt;/p&gt;<script>x</script></description>
        <media:thumbnail url="https://techcabal.com/img.jpg" />
      </item>
      <item><title>No link</title></item>
      <item><title>Plain http</title><link>http://insecure.example/a</link></item>
    </channel></rss>`;
    const items = parseFeed(xml, { publisher: "TechCabal" }, 10);
    expect(items).toEqual([
      {
        publisher: "TechCabal",
        title: "Fintech & agri: Acme raises $3M",
        url: "https://techcabal.com/acme",
        publishedAt: "2026-09-30T08:00:00.000Z",
        summary: "Acme, a Lagos startup.",
        thumbnailUrl: "https://techcabal.com/img.jpg",
      },
    ]);
  });

  it("reads Atom entries", () => {
    const xml = `<feed><entry><title>Sifted: seed rounds rise</title>
      <link rel="alternate" href="https://sifted.eu/a"/><updated>2026-09-29T00:00:00Z</updated>
      <summary>Seed rounds rose.</summary></entry></feed>`;
    expect(parseFeed(xml, { publisher: "Sifted" }, 10)[0]?.url).toBe(
      "https://sifted.eu/a",
    );
  });
});

describe("schedule (G1)", () => {
  it("weekly is the next Monday 07:00 in the reader's zone", () => {
    expect(nextDueAt("WEEKLY", "Africa/Lagos", NOW)?.toISOString()).toBe(
      "2026-10-05T06:00:00.000Z",
    );
    expect(nextDueAt("WEEKLY", null, NOW)?.toISOString()).toBe(
      "2026-10-05T07:00:00.000Z",
    );
  });
  it("daily is the next 07:00; off is never", () => {
    expect(nextDueAt("DAILY", "Africa/Lagos", NOW)?.toISOString()).toBe(
      "2026-10-02T06:00:00.000Z",
    );
    expect(
      nextDueAt(
        "DAILY",
        "America/New_York",
        new Date("2026-10-01T05:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-10-01T11:00:00.000Z");
    expect(nextDueAt("OFF", "Africa/Lagos", NOW)).toBeNull();
    expect(nextDueAt("DAILY", "Not/AZone", NOW)?.toISOString()).toBe(
      "2026-10-02T07:00:00.000Z",
    );
  });
  it("dates an edition in the reader's own calendar", () => {
    expect(localDate(new Date("2026-10-01T23:30:00Z"), "Africa/Lagos")).toBe(
      "2026-10-02",
    );
    expect(localDate(new Date("2026-10-01T23:30:00Z"), null)).toBe(
      "2026-10-01",
    );
  });
});
