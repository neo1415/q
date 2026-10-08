import { describe, expect, it } from "vitest";

import type { QAnswerCardsBlock, QResultBlock } from "@capital-q/contracts";
import type { QConversationMessage, QToolPort } from "@capital-q/q-runtime";

import { fitSweepCardsBlock, fitSweepSummary } from "../src/q/fit-cards.js";
import {
  mandateFitProvenance,
  previousCardCompanyIds,
  tieLine,
  withFitIntegrity,
} from "../src/q/fit-integrity.js";
import { fitSweepAsk, runFitSweep } from "../src/q/fit-sweep.js";
import { fitFixture } from "./fit-fixture.js";

/**
 * RECOVERY-2026-10 INC-1 (live 2026-10-08 19:14, conversation c10b845f):
 * "top three companies for my mandate" gave 3 cards; "rank them for me
 * with pros and cons" gave 10; all three scored 8.8 (STRONG×4, PARTIAL×1,
 * UNKNOWN×2 of 7 measures, no sources) and read as a ranking. Fixtures
 * mirror that shape; no provider is called.
 */

const ID = (n: number) =>
  `3ab2cc02-160f-4812-a6b1-${String(n).padStart(12, "0")}`;
const NAMES = [
  "Halyard",
  "Savanna",
  "Clearwater",
  "Ledgerfold",
  "Tensorgate",
  "Ajopot",
  "Kora",
  "Nixo",
  "Portside",
  "Yamfield",
];

/** The incident's profile: 4 strong, 1 partial, 2 unknown of 7 measures. */
function incidentFit(n: number) {
  const outcome = fitFixture(
    ID(n),
    NAMES[n - 1] ?? `Company ${String(n)}`,
    {
      STAGE: "STRONG",
      SECTOR: "STRONG",
      GEOGRAPHY: "STRONG",
      BUSINESS_MODEL: "STRONG",
      TRACTION: "PARTIAL",
    },
    "STRONG_FIT",
  );
  // Seven applicable measures, as live: thesis and team did not apply.
  const data = outcome.result.data as {
    profile: { parameters: { parameter: string; applicable: boolean }[] };
  };
  for (const parameter of data.profile.parameters) {
    if (parameter.parameter === "THESIS" || parameter.parameter === "TEAM") {
      parameter.applicable = false;
    }
  }
  return outcome;
}

/** A tool port that answers fit_profile / fit_top_candidates from fixtures. */
function fitTools(top: number) {
  const asked: string[] = [];
  const port: Pick<QToolPort, "execute"> = {
    execute: (proposal) => {
      asked.push(
        proposal.name === "fit_profile"
          ? String((proposal.arguments as { companyId: string }).companyId)
          : proposal.name,
      );
      if (proposal.name === "fit_top_candidates") {
        const entries = Array.from({ length: top }, (_, index) => {
          const fit = incidentFit(index + 1).result.data as {
            name: string;
            profile: unknown;
          };
          return { name: fit.name, line: null, profile: fit.profile };
        });
        return Promise.resolve({
          callId: proposal.callId,
          toolName: "fit.top_candidates",
          toolVersion: 1,
          classification: "READ_ONLY",
          status: "SUCCEEDED",
          failureCode: null,
          sensitivity: "CONFIDENTIAL",
          result: { ok: true, data: { status: "OK", comparison: { entries } } },
          latencyMs: 1,
        });
      }
      const companyId = String(
        (proposal.arguments as { companyId: string }).companyId,
      );
      const n = Number(companyId.slice(-2));
      return Promise.resolve({
        callId: proposal.callId,
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        latencyMs: 1,
        ...incidentFit(n),
      });
    },
  };
  return { port, asked };
}

const AVAILABLE = new Set(["fit_profile", "fit_top_candidates"]);
const CONTEXT = {} as Parameters<typeof runFitSweep>[0]["context"];

async function sweep(said: string, previous: readonly string[] = []) {
  const ask = fitSweepAsk(said, previous);
  if (ask === null) throw new Error("not a fit question");
  const tools = fitTools(10);
  const result = await runFitSweep({
    ask,
    tools: tools.port,
    context: CONTEXT,
    available: AVAILABLE,
    own: Promise.resolve(null),
  });
  if (result === null) throw new Error("no sweep");
  const fits =
    ask.count === null ? result.fits : result.fits.slice(0, ask.count);
  const block = fitSweepCardsBlock(fits, "Fit against your mandate");
  if (block === null) throw new Error("no block");
  return { ask, block, asked: tools.asked, considered: result.considered };
}

const ids = (blocks: readonly QResultBlock[]) =>
  blocks.flatMap((block) =>
    block.kind === "ANSWER_CARDS"
      ? block.cards.flatMap((card) =>
          card.subject?.kind === "COMPANY" ? [card.subject.companyId] : [],
        )
      : [],
  );

