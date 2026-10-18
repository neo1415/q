import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  unknownDeckSection,
  type CompanyDeckView,
  type DeckFact,
} from "@capital-q/contracts";

import {
  assess,
  confirmedDeckFigures,
  READINESS_RULES_V1,
  type ReadinessInputs,
} from "../src/index.js";

/**
 * F29: Ledgerline's confirmed deck gives dated TAM/SAM/SOM and traction
 * figures, yet Readiness kept asking "Share your traction figures" and
 * "Source your market size" as if nothing was given. Confirmed deck
 * figures are the founder's stated claims: traction closes; market size
 * stays open for a source, with words that say the deck states it.
 */

const DECK_ID = "11111111-1111-4111-8111-111111111129";

const fact = (label: string, value: string): DeckFact => ({
  label,
  value,
  unknownReason: null,
  kind: "FIGURE",
  asOf: "Sep 2026",
  pages: [5],
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  confidence: "HIGH",
});

function extraction(
  confirmed: boolean,
  states?: NonNullable<CompanyDeckView["extraction"]>["sectionStates"],
): NonNullable<CompanyDeckView["extraction"]> {
  return {
    extractionId: "22222222-2222-4222-8222-222222222229",
    readAt: "2026-10-07T09:00:00.000Z",
    versionNumber: 1,
    confirmed,
    ...(states === undefined ? {} : { sectionStates: states }),
    sections: DECK_SECTIONS.map((code) =>
      code === "MARKET"
        ? {
            ...unknownDeckSection(code),
            status: "PRESENT" as const,
            summary: "TAM ₦1.2tn, SAM ₦310bn, SOM ₦18bn (bottom-up).",
            facts: [fact("TAM", "₦1.2tn"), fact("SOM", "₦18bn")],
          }
        : code === "TRACTION"
          ? {
              ...unknownDeckSection(code),
              status: "PRESENT" as const,
              summary: "1,140 paying businesses, ₦38m MRR, 96% retention.",
              facts: [
                fact("Paying businesses", "1,140"),
                fact("MRR", "₦38m"),
                { ...fact("Retention", "96%"), truthClass: "Q_INFERENCE" },
              ],
            }
          : unknownDeckSection(code),
    ),
  };
}

const LEDGERLINE = (
  figures: ReturnType<typeof confirmedDeckFigures>,
): ReadinessInputs => ({
  stageCode: "seed",
  profile: { description: true, website: true, categories: 2 },
  team: {
    founderCount: 2,
    fullTimeFounderCount: 2,
    teamSize: 9,
    founderBackgrounds: 2,
    verifiedFounderIdentities: 0,
  },
  verification: { organisation: false, domain: false },
  claims: [],
  deck: { documentId: DECK_ID, sections: null, figures },
  dataRoom: null,
  raise: null,
  followUps: [],
});

const action = (inputs: ReadinessInputs, key: string) =>
  assess(inputs, READINESS_RULES_V1).actions.find((a) => a.key === key);

describe("confirmed deck figures close readiness gaps (F29)", () => {
  it("Ledgerline: traction closes and market size asks only for a source", () => {
    const figures = confirmedDeckFigures(extraction(true));
    expect(figures.map((f) => f.value)).toEqual([
      "₦1.2tn",
      "₦18bn",
      "1,140",
      "₦38m",
    ]);
    const inputs = LEDGERLINE(figures);
    expect(action(inputs, "traction-figures")?.state).toBe("DONE_BY_EVIDENCE");
    const market = action(inputs, "source-market");
    expect(market?.state).toBe("OPEN");
    expect(market?.next).toMatch(/deck states your market size/);
    const blocker = assess(inputs, READINESS_RULES_V1).blockers.find(
      (b) => b.id === "market.size",
    );
    if (blocker !== undefined) expect(blocker.kind).toBe("UNSUPPORTED");
  });

  it("an unconfirmed reading changes nothing", () => {
    const figures = confirmedDeckFigures(extraction(false));
    expect(figures).toEqual([]);
    expect(action(LEDGERLINE(figures), "traction-figures")?.state).toBe("OPEN");
  });

  it("per section: only confirmed sections count, a dismissed one never", () => {
    const figures = confirmedDeckFigures(
      extraction(false, [
        ...DECK_SECTIONS.map((section) => ({
          section,
          state: "PENDING" as const,
        })).filter((s) => s.section !== "TRACTION" && s.section !== "MARKET"),
        { section: "TRACTION", state: "CONFIRMED" },
        { section: "MARKET", state: "DISMISSED" },
      ]),
    );
    expect(new Set(figures.map((f) => f.section))).toEqual(
      new Set(["TRACTION"]),
    );
  });
});
