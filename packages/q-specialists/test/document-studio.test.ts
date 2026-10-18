import { describe, expect, it } from "vitest";

import {
  CorrelationIdSchema,
  QArtifactContentSchema,
  type QArtifactContent,
} from "@capital-q/contracts";

import {
  applyPolish,
  auditDocument,
  brandDeck,
  designDeck,
  keepOnlyGroundedVisuals,
  refineCharts,
  runDocumentStudio,
  ungroundedFigures,
  type DeckPolisher,
} from "../src/index.js";

/**
 * DOCS: the document studio's steps. The property under test throughout:
 * no step puts a number on a slide that the record does not carry.
 */

const GROUNDING = [
  "Northstar moves freight between Lagos and Abuja.",
  "Northstar completed 320 deliveries in June.",
  "Northstar completed 1,200 deliveries in September.",
  "Northstar has 14 trucks under contract.",
];

function deck(): QArtifactContent {
  return QArtifactContentSchema.parse({
    sections: [
      { heading: "Summary", body: GROUNDING[0], findings: [] },
      { heading: "Traction", body: GROUNDING.slice(1).join(" "), findings: [] },
    ],
    gaps: ["Team", "Financial performance and runway", "Customers", "Market"],
    deck: {
      slides: [
        { layout: "TITLE", title: "Northstar", section: 0 },
        {
          layout: "CHART",
          title: "Traction",
          subtitle: "Northstar completed 1,200 deliveries in September.",
          chart: {
            kind: "COLUMN",
            measure: "From the record",
            unit: "count",
            points: [
              {
                label: "Northstar completed 320 deliveries in June",
                value: "320",
              },
              { label: "September", value: "1200" },
            ],
            grounding: "Read from what Capital Q holds.",
          },
          section: 1,
        },
        {
          layout: "BULLETS",
          title: "Fleet",
          bullets: ["Northstar has 14 trucks under contract."],
          figures: [{ value: "14", label: "trucks under contract" }],
          section: 1,
        },
      ],
    },
  });
}

const ATTRIBUTION = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  qRunId: "22222222-0000-4000-8000-000000000001",
  correlationId: CorrelationIdSchema.parse(
    "cor_33333333-0000-4000-8000-000000000001",
  ),
};

describe("figure provenance", () => {
  it("a composed deck carries only grounded figures (1,200 and 1200 are one figure)", () => {
    expect(ungroundedFigures(deck(), GROUNDING)).toEqual([]);
  });

  it("names an invented figure in a bullet, a chart point and a figure tile", () => {
    const content = deck();
    const slides = content.deck?.slides ?? [];
    const tampered = QArtifactContentSchema.parse({
      ...content,
      deck: {
        ...content.deck,
        slides: [
          slides[0],
          {
            ...slides[1],
            chart: {
              ...slides[1]?.chart,
              points: [
                { label: "June", value: "320" },
                { label: "October", value: "5000" },
              ],
            },
          },
          {
            ...slides[2],
            bullets: ["Northstar has 40 customers."],
            figures: [{ value: "99%", label: "on-time" }],
          },
        ],
      },
    });
    expect(ungroundedFigures(tampered, GROUNDING)).toEqual([
      { slide: 2, figure: "5000" },
      { slide: 3, figure: "40" },
      { slide: 3, figure: "99" },
    ]);
    const audit = auditDocument(tampered, GROUNDING);
    expect(audit.passed).toBe(false);
    expect(
      audit.checks.find((c) => c.code === "FIGURES_GROUNDED"),
    ).toMatchObject({
      ok: false,
      note: "Slide 2 shows 5000, which the record does not carry.",
    });

    // The visuals that carry them come off the slide; the prose stays.
    const kept = keepOnlyGroundedVisuals(tampered, GROUNDING);
    expect(kept.deck?.slides[1]?.chart).toBeUndefined();
    expect(kept.deck?.slides[1]?.layout).toBe("BULLETS");
    expect(kept.deck?.slides[2]?.figures).toBeUndefined();
    expect(kept.sections).toEqual(tampered.sections);
  });
});

