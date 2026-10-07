import { describe, expect, it } from "vitest";

import type { QDocumentPipelineStage, QSlideImage } from "@capital-q/contracts";

import {
  composeGeneralDocument,
  composePitchDeck,
  runDocumentPipeline,
  type DocumentPipelineInput,
  type IllustrationPort,
  type StockPhotoPort,
} from "../src/index.js";
import type {
  CompanyFinding,
  CompanyIntelligenceResult,
} from "../src/company/contracts.js";

/**
 * Q room W5 (R8): the document pipeline with fake providers only. No
 * provider is reached: photos, pictures and the words step are fakes.
 *
 * - Unknown stays a marked placeholder, never an invented number.
 * - Pictures: own first, stock next, at most six generated, and a billing
 *   refusal ends generation at once (fallback to stock or a placeholder).
 * - Every stock photo's credit is in the slide's notes.
 * - The checker's fix loop runs at most twice and ships with notes.
 */

const COMPANY = "f0000000-0000-4000-8000-000000000001";
let seq = 0;
function finding(overrides: Record<string, unknown> = {}): CompanyFinding {
  seq += 1;
  return {
    findingId: `a0000000-0000-4000-8000-0000000000${String(10 + (seq % 80))}`,
    type: "FACT",
    statement: "Northstar Logistics moves freight between Lagos and Abuja.",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    evidenceRefs: [],
    dimension: "DESCRIPTION",
    derivation: "MODEL",
    ...overrides,
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

const FINDINGS = [
  finding({ dimension: "DESCRIPTION" }),
  finding({
    dimension: "PRODUCT",
    statement: "The product is a mobile app for booking freight capacity.",
  }),
  finding({
    dimension: "STRATEGY",
    statement: "Next, the company plans to add cold-chain routes.",
  }),
  finding({
    dimension: "MARKET",
    statement: "Shippers in Nigeria book most freight by phone today.",
  }),
  finding({
    dimension: "TEAM",
    statement: "Three founders, two of them former logistics operators.",
  }),
];
const GROUNDING = FINDINGS.map((item) => item.statement);

function deck() {
  const composed = composePitchDeck({
    companyName: "Northstar Logistics",
    result: result(FINDINGS),
  });
  if (composed === null) throw new Error("fixture deck did not compose");
  return composed.content;
}

const PHOTO = (n: number): QSlideImage => ({
  url: `https://images.pexels.com/photos/${String(n)}/a.jpeg`,
  alt: "Trucks",
  credit: `Photo by Ada ${String(n)} on Pexels`,
});

function photos(): StockPhotoPort & { calls: number } {
  let n = 0;
  const port = {
    calls: 0,
    search: () => {
      port.calls += 1;
      n += 1;
      return Promise.resolve([PHOTO(n)]);
    },
  };
  return port;
}

function generated(id: number): QSlideImage {
  return {
    url: `cq-image:a1000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    alt: "Abstract (AI-generated)",
    credit: "AI-generated image · Capital Q",
    provenance: "AI_GENERATED",
  };
}

function base(
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
      correlationId:
        "33333333-0000-4000-8000-000000000001" as DocumentPipelineInput["attribution"]["correlationId"],
    },
    ...overrides,
  };
}

const figuresIn = (text: string) => text.match(/\d[\d,.]*/g) ?? [];

describe("the document pipeline", () => {
  it("runs its stages in order and says each one", async () => {
    const stages: QDocumentPipelineStage[] = [];
    await runDocumentPipeline(
      deck(),
      base({ onStage: (s) => void stages.push(s) }),
    );
    expect(stages).toEqual([
      "WRITING",
      "DESIGNING",
      "FINDING_ASSETS",
      "CHECKING",
      "READY",
    ]);
  });

  it("marks what the record does not hold, and invents no number", async () => {
    const { content } = await runDocumentPipeline(deck(), base());
    const slides = content.deck?.slides ?? [];
    const traction = slides.find((slide) => slide.title === "Traction");
    expect(traction?.placeholder).toEqual({
      kind: "TEXT",
      label: "Revenue, users or growth: add yours",
    });
    expect(traction?.bullets).toEqual([]);
    // Placeholders sit in reading order: traction after the market.
    const titles = slides.map((slide) => slide.title);
    expect(titles.indexOf("Traction")).toBeGreaterThan(
      titles.indexOf("Market"),
    );
    expect(titles.indexOf("Traction")).toBeLessThan(titles.indexOf("Team"));
    // No figure on any slide that the record does not carry.
    const known = new Set(figuresIn(GROUNDING.join(" ")));
    for (const slide of slides) {
      for (const text of [
        slide.title,
        slide.subtitle ?? "",
        ...slide.bullets,
      ]) {
        for (const figure of figuresIn(text)) expect(known).toContain(figure);
      }
    }
    expect(
      content.audit?.checks.find((c) => c.code === "FIGURES_GROUNDED")?.ok,
    ).toBe(true);
  });

  it("keeps team and product pictures for the person: marked, never stock", async () => {
    const stock = photos();
    const { content } = await runDocumentPipeline(
      deck(),
      base({ photos: stock }),
    );
    const team = content.deck?.slides.find((slide) => slide.title === "Team");
    const product = content.deck?.slides.find(
      (slide) => slide.title === "Product",
    );
    expect(team?.image).toBeUndefined();
    expect(team?.placeholder).toEqual({
      kind: "IMAGE",
      label: "Team photo: drop yours here",
    });
    expect(product?.placeholder?.kind).toBe("IMAGE");
  });

  it("uses the person's own picture first when there is one", async () => {
    const own: QSlideImage = {
      url: "cq-image:a1000000-0000-4000-8000-0000000000aa",
      alt: "Product screenshot",
      credit: "Your upload",
      provenance: "OWN_UPLOAD",
    };
    const { content } = await runDocumentPipeline(
      deck(),
      base({
        ownPictures: {
          pictureFor: ({ slideTitle }) =>
            Promise.resolve(slideTitle === "Product" ? own : null),
        },
      }),
    );
    const product = content.deck?.slides.find(
      (slide) => slide.title === "Product",
    );
    expect(product?.image).toEqual(own);
    expect(product?.placeholder).toBeUndefined();
  });

  it("puts every picture's credit in the slide's notes (Pexels attribution)", async () => {
    const { content } = await runDocumentPipeline(
      deck(),
      base({ photos: photos() }),
    );
    const pictured = (content.deck?.slides ?? []).filter(
      (slide) => slide.image !== undefined,
    );
    expect(pictured.length).toBeGreaterThan(0);
    for (const slide of pictured) {
      expect(slide.note).toContain(`Picture: ${slide.image?.credit ?? ""}`);
      expect(slide.image?.credit).toMatch(/on Pexels$/);
    }
  });

  it("asks for at most six generated pictures, whatever is asked", async () => {
    let asked = 0;
    const illustrations: IllustrationPort = {
      illustrate: () => {
        asked += 1;
        return Promise.resolve(generated(asked));
      },
    };
    // A deck long enough to want more than six pictures.
    const content = deck();
    const many = {
      ...content,
      deck: {
        ...(content.deck ?? {
          slides: [],
          direction: "MINIMAL_INSTITUTIONAL",
          markIsDraft: false,
        }),
        slides: [
          ...(content.deck?.slides ?? []),
          ...Array.from({ length: 10 }, (_, index) => ({
            layout: "BULLETS" as const,
            title: `Theme ${String(index + 1)}`,
            bullets: ["Shippers in Nigeria book most freight by phone today."],
            bulletsRight: [],
            section: 0,
          })),
        ],
      },
    };
    const { content: out } = await runDocumentPipeline(
      many,
      base({ illustrations, generatedLimit: 20 }),
    );
    expect(asked).toBe(6);
    expect(
      (out.deck?.slides ?? []).filter(
        (slide) => slide.image?.provenance === "AI_GENERATED",
      ),
    ).toHaveLength(6);
  });

  it("a billing refusal ends generation at once and falls back to stock photos", async () => {
    let asked = 0;
    const illustrations: IllustrationPort = {
      // The image port answers null when the gateway reports BILLING.
      illustrate: () => {
        asked += 1;
        return Promise.resolve(null);
      },
    };
    const stock = photos();
    const { content } = await runDocumentPipeline(
      deck(),
      base({ illustrations, photos: stock }),
    );
    // One ask, no loop.
    expect(asked).toBeLessThanOrEqual(1);
    const slides = content.deck?.slides ?? [];
    expect(
      slides.some((slide) => slide.image?.credit.endsWith("on Pexels")),
    ).toBe(true);
    expect(
      slides.every((slide) => slide.image?.provenance !== "AI_GENERATED"),
    ).toBe(true);
    // And the document still ships.
    expect(content.audit).toBeDefined();
  });

  it("shortens a wordy slide in at most two rounds and records the rubric", async () => {
    const wordy = deck();
    const slides = wordy.deck?.slides ?? [];
    const long =
      "Shippers in Nigeria book most freight by phone today and wait days for a quote while trucks run empty on the return leg between the two cities.";
    const out = await runDocumentPipeline(
      {
        ...wordy,
        deck: {
          ...(wordy.deck ?? {
            slides: [],
            direction: "MINIMAL_INSTITUTIONAL",
            markIsDraft: false,
          }),
          slides: slides.map((slide) =>
            slide.title === "Market"
              ? { ...slide, bullets: [long, long, long] }
              : slide,
          ),
        },
      },
      base(),
    );
    expect(out.rounds).toBeGreaterThanOrEqual(1);
    expect(out.rounds).toBeLessThanOrEqual(2);
    const market = out.content.deck?.slides.find(
      (slide) => slide.title === "Market",
    );
    const words = (market?.bullets ?? []).join(" ").split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(40);
    expect(out.content.audit?.rubric?.rounds).toBe(out.rounds);
    expect(out.content.audit?.rubric?.content).toBeGreaterThanOrEqual(4);
  });

  it("a critic that always objects stops after two rounds and the document ships with notes", async () => {
    let reviews = 0;
    const out = await runDocumentPipeline(
      deck(),
      base({
        critic: {
          review: () => {
            reviews += 1;
            return Promise.resolve([{ kind: "DEDUPE_TITLE", slide: 1 }]);
          },
        },
      }),
    );
    expect(out.rounds).toBe(2);
    expect(reviews).toBe(2);
    expect(out.content.audit).toBeDefined();
  });
});

describe("general documents through the same pipeline", () => {
  it("a one-pager keeps each section short, with gaps named and no deck", async () => {
    const composed = composeGeneralDocument({
      kind: "ONE_PAGER",
      companyName: "Northstar Logistics",
      result: result(FINDINGS),
    });
    expect(composed?.title).toBe("Northstar Logistics — one-pager");
    const stages: QDocumentPipelineStage[] = [];
    const out = await runDocumentPipeline(
      composed?.content ?? { sections: [], gaps: [] },
      base({ kind: "ONE_PAGER", onStage: (s) => void stages.push(s) }),
    );
    expect(out.content.deck).toBeUndefined();
    expect(stages).not.toContain("FINDING_ASSETS");
    for (const section of out.content.sections) {
      expect(section.body.split(/\s+/).length).toBeLessThanOrEqual(71);
    }
    expect(out.content.gaps).toContain("Traction");
    expect(out.content.audit?.rubric).toBeDefined();
  });

  it("a memo is the full brief under its own title", () => {
    const composed = composeGeneralDocument({
      kind: "MEMO",
      companyName: "Northstar Logistics",
      result: result(FINDINGS),
    });
    expect(composed?.title).toBe("Northstar Logistics — investment memo");
    expect(composed?.content.sections.length).toBeGreaterThan(2);
  });
});
