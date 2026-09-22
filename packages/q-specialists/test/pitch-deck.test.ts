import { describe, expect, it } from "vitest";

import { composePitchDeck } from "../src/index.js";
import type {
  CompanyFinding,
  CompanyIntelligenceResult,
} from "../src/company/contracts.js";

/**
 * The investor deck (QX-004 §2, §3.3, §4, §6).
 *
 * A deck is the document a founder puts in front of somebody who may give
 * them money, so it fails in a way a brief does not: a brief that is thin
 * reads as thin, and a deck that is thin reads as confident. Everything
 * here is about refusing to fill that space.
 *
 * **Nothing is invented to fill a slide.** A dimension the record is
 * silent on has no slide, and says so in the gaps.
 *
 * **A chart is grounded or it is absent.** No chart may carry a number
 * the record does not, and every chart says where its numbers came from.
 *
 * **A claim keeps whose claim it is.** The bullet is short; the section
 * behind it keeps the truth class, the evidence status and the finding.
 */

const COMPANY = "f0000000-0000-4000-8000-000000000001";

let seq = 0;
function finding(overrides: Record<string, unknown> = {}): CompanyFinding {
  seq += 1;
  return {
    findingId: `a0000000-0000-4000-8000-00000000000${String(seq % 10)}`,
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

function result(
  overrides: Partial<CompanyIntelligenceResult> = {},
): CompanyIntelligenceResult {
  return {
    companyId: COMPANY,
    specialistVersion: "company-intelligence/v1",
    asOf: "2026-09-22T00:00:00.000Z",
    blocked: null,
    findings: [finding()],
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "MODERATE",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: null,
    telemetry: {} as CompanyIntelligenceResult["telemetry"],
    ...overrides,
  };
}

/** A record with enough in it to make a real deck. */
function populated(extra: readonly CompanyFinding[] = []) {
  return result({
    findings: [
      finding({ dimension: "DESCRIPTION" }),
      finding({
        dimension: "PRODUCT",
        statement: "The product is a mobile app for booking freight capacity.",
      }),
      finding({
        dimension: "TEAM",
        statement: "Three founders, two of them former logistics operators.",
      }),
      ...extra,
    ],
  });
}

describe("QX-004 §3 · what a deck is made of", () => {
  it("builds slides only where the record has something, and names the rest as gaps", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: populated(),
    });
    expect(deck).not.toBeNull();
    const slides = deck?.content.deck?.slides ?? [];
    // Title, plus one per dimension that had findings. Nothing else.
    expect(slides[0]?.layout).toBe("TITLE");
    expect(slides.map((s) => s.title)).toEqual([
      "Northstar Logistics",
      "What we do",
      "Product",
      "Team",
    ]);
    // And the dimensions nobody said anything about are named, not filled.
    expect(deck?.content.gaps).toContain("Traction");
    expect(deck?.content.gaps).toContain("What is being raised, and for what");
  });

  it("keeps whose claim each bullet is, in the section behind the slide", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: populated(),
    });
    const slides = deck?.content.deck?.slides ?? [];
    const product = slides.find((s) => s.title === "Product");
    expect(product).toBeDefined();
    const section = deck?.content.sections[product?.section ?? -1];
    // The slide is short; the section carries the qualification and the
    // finding itself, with its truth class intact.
    expect(section?.body).toContain("(stated by the company)");
    expect(section?.findings[0]?.truthClass).toBe("USER_CLAIM");
    expect(section?.findings[0]?.evidenceStatus).toBe("SELF_REPORTED");
  });

  it("refuses to produce a deck from a record that has nothing in it", () => {
    expect(
      composePitchDeck({
        companyName: "Northstar Logistics",
        result: result({ findings: [] }),
      }),
    ).toBeNull();
  });

  it("does not let a synthesis that invents a figure onto the title slide", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: result({
        findings: populated().findings,
        // Nobody recorded 4,000 shipments. It must not reach a slide.
        synthesis: "Northstar runs 4,000 shipments a month and is growing.",
      }),
    });
    const slides = deck?.content.deck?.slides ?? [];
    expect(slides[0]?.subtitle ?? "").not.toContain("4,000");
    expect(deck?.content.sections[0]?.body ?? "").not.toContain("4,000");
  });

  it("carries a synthesis that invents nothing", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: result({
        findings: populated().findings,
        synthesis: "Northstar moves freight between Lagos and Abuja.",
      }),
    });
    expect(deck?.content.deck?.slides[0]?.subtitle).toContain("Lagos");
  });
});

