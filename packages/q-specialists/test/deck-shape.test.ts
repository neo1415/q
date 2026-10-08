import { describe, expect, it } from "vitest";

import {
  QArtifactContentSchema,
  type QArtifactContent,
} from "@capital-q/contracts";

import { promoteFirmFigures } from "../src/company/deck-figures.js";
import { shapeOwnDeck, withKickers } from "../src/company/deck-shape.js";
import { seriesOf, tidyDeck } from "../src/company/deck-tidy.js";
import { nounPhrase } from "../src/company/deck-writer.js";
import type { OwnDeckFacts } from "../src/index.js";

/**
 * Deck quality (lead review 2026-10-08), on the founder's own deck: the
 * raise headlined by the amount sought (never the cap), figure labels as
 * complete short phrases, takeaway titles from the slide's own figures,
 * the team from their records, dated traction, TAM/SAM/SOM, money as
 * figures with the caveat a footnote, and a closing slide.
 */

const section = (heading: string, body: string) => ({
  heading,
  body,
  findings: [
    {
      type: "FACT" as const,
      subjects: [
        {
          kind: "COMPANY" as const,
          companyId: "6f075a0b-8372-4458-9060-09afd73a9c37",
        },
      ],
      findingId: "dec9486c-7099-472d-a1b4-848dad009014",
      statement: body,
      confidence: "HIGH" as const,
      truthClass: "USER_CLAIM" as const,
      evidenceRefs: [],
      evidenceStatus: "DOCUMENT_SUPPORTED" as const,
    },
  ],
});

function ledgerline(): QArtifactContent {
  return QArtifactContentSchema.parse({
    sections: [
      {
        heading: "Summary",
        body: "Ledgerline is VAT compliance software.",
        findings: [],
      },
      section(
        "Market",
        "The deck estimates 420,000 VAT-filing businesses and 140,000 digitally invoicing businesses in Lagos, Abuja and Port Harcourt.",
      ),
      section(
        "Traction",
        "Paying businesses increased from 590 to 1,140 over twelve months.",
      ),
      section(
        "Financial position",
        "The deck reports ₦410k cash at 2026-09-30.",
      ),
      section(
        "The raise",
        "A $1.8m seed SAFE; a $14m post-money valuation cap.",
      ),
    ],
    gaps: ["Team"],
    deck: {
      slides: [
        {
          layout: "TITLE",
          title: "Ledgerline",
          subtitle: "VAT compliance software",
          section: 0,
        },
        {
          layout: "BULLETS",
          title: "Market",
          bullets: ["We estimate 420,000 Nigerian VAT-filing businesses"],
          section: 1,
        },
        {
          layout: "BULLETS",
          title: "Traction",
          bullets: [
            "Paying businesses increased from 590 to 1,140 over twelve months.",
          ],
          section: 2,
        },
        {
          layout: "BULLETS",
          title: "Financial position",
          bullets: [
            "₦410k cash at 2026-09-30, approximately $39k current monthly net burn.",
            "These figures are company-reported.",
          ],
          section: 3,
        },
        {
          layout: "STATEMENT",
          title: "Team",
          bullets: [],
          section: 0,
          placeholder: { kind: "TEXT", label: "Who is on the team: add yours" },
        },
        {
          layout: "BULLETS",
          title: "The raise",
          bullets: [
            "A $14m post-money valuation cap and allocates proceeds across engineering and FIRS integration, sales and partner channels, and customer success.",
          ],
          figures: [
            {
              value: "$14m",
              label: "Post-money valuation cap and allocates proceeds across",
            },
          ],
          section: 4,
        },
      ],
    },
  });
}

