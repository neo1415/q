import { describe, expect, it, vi } from "vitest";

import type { QAnswerCardsBlock, QResultBlock } from "@capital-q/contracts";
import type { QConversationMessage, QToolPort } from "@capital-q/q-runtime";

import { fitSweepCardsBlock, fitSweepSummary } from "../src/q/fit-cards.js";
import {
  mandateFitProvenance,
  namedCardCompanyIds,
  previousCardCompanyIds,
  tieIsAsked,
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

async function sweep(
  said: string,
  previous: readonly string[] = [],
  named: readonly string[] = [],
) {
  const ask = fitSweepAsk(said, previous, named);
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

describe("bounded candidate sweep", () => {
  it("returns the requested three when a ten-company tool result is too large", async () => {
    const execute = vi.fn<QToolPort["execute"]>((proposal) => {
      if (proposal.name === "fit_top_candidates") {
        const limit = (proposal.arguments as { limit: number }).limit;
        // Live response with ten profiles plus disclosed raise views exceeded
        // the existing 32,000-character tool bound. Keep that bound intact.
        if (limit > 3)
          return Promise.resolve({
            callId: proposal.callId,
            toolName: "fit.top_candidates",
            toolVersion: 1,
            classification: "READ_ONLY",
            status: "FAILED",
            failureCode: "RESULT_TOO_LARGE",
            sensitivity: null,
            result: {
              ok: false,
              error: {
                code: "RESULT_TOO_LARGE",
                safeMessage: "Narrow the request.",
              },
            },
            latencyMs: 1,
          });
        const entries = Array.from({ length: limit }, (_, i) => {
          const fit = incidentFit(i + 1).result.data as {
            name: string;
            profile: unknown;
          };
          return { name: fit.name, profile: fit.profile };
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
      return Promise.reject(new Error("No other read needed"));
    });
    const result = await runFitSweep({
      ask: { scope: "CANDIDATES", place: null, fitAsked: true, count: 3 },
      tools: { execute },
      context: CONTEXT,
      available: new Set(["fit_profile", "fit_top_candidates"]),
      own: Promise.resolve(null),
    });
    expect(result?.fits).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].arguments).toEqual({ limit: 3 });
  });

  it("retains the wider candidate window before applying a place filter", async () => {
    const tools = fitTools(10);
    const execute = vi.fn(tools.port.execute);
    await runFitSweep({
      ask: { scope: "CANDIDATES", place: "Kenya", fitAsked: true, count: 3 },
      tools: { execute },
      context: CONTEXT,
      available: new Set(["fit_profile", "fit_top_candidates"]),
      own: Promise.resolve(null),
    });
    expect(execute.mock.calls[0]?.[0].arguments).toEqual({ limit: 10 });
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
        // D2: the insight leads; the platform scale has no Good 7.5.
        `${card.name} is strong on stage, sector, geography and business model, partial on traction; cheque compatibility and round terms not known yet. Capital Q mandate fit 8.8 out of 10, 5 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)`,
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

  it("says a tie only where the turn asked for a ranking (QA F-71: 'Show my pipeline')", () => {
    expect(tieIsAsked({ questionKind: "FIT" })).toBe(true);
    expect(tieIsAsked({ questionKind: "DISCOVER_COMPANIES" })).toBe(true);
    expect(tieIsAsked({ turnKind: "QUESTION_TO_Q" })).toBe(true);
    expect(tieIsAsked({ turnKind: "TOOL_REQUEST" })).toBe(false);
    expect(tieIsAsked({ questionKind: "THEIR_OWN_RECORDS" })).toBe(false);
  });

  it("has nothing to say for a card without a score", () => {
    expect(
      mandateFitProvenance({ name: "Kora", fit: null, sourceCount: 0 }),
    ).toBeNull();
  });
});

describe("explicit names after an evidence follow-up", () => {
  it("reads exactly the two named prior cards and never expands to candidates", async () => {
    const first = await sweep("Show my top three companies against my mandate");
    const prose = {
      ...shownAnswer(first.block),
      blocks: [],
      content: "The company has no verified traction on record.",
    };
    const history = [shownAnswer(first.block), prose];
    expect(previousCardCompanyIds(history)).toEqual([]);
    const text =
      "Compare Halyard and Savanna against my mandate using authorized company records.";
    const named = namedCardCompanyIds(history, text);
    expect(named).toEqual([ID(1), ID(2)]);
    const comparison = await sweep(
      text,
      previousCardCompanyIds(history),
      named,
    );
    expect(comparison.ask.scope).toBe("PREVIOUS");
    expect(comparison.asked).not.toContain("fit_top_candidates");
    expect(ids([comparison.block]).sort()).toEqual([ID(1), ID(2)].sort());
    expect(comparison.block.cards.every((c) => c.fit?.score === 8.8)).toBe(
      true,
    );
  });
  it("ignores unresolved names, partial names and ambiguous canonical identities", async () => {
    const first = await sweep("Show my top three companies against my mandate");
    const altered: QAnswerCardsBlock = {
      ...first.block,
      cards: first.block.cards.map((c, index) =>
        index === 1 ? { ...c, name: "Halyard" } : c,
      ),
    };
    expect(
      namedCardCompanyIds(
        [shownAnswer(altered)],
        "Compare Halyard and Clearwater",
      ),
    ).toEqual([ID(3)]);
    expect(
      namedCardCompanyIds(
        [shownAnswer(first.block)],
        "Compare Superhalyard and an unknown company",
      ),
    ).toEqual([]);
  });
});
