import { describe, expect, it } from "vitest";

import type { QArtifactContent, QDeck, QSlide } from "@capital-q/contracts";

import {
  composePitchDeck,
  fillOwnSlides,
  formatAmount,
  neverEmptySlides,
  promoteFirmFigures,
  runDocumentPipeline,
  taglineOf,
  type DeckPolisher,
  type DocumentPipelineInput,
} from "../src/index.js";
import type {
  CompanyFinding,
  CompanyIntelligenceResult,
} from "../src/company/contracts.js";

/**
 * Deck wave 8 (live 2026-10-07, the Ledgerline deck): firm figures survive
 * the polish, the cover's subtitle is a tagline, the founder's own raise
 * and team fill their slides, and no slide ships empty. Fakes only: the
 * polisher is a function that returns what the live one did.
 */

const COMPANY = "f0000000-0000-4000-8000-000000000002";
let seq = 0;
function finding(
  dimension: string,
  statement: string,
  truthClass = "USER_CLAIM",
): CompanyFinding {
  seq += 1;
  return {
    findingId: `a0000000-0000-4000-8000-0000000001${String(10 + (seq % 80))}`,
    type: "FACT",
    statement,
    truthClass,
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    evidenceRefs: [],
    dimension,
    derivation: "MODEL",
  } as unknown as CompanyFinding;
}

function result(findings: CompanyFinding[]): CompanyIntelligenceResult {
  return {
    companyId: COMPANY,
    specialistVersion: "company-intelligence/v1",
    asOf: "2026-10-07T00:00:00.000Z",
    blocked: null,
    findings,
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "MODERATE",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: null,
    telemetry: {} as CompanyIntelligenceResult["telemetry"],
  };
}

const OPENING =
  "Ledgerline is bookkeeping and tax-compliance software for Nigerian small businesses, sold through the accountants who already keep their books and file their VAT returns every month.";

const FINDINGS = [
  finding("DESCRIPTION", OPENING),
  finding(
    "PRODUCT",
    "The product reconciles bank feeds and files VAT returns for small businesses.",
  ),
  finding(
    "CUSTOMERS",
    "Ledgerline serves 1,140 paying businesses through accountant partners across Lagos and Abuja.",
  ),
  finding(
    "TRACTION",
    "Paying businesses grew from 590 to 1,140 over twelve months, with ₦38m MRR and 96% six-month retention.",
  ),
  finding(
    "MARKET",
    "The deck estimates about 2,000,000 VAT-registered small businesses in Nigeria.",
    "ESTIMATE",
  ),
];
const GROUNDING = FINDINGS.map((item) => item.statement);

function deck(): QArtifactContent {
  const composed = composePitchDeck({
    companyName: "Ledgerline",
    result: result(FINDINGS),
  });
  if (composed === null) throw new Error("fixture deck did not compose");
  return composed.content;
}

function input(
  overrides: Partial<DocumentPipelineInput> = {},
): DocumentPipelineInput {
  return {
    kind: "PITCH_DECK",
    grounding: GROUNDING,
    sectorCodes: [],
    directionChosen: false,
    brand: null,
    sensitivity: "CONFIDENTIAL",
    attribution: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
      qRunId: "22222222-0000-4000-8000-000000000001",
      correlationId: "33333333-0000-4000-8000-000000000001",
    },
    ...overrides,
  };
}

/** The live polisher's habit: every numbers slide back into sentences. */
function collapsingPolisher(): DeckPolisher {
  return {
    polish: ({ deck: shown }: { deck: QDeck }) =>
      Promise.resolve({
        slides: shown.slides.flatMap((slide: QSlide, index: number) => {
          if (/customer/i.test(slide.title) || slide.title.includes("1,140")) {
            return [
              {
                number: index + 1,
                title:
                  "Customers: We serve 1,140 paying businesses through accountant partners",
                subtitle: null,
                bullets: slide.bullets.length === 0 ? null : slide.bullets,
              },
            ];
          }
          if (index === 0) {
            return [
              {
                number: 1,
                title: null,
                subtitle:
                  "The bookkeeping and tax-compliance platform that Nigerian small businesses and their accountants rely on every single month",
                bullets: null,
              },
            ];
          }
          return [];
        }),
      }),
  };
}

const figureValues = (slide: QSlide | undefined) =>
  (slide?.figures ?? []).map((figure) => figure.value);