const FACTS: OwnDeckFacts = {
  round: {
    amount: "1800000",
    currency: "USD",
    instrument: "SAFE",
    name: "Seed",
    useOfFunds:
      "Engineering and FIRS e-invoicing integration: 35% (USD 630,000); Sales and accountant partner channel: 30% (USD 540,000); Customer success and onboarding: 20% (USD 360,000); Compliance reserve and working capital: 15% (USD 270,000)",
    targetClose: "2026-12-18",
    valuationCap: null,
  },
  team: [
    { name: "Tobenna Okafor", role: "Co-founder & CEO", founder: true },
    { name: "Funmilayo Adebayo", role: "Co-founder & CTO", founder: true },
    { name: "Emeka Chukwu", role: "Head of Partnerships", founder: false },
  ],
  teamSize: 26,
  founderCount: 2,
  website: "https://ledgerline.example",
  figures: [
    {
      section: "MARKET",
      label: "TAM businesses",
      value: "420,000",
      asOf: null,
    },
    {
      section: "MARKET",
      label: "TAM annual value",
      value: "₦168bn (about $108m)",
      asOf: null,
    },
    {
      section: "MARKET",
      label: "SAM businesses",
      value: "140,000",
      asOf: null,
    },
    {
      section: "MARKET",
      label: "SOM target",
      value: "12,000 entities by 2029; ₦4.8bn ARR",
      asOf: "2029",
    },
    {
      section: "TRACTION",
      label: "Paying businesses",
      value: "1,140",
      asOf: "September 2026",
    },
    {
      section: "TRACTION",
      label: "Prior paying businesses",
      value: "590 twelve months earlier",
      asOf: "September 2025",
    },
    {
      section: "TRACTION",
      label: "MRR",
      value: "₦38m",
      asOf: "September 2026",
    },
    {
      section: "TRACTION",
      label: "Logo retention",
      value: "96% over six months",
      asOf: "September 2026",
    },
    {
      section: "FINANCIALS",
      label: "Cash",
      value: "$410k",
      asOf: "September 30, 2026",
    },
    {
      section: "FINANCIALS",
      label: "Current monthly net burn",
      value: "About $39,000",
      asOf: null,
    },
    {
      section: "FINANCIALS",
      label: "Break-even",
      value: "Planned for Q3 2028",
      asOf: "Q3 2028",
    },
    { section: "THE_ASK", label: "Valuation cap", value: "$14m", asOf: null },
  ],
};

const slideAbout = (content: QArtifactContent, kicker: string) =>
  content.deck?.slides.find((slide) => slide.kicker === kicker);

describe("deck quality · the founder's own deck from their records", () => {
  const shaped = shapeOwnDeck(ledgerline(), FACTS);
  const deck = shaped.content.deck;

  it("headlines the raise by the amount sought, never the cap", () => {
    const raise = slideAbout(shaped.content, "The raise");
    expect(raise?.title).toBe(
      "Raising $1.8m seed on a SAFE, closing 18 Dec 2026",
    );
    expect(raise?.figures?.[0]).toEqual({
      value: "$1.8m",
      label: "Seed round (SAFE)",
    });
    expect(raise?.figures?.some((figure) => figure.value === "$14m")).toBe(
      false,
    );
    expect(raise?.bullets.join(" ")).toContain("$14m valuation cap");
    expect(raise?.chart?.kind).toBe("DONUT");
    expect(raise?.chart?.points.map((point) => point.value)).toEqual([
      "35",
      "30",
      "20",
      "15",
    ]);
  });

  it("sets the team from the founder's records, once, with no placeholder", () => {
    const teams = deck?.slides.filter(
      (slide) => slide.kicker === "Team" || slide.title === "Team",
    );
    expect(teams).toHaveLength(1);
    const team = teams?.[0];
    expect(team?.title).toBe("Led by Tobenna Okafor and Funmilayo Adebayo");
    expect(team?.bullets[0]).toBe("Tobenna Okafor — Co-founder & CEO");
    expect(team?.subtitle).toBe("A team of 26, including 2 founders.");
    expect(team?.placeholder).toBeUndefined();
  });

  it("draws money as figures in the currency the deck states, the caveat as a footnote", () => {
    const money = slideAbout(shaped.content, "Financial position");
    expect(money?.figures?.map((figure) => figure.value)).toEqual([
      "$410k",
      "$39,000",
      "Q3 2028",
    ]);
    expect(money?.title).toBe("$410k in cash, about $39,000 net burn a month");
    expect(money?.footnote).toMatch(/reported by the company/);
    expect(money?.bullets.join(" ")).not.toMatch(/company-reported/i);
  });

  it("gives TAM, SAM and SOM as figures with complete labels", () => {
    const market = slideAbout(shaped.content, "Market");
    expect(market?.figures?.map((figure) => figure.label)).toEqual([
      "VAT-filing businesses (TAM)",
      "Digitally invoicing businesses (SAM)",
      "Entities by 2029 (SOM)",
    ]);
    // The last tidying pass leaves labels built from the records alone.
    const tidied = slideAbout(tidyDeck(shaped.content), "Market");
    expect(tidied?.figures).toEqual(market?.figures);
    expect(
      slideAbout(tidyDeck(shaped.content), "Financial position")?.figures?.[0]
        ?.label,
    ).toBe("Cash at 30 Sep 2026");
  });

  it("dates the traction columns and says the movement in the title", () => {
    const traction = slideAbout(shaped.content, "Traction");
    expect(traction?.chart?.points.map((point) => point.label)).toEqual([
      "Sep 2025",
      "Sep 2026",
    ]);
    expect(traction?.title).toBe(
      "1,140 paying businesses, up from 590 a year ago",
    );
  });

  it("closes on the ask and who to talk to", () => {
    const last = deck?.slides[deck.slides.length - 1];
    expect(last?.layout).toBe("TITLE");
    expect(last?.title).toBe("Ledgerline is raising $1.8m seed on a SAFE");
    expect(last?.subtitle).toBe("Tobenna Okafor, Co-founder & CEO");
    expect(last?.bullets).toEqual(["Website: ledgerline.example"]);
  });

  it("grounds every figure it draws", () => {
    const known = shaped.grounding.join(" ");
    for (const slide of deck?.slides ?? []) {
      for (const figure of slide.figures ?? []) {
        for (const digits of figure.value.match(/\d[\d,.]*/g) ?? []) {
          expect(known.replace(/,/g, "")).toContain(
            digits.replace(/,/g, "").replace(/\.$/, ""),
          );
        }
      }
    }
  });
});