describe("QX-004 §4, §6 · a chart is grounded or it is absent", () => {
  it("draws traction only from figures the record carries, and says where they came from", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: populated([
        finding({
          dimension: "TRACTION",
          statement: "Completed 320 deliveries in June.",
        }),
        finding({
          dimension: "TRACTION",
          statement: "Completed 480 deliveries in July.",
        }),
      ]),
    });
    const slides = deck?.content.deck?.slides ?? [];
    const traction = slides.find((s) => s.title === "Traction");
    expect(traction?.layout).toBe("CHART");
    expect(traction?.chart?.points.map((p) => p.value)).toEqual(["320", "480"]);
    // Every number on it traces back to a sentence somebody can check.
    expect(traction?.chart?.grounding).toContain("320 deliveries in June");
    expect(traction?.chart?.grounding).toContain("480 deliveries in July");
  });

  it("omits the chart and keeps the words when there is only one number", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: populated([
        finding({
          dimension: "TRACTION",
          statement: "Completed 320 deliveries in June.",
        }),
      ]),
    });
    const traction = (deck?.content.deck?.slides ?? []).find(
      (s) => s.title === "Traction",
    );
    expect(traction?.chart).toBeUndefined();
    expect(traction?.bullets[0]).toContain("320 deliveries");
  });

  it("does not mistake a year for a measurement", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: populated([
        finding({ dimension: "TRACTION", statement: "Founded in 2021." }),
        finding({
          dimension: "TRACTION",
          statement: "First freight route opened in 2023.",
        }),
      ]),
    });
    const traction = (deck?.content.deck?.slides ?? []).find(
      (s) => s.title === "Traction",
    );
    expect(traction?.chart).toBeUndefined();
  });

  it("refuses to plot two numbers that are not the same kind of thing", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: populated([
        finding({
          dimension: "FINANCIAL",
          statement: "Revenue of $40,000 last quarter.",
        }),
        finding({
          dimension: "FINANCIAL",
          statement: "Gross margin of 35%.",
        }),
      ]),
    });
    const financial = (deck?.content.deck?.slides ?? []).find(
      (s) => s.title === "Financial position",
    );
    // A dollar amount and a percentage on one axis is a misleading chart.
    expect(financial?.chart).toBeUndefined();
    expect(financial?.layout).toBe("BULLETS");
  });
});

describe("QX-004 §3.3 · the deck says how it should look, and nothing more", () => {
  it("records the direction and leaves every size and position to the renderer", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: populated(),
      direction: "DARK_TECHNICAL",
      accent: "#1b3a5c",
    });
    expect(deck?.content.deck?.direction).toBe("DARK_TECHNICAL");
    expect(deck?.content.deck?.accent).toBe("#1b3a5c");
    expect(deck?.content.deck?.markIsDraft).toBe(false);
    // Nothing in a slide describes how it is drawn.
    const slide = deck?.content.deck?.slides[1];
    expect(Object.keys(slide ?? {}).sort()).toEqual([
      "bullets",
      "bulletsRight",
      "layout",
      "section",
      "title",
    ]);
  });

  it("defaults to the institutional direction when nobody chose one", () => {
    const deck = composePitchDeck({
      companyName: "Northstar Logistics",
      result: populated(),
    });
    expect(deck?.content.deck?.direction).toBe("MINIMAL_INSTITUTIONAL");
  });
});