const shownAnswer = (block: QAnswerCardsBlock): QConversationMessage =>
  ({
    id: "m1",
    role: "Q",
    content: "Here are the three.",
    blocks: [block],
  }) as unknown as QConversationMessage;

describe("exact counts (INC-1)", () => {
  it("'top three' is exactly three distinct canonical ids", async () => {
    const said = "top three companies for my mandate";
    const { block } = await sweep(said);
    const out = withFitIntegrity([block], { asked: said, previous: [] });
    expect(ids(out)).toHaveLength(3);
    expect(new Set(ids(out)).size).toBe(3);
  });

  it("one card per company when it arrives by two paths in one message", async () => {
    const said = "top three companies for my mandate";
    const { block } = await sweep(said);
    // The model's own cards repeat a company the sweep already carries.
    const modelCards: QAnswerCardsBlock = {
      ...block,
      title: "Closest to your mandate",
      cards: [block.cards[1], block.cards[0]].flatMap((card) =>
        card === undefined ? [] : [{ ...card, key: `${card.key}-m` }],
      ),
    };
    const out = withFitIntegrity([block, modelCards], {
      asked: said,
      previous: [],
    });
    expect(ids(out)).toEqual([...new Set(ids(out))]);
    expect(ids(out)).toHaveLength(3);
    // The second block, emptied by the dedupe, is dropped.
    expect(out.filter((one) => one.kind === "ANSWER_CARDS")).toHaveLength(1);
  });
});

describe("'rank them' keeps the set just shown (INC-1)", () => {
  it("scores exactly the three shown, never the candidate list", async () => {
    const first = await sweep("top three companies for my mandate");
    const shown = previousCardCompanyIds([shownAnswer(first.block)]);
    expect(shown).toHaveLength(3);

    const follow = await sweep("rank them for me with pros and cons", shown);
    expect(follow.ask.scope).toBe("PREVIOUS");
    expect(follow.ask.count).toBe(3);
    // Only the three were read; the top-candidates list was not asked.
    expect(follow.asked).not.toContain("fit_top_candidates");
    expect([...ids([follow.block])].sort()).toEqual([...shown].sort());
    expect(
      fitSweepSummary({
        block: follow.block,
        scope: follow.ask.scope,
        place: null,
        considered: follow.considered,
        asked: "rank them for me with pros and cons",
      }),
    ).toMatch(/^Here are the same three companies, ranked\./u);
  });

  it("a model's ten cards for 'compare those' are held to the three", async () => {
    const ten = await sweep("show me the best companies for my mandate");
    expect(ids([ten.block])).toHaveLength(10);
    const shown = ids([ten.block]).slice(0, 3);
    const out = withFitIntegrity([ten.block], {
      asked: "compare those for me, pros and cons of them",
      previous: shown,
    });
    expect(ids(out)).toEqual(shown);
  });

  it("without a reference, nothing is narrowed", async () => {
    const ten = await sweep("show me the best companies for my mandate");
    const out = withFitIntegrity([ten.block], {
      asked: "which companies fit my mandate best?",
      previous: ids([ten.block]).slice(0, 3),
    });
    expect(ids(out)).toHaveLength(10);
  });
});

describe("score integrity (INC-1)", () => {
  it("labels every score mandate fit, with how it was made", async () => {
    const said = "top three companies for my mandate";
    const { block } = await sweep(said);
    const [out] = withFitIntegrity([block], { asked: said, previous: [] });
    if (out?.kind !== "ANSWER_CARDS") throw new Error("no cards");
    expect(out.title).toMatch(/mandate/iu);
    for (const card of out.cards) {
      // 4 strong + 1 partial of 5 known: (4×10 + 4) / 5 = 8.8.
      expect(card.fit).toEqual({ score: 8.8, measured: 5, of: 7 });
      expect(card.said).toBe(
        `${card.name}: mandate fit 8.8 out of 10, not a quality score. 5 of 7 measures known (strong 10, good 7.5, partial 4, mismatch 0; unknown left out). No source documents yet.`,
      );
    }
  });

  it("says a tie as a tie, with why", async () => {
    const said = "top three companies for my mandate";
    const { block } = await sweep(said);
    const [out] = withFitIntegrity([block], { asked: said, previous: [] });
    if (out?.kind !== "ANSWER_CARDS") throw new Error("no cards");
    const names = out.cards.map((card) => card.name);
    expect(tieLine(out)).toBe(
      `${names[0] ?? ""}, ${names[1] ?? ""} and ${names[2] ?? ""} are tied on mandate fit at 8.8: 5 of 7 measures known for each, and no source documents yet. That's how well they match your mandate, not a judgement of quality.`,
    );
  });

  it("has nothing to say for a card without a score", () => {
    expect(
      mandateFitProvenance({ name: "Kora", fit: null, sourceCount: 0 }),
    ).toBeNull();
  });
});