describe("words", () => {
  it("keeps any rewrite that adds a figure, and never retitles the cover", () => {
    const polished = applyPolish(
      deck(),
      {
        slides: [
          {
            number: 1,
            title: "The future of freight",
            subtitle: null,
            bullets: null,
          },
          {
            number: 2,
            title: "Deliveries grew from 320 to 1,200",
            subtitle: "Up 275% in three months.",
            bullets: null,
          },
          {
            number: 3,
            title: "A fleet of 14 trucks",
            subtitle: null,
            bullets: ["14 trucks are under contract, with 30 more planned."],
          },
        ],
      },
      GROUNDING,
    );
    const slides = polished.deck?.slides ?? [];
    expect(slides[0]?.title).toBe("Northstar");
    expect(slides[1]?.title).toBe("Deliveries grew from 320 to 1,200");
    // 275 and three are nowhere in the record: the old line stays.
    expect(slides[1]?.subtitle).toBe(
      "Northstar completed 1,200 deliveries in September.",
    );
    expect(slides[2]?.title).toBe("A fleet of 14 trucks");
    expect(slides[2]?.bullets).toEqual([
      "Northstar has 14 trucks under contract.",
    ]);
    expect(ungroundedFigures(polished, GROUNDING)).toEqual([]);
  });
});

describe("design and brand", () => {
  it("takes the sector's direction only when none was chosen and no brand applies", () => {
    expect(
      designDeck(deck(), { sectorCodes: ["agritech"], directionChosen: false })
        .deck,
    ).toMatchObject({
      direction: "WARM_GROWTH",
      brand: { pairing: "SOURCE_SANS_FRAUNCES" },
    });
    expect(
      designDeck(deck(), { sectorCodes: ["agritech"], directionChosen: true })
        .deck?.direction,
    ).toBe("MINIMAL_INSTITUTIONAL");
  });

  it("applies the confirmed kit; a text colour that would not read is not used", () => {
    const branded = brandDeck(deck(), {
      kitVersion: 4,
      palette: { primary: "#0b6e4f", background: "#ffffff", ink: "#f2f2f2" },
      pairing: "INTER_ONLY",
    });
    expect(branded.deck).toMatchObject({
      accent: "#0b6e4f",
      background: "#ffffff",
      brand: { kitVersion: 4, pairing: "INTER_ONLY" },
    });
    expect(branded.deck?.ink).toBeUndefined();
    const readable = brandDeck(deck(), {
      kitVersion: 4,
      palette: { primary: "#0b6e4f", ink: "#1a1a1a" },
    });
    expect(readable.deck?.ink).toBe("#1a1a1a");
    // A brand never applies a design the person did not confirm.
    expect(brandDeck(deck(), null)).toEqual(deck());
  });
});

describe("charts", () => {
  it("long labels become horizontal bars, and every chart prints its source", () => {
    const chart = refineCharts(deck()).deck?.slides[1]?.chart;
    expect(chart?.kind).toBe("BAR");
    expect(chart?.source).toBe("the company's record on Capital Q");
  });
});

describe("the whole studio", () => {
  it("runs every step, audits the result, and suggests what to add", async () => {
    const calls: unknown[] = [];
    const polisher: DeckPolisher = {
      polish: (input) => {
        calls.push(input.deck.slides.length);
        return Promise.resolve({
          slides: [
            {
              number: 3,
              title: "Fleet: 14 trucks under contract",
              subtitle: null,
              bullets: null,
            },
          ],
        });
      },
    };
    const content = await runDocumentStudio(deck(), {
      grounding: GROUNDING,
      sectorCodes: ["logistics"],
      directionChosen: false,
      brand: null,
      polisher,
      sensitivity: "CONFIDENTIAL",
      attribution: ATTRIBUTION,
    });
    expect(calls).toEqual([3]);
    expect(content.deck?.slides[2]?.title).toBe(
      "Fleet: 14 trucks under contract",
    );
    expect(content.audit?.passed).toBe(true);
    expect(content.audit?.checks.map((check) => check.code)).toEqual([
      "LAYOUT_FITS",
      "TEXT_CONTRAST",
      "FIGURES_GROUNDED",
      "CHARTS_SOURCED",
      "IMAGES_CREDITED",
    ]);
    expect(content.audit?.suggestions).toEqual([
      "Team: not on record yet. Tell Q and it will add it.",
      "Financial performance and runway: not on record yet. Tell Q and it will add it.",
      "Customers: not on record yet. Tell Q and it will add it.",
    ]);
    // What is stored still satisfies the contract.
    expect(QArtifactContentSchema.parse(content)).toEqual(content);
  });

  it("files the deck as composed when the words step fails", async () => {
    const content = await runDocumentStudio(deck(), {
      grounding: GROUNDING,
      sectorCodes: [],
      directionChosen: true,
      brand: null,
      polisher: { polish: () => Promise.resolve(null) },
      sensitivity: "CONFIDENTIAL",
      attribution: ATTRIBUTION,
    });
    expect(content.deck?.slides.map((slide) => slide.title)).toEqual([
      "Northstar",
      "Traction",
      "Fleet",
    ]);
  });
});