describe("firm figures survive the polish", () => {
  it("promotes firm numbers in sentences to figures and a movement to a small chart", () => {
    const content: QArtifactContent = {
      sections: [
        { heading: "Summary", body: OPENING, findings: [] },
        { heading: "Traction", body: "", findings: [] },
        { heading: "Market", body: "", findings: [] },
      ],
      gaps: [],
      deck: {
        direction: "MINIMAL_INSTITUTIONAL",
        markIsDraft: false,
        slides: [
          {
            layout: "TITLE",
            title: "Ledgerline",
            bullets: [],
            bulletsRight: [],
            section: 0,
          },
          {
            layout: "BULLETS",
            title:
              "Traction: Paying businesses grew from 590 to 1,140 over twelve months…",
            bullets: [
              "We serve 1,140 paying businesses through accountant partners",
              "Paying businesses grew from 590 to 1,140 over twelve months",
              "₦38m MRR, with 96% six-month retention",
            ],
            bulletsRight: [],
            section: 1,
          },
          {
            layout: "BULLETS",
            title: "Market",
            bullets: [
              "We estimate about 2,000,000 VAT-registered small businesses",
            ],
            bulletsRight: [],
            section: 2,
          },
        ],
      },
    };
    const next = promoteFirmFigures(content, GROUNDING);
    const traction = next.deck?.slides[1];
    expect(figureValues(traction)).toEqual(["1,140", "₦38m", "96%"]);
    expect(traction?.figures?.[0]?.label).toBe(
      "Paying businesses through accountant partners",
    );
    // 590 → 1,140 is drawn, not written.
    expect(traction?.chart?.points).toEqual([
      { label: "Start", value: "590" },
      { label: "After twelve months", value: "1140" },
    ]);
    expect(traction?.bullets).toEqual([]);
    // The title agrees with the figures: a headline, not a sentence.
    expect(traction?.title).toBe(
      "1,140 paying businesses through accountant partners",
    );
    // A hedged estimate stays in words.
    expect(next.deck?.slides[2]?.figures).toBeUndefined();
    expect(next.deck?.slides[2]?.bullets).toEqual([
      "We estimate about 2,000,000 VAT-registered small businesses",
    ]);
  });

  it("never promotes a figure the grounding does not carry", () => {
    const content: QArtifactContent = {
      sections: [{ heading: "Summary", body: "", findings: [] }],
      gaps: [],
      deck: {
        direction: "MINIMAL_INSTITUTIONAL",
        markIsDraft: false,
        slides: [
          {
            layout: "TITLE",
            title: "Ledgerline",
            bullets: [],
            bulletsRight: [],
            section: 0,
          },
          {
            layout: "BULLETS",
            title: "Traction",
            bullets: ["We serve 4,321 paying businesses"],
            bulletsRight: [],
            section: 0,
          },
        ],
      },
    };
    const next = promoteFirmFigures(content, GROUNDING);
    expect(next.deck?.slides[1]?.figures).toBeUndefined();
  });

  it("through the pipeline: a polisher that folds numbers into sentences cannot keep them there", async () => {
    const { content } = await runDocumentPipeline(
      deck(),
      input({ polisher: collapsingPolisher() }),
    );
    const slides = content.deck?.slides ?? [];
    const shown = slides.flatMap(figureValues);
    expect(shown).toEqual(expect.arrayContaining(["1,140", "₦38m", "96%"]));
    // The movement is a chart somewhere in the deck.
    expect(
      slides.some(
        (slide) =>
          slide.chart?.points.map((point) => point.value).join("→") ===
          "590→1140",
      ),
    ).toBe(true);
    // No content title is a sentence any longer.
    for (const slide of slides.slice(1)) {
      expect(slide.title.length).toBeLessThanOrEqual(60);
    }
    expect(
      content.audit?.checks.find((check) => check.code === "FIGURES_GROUNDED")
        ?.ok,
    ).toBe(true);
  });
});

