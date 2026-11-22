import { describe, expect, it } from "vitest";

import type { QAnswerCardsBlock, QResultBlock } from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import type { PublicSourceLike } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationMessage,
} from "@capital-q/q-runtime";

import { fitSweepBranch } from "../src/q/answer-code-branches.js";
import { persistAnswerWith } from "../src/q/answer-persist.js";
import type { RunFit } from "../src/q/fit-cards.js";
import { fitSweepAsk, type FitSweepResult } from "../src/q/fit-sweep.js";
import { fitFixture } from "./fit-fixture.js";

/**
 * W5-C: the two W5-B pieces that only the seam's suites pinned, now on
 * their own. Persisting an answer: what is stored and announced, in what
 * order, and the answer's lets read when it runs. The fit sweep branch:
 * the cards, the summary, the exclusion it says, and the let it sets
 * before persisting.
 */

const REQUEST = {
  runId: "e0000000-0000-4000-8000-000000000001",
  tenantId: "t1",
  actorUserId: "u1",
  actor: { userId: "u1", tenantId: "t1" },
  plan: { scopes: [] },
} as never as QAnswerRequest;
const said = (content: string): QConversationMessage =>
  ({ id: "m-user", role: "USER", content }) as never;

function persistWorld() {
  const order: string[] = [];
  const stored: Record<string, unknown>[] = [];
  const events: unknown[] = [];
  const repositories = {
    messages: {
      insert: (_tx: unknown, row: Record<string, unknown>) => {
        order.push("insert");
        stored.push(row);
        return Promise.resolve({
          ...row,
          createdAt: "2026-11-22T10:00:00.000Z",
          unconfirmed: false,
        });
      },
    },
    runEvents: {
      appendNext: (_tx: unknown, event: unknown) => {
        order.push("event");
        events.push(event);
        return Promise.resolve({ sequence: 1 });
      },
    },
    runs: {},
  };
  return { order, stored, events, repositories };
}

const SOURCE: PublicSourceLike = {
  index: 1,
  url: "https://techcabal.com/a",
  domain: "techcabal.com",
  title: "Ajopot raises",
  publishedAt: null,
  retrievedAt: "2026-11-22T00:00:00.000Z",
};

describe("persisting an answer, on its own", () => {
  const persist = (
    world: ReturnType<typeof persistWorld>,
    options: {
      readonly languageOf?: (text: string) => Promise<string>;
      readonly clientActionBlocks?: QResultBlock[];
    } = {},
  ) =>
    persistAnswerWith(
      {
        accountDigest: Promise.resolve(null),
        chartFor: () => null,
        clientActionBlocks: options.clientActionBlocks ?? [],
        compareTable: null,
        conversationId: "c0000000-0000-4000-8000-000000000001" as never,
        dependencies: {} as never,
        earlier: [],
        gate: {
          ready: () => {
            world.order.push("gate");
            return Promise.resolve();
          },
        } as never,
        inTheirLanguage:
          options.languageOf ??
          ((text) => {
            world.order.push("language");
            return Promise.resolve(text);
          }),
        latest: said("What is Ajopot raising?"),
        logger: undefined,
        messageId: "a0000000-0000-4000-8000-000000000001" as never,
        movedBlocks: (_request, blocks) => {
          world.order.push("moved");
          return Promise.resolve(
            blocks === undefined ? undefined : [...blocks],
          );
        },
        publicSources: [SOURCE],
        repositories: world.repositories as never,
        request: REQUEST,
        screenReceipts: [],
        stages: {
          now: undefined,
          // Recorded when the answer waits on it, not when it was made.
          queue: {
            then: (resolve: () => void) => {
              world.order.push("stages");
              resolve();
            },
          } as never,
        },
        standingOf: () => null,
        transactions: {
          run: <T>(work: (tx: TransactionContext) => Promise<T>) =>
            work({ sql: {} } as never),
        },
        live: {
          answerVerdict: null,
          rankedPastShown: false,
          tieLineAllowed: true,
        },
      },
      "Ajopot is raising a seed round.",
    );

  it("stores the words with the sources read and the client's blocks, then announces it, last", async () => {
    const world = persistWorld();
    const navigate: QResultBlock = {
      kind: "UI_INTENT",
      intent: { kind: "NAVIGATE", destination: "WORK" },
    };
    await persist(world, { clientActionBlocks: [navigate] });
    expect(world.order).toEqual([
      "language",
      "gate",
      "stages",
      "moved",
      "insert",
      "event",
    ]);
    const [row] = world.stored;
    expect(row?.["content"]).toBe("Ajopot is raising a seed round.");
    expect(row?.["role"]).toBe("Q");
    expect(row?.["id"]).toBe("a0000000-0000-4000-8000-000000000001");
    const blocks = row?.["blocks"] as QResultBlock[];
    expect(blocks.map((block) => block.kind)).toEqual([
      "PUBLIC_SOURCE",
      "UI_INTENT",
    ]);
  });

  it("stores the words in their language", async () => {
    const world = persistWorld();
    await persist(world, {
      languageOf: (text) => Promise.resolve(`[ar] ${text}`),
    });
    expect(world.stored[0]?.["content"]).toBe(
      "[ar] Ajopot is raising a seed round.",
    );
  });
});