describe("deck quality · every deck", () => {
  it("labels a figure with a complete noun phrase, never a clipped clause", () => {
    expect(nounPhrase("Paying businesses and identify accountant and")).toBe(
      "Paying businesses",
    );
    expect(
      nounPhrase("Digitally invoicing businesses in Lagos, Abuja and Port"),
    ).toBe("Digitally invoicing businesses");
    expect(
      nounPhrase("Post-money valuation cap and allocates proceeds across"),
    ).toBe("Post-money valuation cap");
    expect(nounPhrase("Logo retention over six months")).toBe(
      "Logo retention over six months",
    );
    expect(nounPhrase("Seed round (SAFE)")).toBe("Seed round (SAFE)");
    expect(nounPhrase("a b c d e f g h").split(" ").length).toBeLessThanOrEqual(
      6,
    );
  });

  it("never shows a cap as a figure, nor leaves a fragment as a point", () => {
    const content = ledgerline();
    const raw = content.deck;
    if (raw === undefined) throw new Error("no deck");
    const plain = {
      ...content,
      deck: {
        ...raw,
        slides: raw.slides.map((slide) => {
          const { figures: _figures, ...rest } = slide;
          return rest;
        }),
      },
    };
    const promoted = promoteFirmFigures(plain, [
      "A $1.8m seed SAFE; a $14m post-money valuation cap.",
    ]);
    const raise = promoted.deck?.slides[5];
    expect(raise?.figures).toBeUndefined();
    expect(raise?.bullets.some((line) => /^And\b/.test(line))).toBe(false);
  });

  it("draws one measure per period as a dated chart", () => {
    const series = seriesOf([
      "Contracted ARR of R96m in FY2023",
      "Contracted ARR of R168m in FY2024",
      "Contracted ARR of R214m in FY2025",
    ]);
    expect(series?.title).toBe("Contracted ARR grew from R96m to R214m");
    expect(series?.chart.points).toEqual([
      { label: "FY2023", value: "96" },
      { label: "FY2024", value: "168" },
      { label: "FY2025", value: "214" },
    ]);
    expect(seriesOf(["Two lines", "only"])).toBeNull();
  });

  it("drops a unit-only label, joins a fragment to the line before, and keeps topics as eyebrows", () => {
    const content = QArtifactContentSchema.parse({
      sections: [
        { heading: "Summary", body: "x", findings: [] },
        {
          heading: "Product",
          body: "Maintenance is included for 10 years (stated by the company). More.",
          findings: [],
        },
        { heading: "What we do", body: "y", findings: [] },
        { heading: "Customers", body: "z", findings: [] },
      ],
      deck: {
        slides: [
          { layout: "TITLE", title: "Co", section: 0 },
          {
            layout: "BULLETS",
            title: "Product",
            figures: [{ value: "10", label: "Years" }],
            section: 1,
          },
          {
            layout: "BULLETS",
            title: "What we do",
            bullets: [
              "We put solar on SME rooftops for a fixed fee",
              "No upfront cost",
            ],
            section: 2,
          },
          {
            layout: "BULLETS",
            title: "Customers",
            figures: [{ value: "2,900", label: "SME sites" }],
            section: 3,
          },
        ],
      },
    });
    const tidy = withKickers(tidyDeck(content));
    const [, product, what, customers] = tidy.deck?.slides ?? [];
    expect(product?.figures).toBeUndefined();
    expect(product?.bullets).toEqual(["Maintenance is included for 10 years."]);
    expect(what?.bullets).toEqual([
      "We put solar on SME rooftops for a fixed fee; no upfront cost",
    ]);
    expect(customers?.title).toBe("2,900 SME sites");
    expect(customers?.kicker).toBe("Customers");
  });
});