describe("the cover's tagline", () => {
  it("is cut from the opening at a clause, at most twelve words", () => {
    expect(taglineOf(OPENING, "Ledgerline")).toBe(
      "Bookkeeping and tax-compliance software for Nigerian small businesses",
    );
    const long =
      "We help market traders in Kano, Kaduna and Jos buy stock on credit from wholesalers they already know and trust";
    const cut = taglineOf(long, "Tradeline") ?? "";
    expect(cut.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(cut).not.toMatch(/\b(?:and|from|on|in)$/);
  });

  it("the pipeline's cover subtitle is the tagline; a polish over twelve words is not taken", async () => {
    const { content } = await runDocumentPipeline(
      deck(),
      input({ polisher: collapsingPolisher() }),
    );
    expect(content.deck?.slides[0]?.subtitle).toBe(
      "Bookkeeping and tax-compliance software for Nigerian small businesses",
    );
  });

  it("a polished tagline within twelve words is taken", async () => {
    const polisher: DeckPolisher = {
      polish: () =>
        Promise.resolve({
          slides: [
            {
              number: 1,
              title: null,
              subtitle: "Books and VAT, done for Nigerian small businesses",
              bullets: null,
            },
          ],
        }),
    };
    const { content } = await runDocumentPipeline(deck(), input({ polisher }));
    expect(content.deck?.slides[0]?.subtitle).toBe(
      "Books and VAT, done for Nigerian small businesses",
    );
  });
});

describe("the founder's own raise and team", () => {
  const facts = {
    round: {
      amount: "150000000",
      currency: "NGN",
      instrument: "SAFE",
      name: "Seed",
      useOfFunds:
        "Hiring four engineers; opening Port Harcourt and Kano; a year of runway.",
    },
    team: [
      { name: "Amaka Obi", role: "CEO", founder: true },
      { name: "Tunde Bello", role: "CTO", founder: true },
      { name: "Zainab Musa", role: null, founder: false },
    ],
  };

  it("formats money for display from the exact amount", () => {
    expect(formatAmount("150000000", "NGN")).toBe("₦150m");
    expect(formatAmount("2500000", "USD")).toBe("$2.5m");
    expect(formatAmount("750000", "KES")).toBe("KES 750k");
    expect(formatAmount("0", "USD")).toBeNull();
  });

  it("fills The raise and Team from the founder's own records, grounded", async () => {
    const filled = fillOwnSlides(deck(), facts);
    const { content } = await runDocumentPipeline(
      filled.content,
      input({ grounding: [...GROUNDING, ...filled.grounding] }),
    );
    const slides = content.deck?.slides ?? [];
    const topicOf = (slide: QSlide) =>
      content.sections[slide.section]?.heading ?? slide.title;
    const raise = slides.find((slide) => topicOf(slide) === "The raise");
    expect(raise?.placeholder).toBeUndefined();
    expect(figureValues(raise)).toEqual(["₦150m"]);
    expect(raise?.bullets.join(" ")).toMatch(
      /Use of funds: Hiring four engineers/,
    );
    const team = slides.find((slide) => topicOf(slide) === "Team");
    expect(team?.bullets).toEqual([
      "Amaka Obi, CEO",
      "Tunde Bello, CTO",
      "Zainab Musa",
    ]);
    // Photos are theirs: a marked space, never stock.
    expect(team?.placeholder?.kind).toBe("IMAGE");
    expect(content.gaps).not.toContain(expect.stringMatching(/raising|team/i));
    expect(
      content.audit?.checks.find((check) => check.code === "FIGURES_GROUNDED")
        ?.ok,
    ).toBe(true);
  });

  it("without records, The raise and Team are marked placeholders that say what to add", async () => {
    const { content } = await runDocumentPipeline(deck(), input());
    const slides = content.deck?.slides ?? [];
    for (const title of ["The raise", "Team"]) {
      const slide = slides.find((s) => s.title === title);
      expect(slide?.placeholder?.kind).toBe("TEXT");
      expect(slide?.bullets[0]).toMatch(/^Not on record yet\. Add /);
    }
  });

  it("never fills a deck made from public sources", () => {
    const content = deck();
    const draft: QArtifactContent = {
      ...content,
      deck: { ...(content.deck as QDeck), markIsDraft: true },
    };
    expect(fillOwnSlides(draft, facts).grounding).toEqual([]);
  });

  it("no slide is ever empty", () => {
    const content = deck();
    const slides = content.deck?.slides ?? [];
    const emptied: QArtifactContent = {
      ...content,
      deck: {
        ...(content.deck as QDeck),
        slides: [
          ...slides,
          {
            layout: "BULLETS",
            title: "Team",
            bullets: [],
            bulletsRight: [],
            section: 0,
          },
        ],
      },
    };
    const next = neverEmptySlides(emptied).deck?.slides ?? [];
    const last = next[next.length - 1];
    expect(last?.bullets[0]).toMatch(/^Not on record yet/);
    expect(last?.placeholder?.kind).toBe("TEXT");
  });
});
