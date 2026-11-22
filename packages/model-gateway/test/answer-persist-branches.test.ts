import { describe, expect, it, vi } from "vitest";

import type { QAnswerCardsBlock, QResultBlock } from "@capital-q/contracts";
import type { PublicSourceLike } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationMessage,
} from "@capital-q/q-runtime";

import { webDiscoveryBranch } from "../src/q/answer-code-branches.js";
import {
  persistCodeAnswerWith,
  type PersistAnswer,
} from "../src/q/answer-persist.js";
import type { WebDiscoveryAnswer } from "../src/q/web-discovery.js";

/**
 * W5-B: characterisation of two pieces moved out of the answer, written
 * against the code as it stood and kept: persisting an answer composed by
 * code in the person's language, and the web discovery branch. The seam's
 * own tests (q-answer-research, natural-conversation-eval, the fit-answer
 * suites) pin the person search and fit sweep branches end to end.
 */

const REQUEST = {
  tenantId: "t1",
  actorUserId: "u1",
  runId: "r1",
} as Pick<QAnswerRequest, "tenantId" | "actorUserId" | "runId">;
const LATEST = { content: "Find me fintechs online." } as Pick<
  QConversationMessage,
  "content"
>;

const CARDS: QAnswerCardsBlock = {
  kind: "ANSWER_CARDS",
  shape: "RANKED",
  title: "Your top matches",
  cards: [],
  followUps: ["Compare them", "Show me more"],
} as never;

function persisting() {
  const calls: { content: string; given: unknown }[] = [];
  const persistAnswer: PersistAnswer = (content, given) => {
    calls.push({ content, given });
    return Promise.resolve({ id: "m1" } as never);
  };
  return { calls, persistAnswer };
}

describe("persisting an answer composed by code", () => {
  const run = (localise: unknown, given?: QResultBlock[]) => {
    const { calls, persistAnswer } = persisting();
    const done = persistCodeAnswerWith(
      {
        dependencies: { localiseWords: localise } as never,
        latest: LATEST as QConversationMessage,
        persistAnswer,
        request: REQUEST as QAnswerRequest,
      },
      "Here is what I found.",
      given,
    );
    return { calls, done };
  };

  it("without a translation layer, stores the English as given", async () => {
    const { calls, done } = run(undefined, [CARDS]);
    await done;
    expect(calls).toEqual([
      { content: "Here is what I found.", given: [CARDS] },
    ]);
  });

  it("translates the prose and each card set's title and follow-ups, in order", async () => {
    const asked: unknown[] = [];
    const { calls, done } = run(
      (who: unknown, texts: readonly string[]) => {
        asked.push({ who, texts });
        return Promise.resolve(["P", "T", "F1", null]);
      },
      [CARDS],
    );
    await done;
    expect(asked).toEqual([
      {
        who: {
          tenantId: "t1",
          userId: "u1",
          runId: "r1",
          turn: "Find me fintechs online.",
        },
        texts: [
          "Here is what I found.",
          "Your top matches",
          "Compare them",
          "Show me more",
        ],
      },
    ]);
    expect(calls).toEqual([
      {
        content: "P",
        given: [{ ...CARDS, title: "T", followUps: ["F1", "Show me more"] }],
      },
    ]);
  });

  it("a failed or empty translation keeps everything English", async () => {
    for (const localise of [
      () => Promise.reject(new Error("down")),
      () => Promise.resolve([null]),
    ]) {
      const { calls, done } = run(localise, [CARDS]);
      await done;
      expect(calls).toEqual([
        { content: "Here is what I found.", given: [CARDS] },
      ]);
    }
  });
});