describe("the fit sweep branch, on its own", () => {
  const fit = (n: number, name: string): RunFit => {
    const outcome = fitFixture(
      `c000000${String(n)}-0000-4000-8000-000000000001`,
      name,
      { STAGE: "STRONG", SECTOR: "STRONG", GEOGRAPHY: "STRONG" },
      "STRONG_FIT",
    );
    const data = outcome.result.data as { name: string; profile: unknown };
    return {
      companyId: `c000000${String(n)}-0000-4000-8000-000000000001`,
      name: data.name,
      line: null,
      profile: data.profile as RunFit["profile"],
    };
  };

  const branch = (options: { readonly reRanked: boolean }) => {
    const ask = fitSweepAsk("Which two companies best fit my mandate?");
    if (ask === null) throw new Error("no ask");
    const sweep: FitSweepResult = {
      ask,
      fits: [fit(1, "Ajopot"), fit(2, "Kora")],
      considered: 9,
      excluded: 0,
      excludedRelationships: [],
      calls: [],
    };
    const order: string[] = [];
    let rankedPastShown = false;
    const persisted: { text: string; blocks: unknown }[] = [];
    const done = fitSweepBranch({
      accountDigest: Promise.resolve(null),
      beyondShown: undefined,
      latest: said("Which two companies best fit my mandate?"),
      logger: undefined,
      networkRankFailedOf: () => null,
      persistCodeAnswer: (text, blocks) => {
        order.push(`persist:${String(rankedPastShown)}`);
        persisted.push({ text, blocks });
        return Promise.resolve({ id: "m7" } as never);
      },
      reRanked: options.reRanked ? sweep : null,
      request: REQUEST,
      startedAt: 0,
      sweep,
      withReaderSourceCounts: (block) => Promise.resolve(block),
      live: {
        get rankedPastShown() {
          return rankedPastShown;
        },
        set rankedPastShown(value: boolean) {
          order.push(`ranked:${String(value)}`);
          rankedPastShown = value;
        },
        get rendered() {
          return { bundle: { bundleVersion: "b3" } } as never;
        },
      },
    });
    return { done, order, persisted };
  };

  it("answers with the cards, in rank order, and sets the let before persisting", async () => {
    const { done, order, persisted } = branch({ reRanked: false });
    expect(await done).toEqual({
      kind: "ANSWERED",
      messageId: "m7",
      modelPolicyVersion: "none",
      promptBundleVersion: "b3",
    });
    expect(order).toEqual(["ranked:false", "persist:false"]);
    const [cards] = persisted[0]?.blocks as QAnswerCardsBlock[];
    expect(cards?.kind).toBe("ANSWER_CARDS");
    expect(cards?.cards.map((card) => card.name)).toEqual(["Ajopot", "Kora"]);
    expect(persisted[0]?.text).not.toMatch(/left out/u);
  });

  it("a re-ranking past what was shown says so, and marks it", async () => {
    const { done, order, persisted } = branch({ reRanked: true });
    await done;
    expect(order).toEqual(["ranked:true", "persist:true"]);
    expect(persisted[0]?.text).toMatch(
      /^None of the companies I just listed has enough on record/u,
    );
  });
});
