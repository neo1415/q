import { describe, expect, it } from "vitest";

import {
  FIT_PARAMETER_LABELS,
  FIT_PARAMETERS,
  FitProfileDtoSchema,
  type QAnswerCard,
} from "@capital-q/contracts";

import { withReadableSourceCounts, type RunFit } from "../src/q/fit-cards.js";
import { mandateFitProvenance, tieLine } from "../src/q/fit-integrity.js";
import { fitReasonsAnswer, reasonSubjects } from "../src/q/fit-reasons.js";
import { fitSweepAskOfReading } from "../src/q/fit-sweep.js";
import { readableDocumentCounts } from "../src/q/shared-documents.js";
import { ZINO_RANKED_BLOCK, ZINO_WHY_ASKED } from "./fixtures/zino-9995dcca.js";

/**
 * Replay of production, owner live 17 Nov 2026 (investor Zino Aviation,
 * conversation 9995dcca). The cards are the ones Q stored for "find the
 * strongest companies…" (run ba549abe); the follow-up is run 333d9645's
 * "So, why are they the strongest fits? Don't just repeat the
 * descriptions", which came back as the same ranked list and the same tie
 * line ("…5 of 7 measures known for each, and no source documents yet").
 * The documents each room holds open to Zino are those production holds
 * (2 PUBLIC each for Halyard Security, Tensorgate and Shiftwell; Nixo's
 * room not open to them). Fixture values only; no live call.
 */

const CARDS = ZINO_RANKED_BLOCK.cards;
const idOf = (card: QAnswerCard): string =>
  card.subject?.kind === "COMPANY" ? card.subject.companyId : "";
const byName = (name: string): QAnswerCard => {
  const card = CARDS.find((one) => one.name === name);
  if (card === undefined) throw new Error(`no card ${name}`);
  return card;
};

/** The fit profile behind a stored card, from its own measures. */
function runFitOf(
  card: QAnswerCard,
  override: Partial<Record<string, "STRONG" | "PARTIAL">> = {},
): RunFit {
  const parameters = FIT_PARAMETERS.map((parameter) => {
    const label = FIT_PARAMETER_LABELS[parameter];
    const level =
      override[label] ??
      card.measures.find((measure) => measure.label === label)?.level;
    return {
      parameter,
      outcome:
        level === "STRONG" || level === "PARTIAL" || level === "MISMATCH"
          ? level
          : "UNKNOWN",
      reason: `${label}.`,
      evidenceStatus: null,
      stale: false,
      // Traction and team: no declared preference, so not on the card.
      applicable: level !== undefined,
    };
  });
  return {
    companyId: idOf(card),
    name: card.name,
    line: card.line,
    profile: FitProfileDtoSchema.parse({
      companyId: idOf(card),
      configVersion: "ranking-config.v8",
      configLabel: "8",
      band: "STRONG_FIT",
      confidence: "MEDIUM",
      parameters,
      topReasons: [],
      mainMismatch: null,
      hardRule: null,
      scoreOutOf10: String(card.fit?.score ?? ""),
      computedAt: "2026-11-17T14:52:46.000Z",
    }),
  };
}

const FITS = CARDS.map((card) => runFitOf(card));