describe("the web discovery branch", () => {
  const SOURCE: PublicSourceLike = {
    index: 1,
    url: "https://techcabal.com/a",
    domain: "techcabal.com",
    title: "Fintechs to watch",
    publishedAt: null,
    retrievedAt: "2026-11-22T00:00:00.000Z",
  };
  const FOUND = {
    text: "Three fintechs from the web.",
    sources: [SOURCE, SOURCE],
    outcome: "FOUND",
    readerFailed: false,
    companies: [],
    queries: [],
    founderQueries: [],
    toolCalls: 2,
  } as never;

  const branch = (
    found: WebDiscoveryAnswer | null,
    options: {
      readonly onCapitalQ?: boolean;
      readonly earlier?: string[];
    } = {},
  ) => {
    const order: string[] = [];
    let tieLineAllowed = true;
    const publicSources: PublicSourceLike[] = [];
    const persistCodeAnswer = vi.fn((content: string, given?: unknown) => {
      order.push(`persist:${String(tieLineAllowed)}`);
      return Promise.resolve({ id: "m9", content, given });
    });
    const discoverFor = vi.fn(() =>
      Promise.resolve({
        basis: "FIT",
        block: {
          ...CARDS,
          cards: [{ name: "Ajopot" }, { name: "Kora" }],
        },
      }),
    );
    const done = webDiscoveryBranch({
      discoverFor: discoverFor as never,
      earlier: (options.earlier ?? []).map((content) => ({
        role: "Q",
        content,
      })) as never,
      investorAsking: true,
      logger: undefined,
      offeredForRun: [],
      persistCodeAnswer: persistCodeAnswer as never,
      prepared: {
        ownCompanyId: null,
        ownMandateData: () => "mandate",
        prepareMs: {},
      },
      publicSources,
      request: {
        runId: "r1",
        webDiscovery: {
          text: "fintechs online",
          sectors: [],
          countries: [],
          stages: [],
          count: null,
          ...(options.onCapitalQ === true ? { alsoOnCapitalQ: true } : {}),
        },
      } as never,
      stageOnce: () => Promise.resolve(),
      startedAt: 0,
      webDiscoveryFor: (_ask, mandate) => {
        order.push(`web:${String(mandate)}`);
        return Promise.resolve(found);
      },
      live: {
        get rendered() {
          return { bundle: { bundleVersion: "b7" } } as never;
        },
        get tieLineAllowed() {
          return tieLineAllowed;
        },
        set tieLineAllowed(value: boolean) {
          order.push(`tie:${String(value)}`);
          tieLineAllowed = value;
        },
      },
    });
    return { done, order, publicSources, persistCodeAnswer, discoverFor };
  };

  it("nothing found: no answer here, nothing stored, the tie line untouched", async () => {
    const { done, order, persistCodeAnswer } = branch(null);
    expect(await done).toBeNull();
    expect(persistCodeAnswer).not.toHaveBeenCalled();
    expect(order).toEqual(["web:mandate"]);
  });

  it("found: its sources once each, the tie line off before storing, answered by code", async () => {
    const { done, order, publicSources, persistCodeAnswer } = branch(FOUND);
    expect(await done).toEqual({
      kind: "ANSWERED",
      messageId: "m9",
      modelPolicyVersion: "none",
      promptBundleVersion: "b7",
    });
    expect(publicSources).toEqual([SOURCE]);
    expect(order).toEqual(["web:mandate", "tie:false", "persist:false"]);
    expect(persistCodeAnswer).toHaveBeenCalledWith(
      "Three fintechs from the web.",
      [],
    );
  });

  it("asked to include Capital Q too: the top matches lead, their cards ride along", async () => {
    const { done, persistCodeAnswer, discoverFor } = branch(FOUND, {
      onCapitalQ: true,
    });
    await done;
    expect(discoverFor).toHaveBeenCalledTimes(1);
    const [content, given] = persistCodeAnswer.mock.calls[0] ?? [];
    expect(content).toBe(
      "On Capital Q, your top 2 by mandate fit: **Ajopot** and **Kora**. From the public web:\n\nThree fintechs from the web.",
    );
    expect(given).toEqual([
      { ...CARDS, cards: [{ name: "Ajopot" }, { name: "Kora" }] },
    ]);
  });

  it("a follow-up after a listing asks the web alone", async () => {
    const { done, discoverFor } = branch(FOUND, {
      onCapitalQ: true,
      earlier: ["1. **Ajopot** — a lender in Lagos."],
    });
    await done;
    expect(discoverFor).not.toHaveBeenCalled();
  });
});
