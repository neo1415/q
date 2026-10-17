import { describe, expect, it } from "vitest";

import type { QConversationMessage, QToolPort } from "@capital-q/q-runtime";

import { fitSweepCardsBlock, fitSweepSummary } from "../src/q/fit-cards.js";
import {
  previousCardCompanyIds,
  shownCardCompanyIds,
} from "../src/q/fit-integrity.js";
import { fitSweepAskOfReading, runFitSweep } from "../src/q/fit-sweep.js";
import { fitFixture } from "./fit-fixture.js";

/**
 * TURN_READER v56 (production 2026-10-17, conversation 4f07dae7): after the
 * top three (Ledgerfold, Basketari, Brancheon Works), "give me three new
 * companies that fit my mandate" returned Ledgerfold and Basketari again.
 * With the reader's `excludeShown`, the same deterministic ranking leaves
 * the shown companies out and returns the next best. Fixtures only.
 */

const ID = (n: number) =>
  `3ab2cc02-160f-4812-a6b1-${String(n).padStart(12, "0")}`;
const NAMES = [
  "Ledgerfold",
  "Basketari",
  "Brancheon Works",
  "Halyard",
  "Savanna",
  "Clearwater",
  "Tensorgate",
  "Ajopot",
  "Kora",
  "Nixo",
];
const SHOWN = [ID(1), ID(2), ID(3)];
const FIT_TOOLS = new Set(["fit_profile", "fit_top_candidates"]);

/** The same profile for all, so the platform's own order decides. */
function profileOf(n: number) {
  return fitFixture(
    ID(n),
    NAMES[n - 1] ?? `Company ${String(n)}`,
    { STAGE: "STRONG", SECTOR: "STRONG", GEOGRAPHY: "STRONG" },
    "STRONG_FIT",
  ).result.data as { name: string; profile: unknown };
}

/**
 * A port standing in for the authorised tools: fit_top_candidates returns
 * the platform's top `limit` of `pool` candidates, in its order; fit_profile
 * answers only for ids it holds. Every call is recorded.
 */
function fitTools(pool: number, readable: ReadonlySet<string> = new Set()) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const port: Pick<QToolPort, "execute"> = {
    execute: (proposal) => {
      const args = proposal.arguments as Record<string, unknown>;
      calls.push({ name: proposal.name, args });
      const base = {
        callId: proposal.callId,
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        latencyMs: 1,
      } as const;
      if (proposal.name === "fit_top_candidates") {
        const limit = Number(args["limit"] ?? 3);
        const entries = Array.from(
          { length: Math.min(limit, pool) },
          (_, i) => {
            const fit = profileOf(i + 1);
            return { name: fit.name, line: null, profile: fit.profile };
          },
        );
        return Promise.resolve({
          ...base,
          toolName: "fit.top_candidates",
          result: { ok: true, data: { status: "OK", comparison: { entries } } },
        });
      }
      const companyId = String(args["companyId"]);
      if (!readable.has(companyId)) {
        return Promise.resolve({
          ...base,
          toolName: "fit.profile",
          status: "FAILED",
          failureCode: "NOT_AUTHORISED",
          result: { ok: false, error: { code: "NOT_AUTHORISED" } },
        } as never);
      }
      const fit = fitFixture(companyId, "Own", { STAGE: "STRONG" });
      return Promise.resolve({ ...base, ...fit });
    },
  };
  return { port, calls };
}

async function sweepOf(input: {
  readonly excludeShown: boolean;
  readonly count: number | null;
  readonly pool: number;
  readonly shown?: readonly string[];
  readonly own?: unknown;
  readonly readable?: ReadonlySet<string>;
}) {
  const shown = input.shown ?? SHOWN;
  const ask = fitSweepAskOfReading(
    {
      text: "give me three new companies that fit my mandate",
      count: input.count,
      previous: false,
      excludeShown: input.excludeShown,
    },
    shown,
    [],
    shown,
  );
  const tools = fitTools(input.pool, input.readable);
  const result = await runFitSweep({
    ask,
    tools: tools.port,
    context: {} as Parameters<typeof runFitSweep>[0]["context"],
    available: FIT_TOOLS,
    own: Promise.resolve(input.own ?? null),
  });
  if (result === null) throw new Error("no sweep");
  const fits =
    ask.count === null ? result.fits : result.fits.slice(0, ask.count);
  return { ask, result, fits, calls: tools.calls };
}