describe("9995dcca run 333d9645: 'why are they the strongest fits?' answers the reasons", () => {
  it("the reading's fitReasons scores the companies just shown, never another set", () => {
    const shown = CARDS.map(idOf);
    const ask = fitSweepAskOfReading(
      // The words alone carry no "them"; the reading says why was asked.
      { text: ZINO_WHY_ASKED, count: null, previous: false, reasons: true },
      shown,
      [],
      shown,
    );
    expect(ask.scope).toBe("PREVIOUS");
    expect(ask.within).toEqual(shown);
  });

  it("explains the top tie from their measures: no ranking, no tie line, no score list", () => {
    expect(reasonSubjects(FITS).map((fit) => fit.name)).toEqual([
      "Nixo",
      "Halyard Security",
      "Tensorgate",
      "Shiftwell",
    ]);
    const said = fitReasonsAnswer(FITS);
    expect(said).toBe(
      "Nixo, Halyard Security, Tensorgate and Shiftwell match your mandate on stage, sector, geography, cheque size and business model; every measure on record is a strong match, which is why they're at 10. Thesis and round terms aren't known yet for any of them. That's fit with your mandate, not a judgement of quality.",
    );
    // What run 333d9645 said instead, and must never say again.
    expect(said).not.toMatch(
      /Here are the same|ranked|tied on mandate fit|no source documents|Clearwater|then /u,
    );
  });

  it("with thesis similarity computed (the item-1 fix), the reasons say how far it fits", () => {
    const fits = [
      runFitOf(byName("Nixo"), { Thesis: "PARTIAL" }),
      runFitOf(byName("Halyard Security"), { Thesis: "PARTIAL" }),
      runFitOf(byName("Tensorgate"), { Thesis: "PARTIAL" }),
    ];
    const said = fitReasonsAnswer(fits) ?? "";
    expect(said).toContain("only partly on thesis");
    expect(said).toContain("Round terms isn't known yet");
    expect(said).not.toMatch(/Thesis and round terms/u);
  });

  it("different measures are said apart, each once", () => {
    const said =
      fitReasonsAnswer([
        runFitOf(byName("Clearwater Assurance")),
        runFitOf(byName("Ajopot")),
        runFitOf(byName("Spheros")),
      ]) ?? "";
    expect(said).toContain("Ajopot matches your mandate on stage and sector");
    expect(said).toContain("only partly on geography");
    expect(said).toContain("Clearwater Assurance matches your mandate");
    expect(said.match(/Ajopot/gu)).toHaveLength(1);
  });
});

describe("9995dcca: the tie line and the cards never claim zero documents", () => {
  const tied = CARDS.slice(0, 4);

  it("the tie line no longer says 'no source documents yet'", () => {
    const line = tieLine({ ...ZINO_RANKED_BLOCK, cards: tied });
    expect(line).toBe(
      "Nixo, Halyard Security, Tensorgate and Shiftwell are tied on mandate fit at 10: 5 of 7 measures known for each. That's how well they match your mandate, not a judgement of quality.",
    );
  });

  it("each card counts what its room holds open to the investor, read as them; an unread room stays uncounted", async () => {
    const open = (n: number) => ({
      result: {
        ok: true,
        data: {
          viewer: "INVESTOR",
          documents: Array.from({ length: n }, (_, at) => ({
            documentId: `0000000${String(at)}-0000-4000-8000-000000000000`,
            title: `Public document ${String(at + 1)}`,
            folder: "Company",
            status: "open to you",
          })),
        },
      },
    });
    const reads: string[] = [];
    const counts = await readableDocumentCounts({
      companyIds: CARDS.map(idOf),
      read: (companyId) => {
        reads.push(companyId);
        const name = CARDS.find((card) => idOf(card) === companyId)?.name;
        if (name === "Nixo") {
          // Their room is not open to Zino: locked, never "none".
          return Promise.resolve({
            result: {
              ok: true,
              data: { viewer: "INVESTOR", openRequests: 0, locked: "…" },
            },
          });
        }
        if (name === "Watchly") return Promise.reject(new Error("down"));
        if (name === "Spheros") return new Promise(() => undefined);
        return Promise.resolve(
          name === "Halyard Security" ||
            name === "Tensorgate" ||
            name === "Shiftwell"
            ? open(2)
            : open(0),
        );
      },
      timeoutMs: 20,
    });
    // One read per listed company, bounded to the cards.
    expect(reads).toHaveLength(CARDS.length);
    const id = (name: string) => idOf(byName(name)).toLowerCase();
    expect(counts.get(id("Halyard Security"))).toBe(2);
    expect(counts.get(id("Tensorgate"))).toBe(2);
    expect(counts.get(id("Shiftwell"))).toBe(2);
    expect(counts.has(id("Nixo"))).toBe(false);
    expect(counts.has(id("Watchly"))).toBe(false);
    expect(counts.has(id("Spheros"))).toBe(false);

    const counted = withReadableSourceCounts(ZINO_RANKED_BLOCK, counts);
    const card = (name: string) =>
      counted.cards.find((one) => one.name === name) ?? byName(name);
    expect(card("Halyard Security").sourceCount).toBe(2);
    expect(card("Nixo").sourceCount).toBe(0);
    const said = (name: string) =>
      mandateFitProvenance({ ...card(name), platform: true }) ?? "";
    expect(said("Halyard Security")).toContain(
      "5 of 7 measures known; not a quality score. 2 sources.",
    );
    expect(said("Nixo")).not.toMatch(/source/u);
  });
});