describe("v56: a fit question past the companies already shown", () => {
  it("the reading's excludeShown asks for their candidates without the shown ids", () => {
    const ask = fitSweepAskOfReading(
      { text: "anything else?", count: 3, excludeShown: true },
      SHOWN,
      [],
      SHOWN,
    );
    expect(ask).toEqual({
      scope: "CANDIDATES",
      place: null,
      fitAsked: true,
      count: 3,
      exclude: SHOWN,
    });
    // Without it, "those" stays exactly the companies just shown (INC-1).
    expect(
      fitSweepAskOfReading(
        { text: "rank those", count: null, previous: true },
        SHOWN,
      ),
    ).toMatchObject({ scope: "PREVIOUS", within: SHOWN });
    // Nothing shown yet: an ordinary candidates sweep, nothing excluded.
    expect(
      fitSweepAskOfReading(
        { text: "who else fits?", count: 3, excludeShown: true },
        [],
        [],
        [],
      ).exclude,
    ).toBeUndefined();
  });

  it("drops the shown ids and returns the next three in the platform's order", async () => {
    const { fits, result, calls } = await sweepOf({
      excludeShown: true,
      count: 3,
      pool: 10,
    });
    expect(fits.map((fit) => fit.companyId)).toEqual([ID(4), ID(5), ID(6)]);
    expect(fits.some((fit) => SHOWN.includes(fit.companyId))).toBe(false);
    expect(result.excluded).toBe(3);
    // The window widened by the three left out, so three still fill it.
    expect(calls).toEqual([{ name: "fit_top_candidates", args: { limit: 6 } }]);
    const block = fitSweepCardsBlock(fits, "Fit against your mandate");
    if (block === null) throw new Error("no block");
    const said = fitSweepSummary({
      block,
      scope: "CANDIDATES",
      place: null,
      considered: result.considered,
      asked: "give me three new companies that fit my mandate",
      beyondShown: { count: 3 },
    });
    expect(said).toMatch(/^Leaving out the ones I've already shown/u);
    expect(said).not.toMatch(/Ledgerfold|Basketari|Brancheon/u);
  });

  it("without excludeShown the ranking is unchanged (the shown ones come first again)", async () => {
    const { fits, result } = await sweepOf({
      excludeShown: false,
      count: 3,
      pool: 10,
    });
    expect(fits.map((fit) => fit.companyId)).toEqual(SHOWN);
    expect(result.excluded).toBe(0);
  });

  it("says so honestly when fewer than asked remain", async () => {
    const { fits, result } = await sweepOf({
      excludeShown: true,
      count: 3,
      pool: 4,
    });
    expect(fits.map((fit) => fit.companyId)).toEqual([ID(4)]);
    const block = fitSweepCardsBlock(fits, "Fit against your mandate");
    if (block === null) throw new Error("no block");
    expect(
      fitSweepSummary({
        block,
        scope: "CANDIDATES",
        place: null,
        considered: result.considered,
        asked: "three new ones",
        beyondShown: { count: 3 },
      }),
    ).toMatch(
      /^Beyond the ones I've already shown, I have only one more company to put against your mandate, not three\./u,
    );
  });

  it("nothing left beyond those shown is an empty ranking, never the same cards", async () => {
    const { fits } = await sweepOf({ excludeShown: true, count: 3, pool: 3 });
    expect(fits).toEqual([]);
  });

  it("an exclusion never widens authorization: it only removes, and asks the tools for nothing new", async () => {
    const stranger = ID(99);
    const own = ID(7);
    const { fits, calls } = await sweepOf({
      excludeShown: true,
      count: 3,
      pool: 10,
      // A shown id the person could not read, and their own relationship
      // that was shown: neither is asked for, neither comes back.
      shown: [...SHOWN, stranger, own],
      own: {
        relationships: [
          { counterpart: { kind: "COMPANY", id: own, name: "Tensorgate" } },
        ],
        saved: [],
      },
      readable: new Set([own]),
    });
    // Only the ordinary authorised fit tools ran; no fit_profile for any
    // excluded id, and nothing outside what the tools returned.
    expect(calls.every((call) => FIT_TOOLS.has(call.name))).toBe(true);
    expect(calls.filter((call) => call.name === "fit_profile")).toEqual([]);
    const ids = fits.map((fit) => fit.companyId);
    expect(ids).not.toContain(stranger);
    expect(ids).not.toContain(own);
    expect(ids).toEqual([ID(4), ID(5), ID(6)]);
    // The tool's own cap holds however many were shown.
    const limit = Number(
      calls.find((call) => call.name === "fit_top_candidates")?.args["limit"],
    );
    expect(limit).toBeLessThanOrEqual(10);
  });

  it("a PREVIOUS or named set ignores an exclusion (exactly its own ids)", async () => {
    const tools = fitTools(10, new Set(SHOWN));
    const result = await runFitSweep({
      ask: {
        scope: "PREVIOUS",
        place: null,
        fitAsked: true,
        count: 3,
        within: SHOWN,
        exclude: SHOWN,
      },
      tools: tools.port,
      context: {} as Parameters<typeof runFitSweep>[0]["context"],
      available: FIT_TOOLS,
      own: Promise.resolve(null),
    });
    expect(result?.fits.map((fit) => fit.companyId).sort()).toEqual(SHOWN);
  });
});

describe("shownCardCompanyIds", () => {
  const q = (ids: readonly string[]): QConversationMessage =>
    ({
      role: "Q",
      content: "",
      blocks: [
        {
          kind: "ANSWER_CARDS",
          title: "t",
          shape: "RANKED",
          followUps: [],
          cards: ids.map((companyId) => ({
            name: companyId,
            subject: { kind: "COMPANY", companyId },
          })),
        },
      ],
    }) as never;
  const user = { role: "USER", content: "more" } as never;

  it("collects every company card shown in the conversation, not only the last", () => {
    const earlier = [q(SHOWN), user, q([ID(4), ID(5), ID(6)]), user];
    // The last answer alone would bring the first three back next time.
    expect(previousCardCompanyIds(earlier)).toEqual([ID(4), ID(5), ID(6)]);
    expect(shownCardCompanyIds(earlier)).toEqual([
      ID(4),
      ID(5),
      ID(6),
      ...SHOWN,
    ]);
    expect(shownCardCompanyIds([])).toEqual([]);
  });
});
