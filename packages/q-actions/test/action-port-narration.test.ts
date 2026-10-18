import { describe, expect, it } from "vitest";

import type { QActionPrepareContext } from "@capital-q/q-runtime";

import {
  alreadyWaitingLine,
  createQActionPort,
  proposedLine,
  replacesLine,
  QActionNotPermittedError,
  refusedLine,
  type QActionNarrator,
  type QActionProposer,
  type QActionService,
} from "../src/index.js";

/**
 * Q claims an action only after the record exists (CQ-QACT-001, F7).
 *
 * Live: "our website changed, it's kivu-freight.example now" was answered
 * with "I've prepared that change to your profile. Approve it and it goes
 * in" while the proposer had refused the value — no proposal, no approval
 * control, nothing to approve. The claim was made from a model's intent.
 */

const RUN = "f0000000-0000-4000-8000-000000000001";
const context = {
  runId: RUN,
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorUserId: "b0000000-0000-4000-8000-000000000001",
  actor: {
    tenantId: "c0000000-0000-4000-8000-000000000001",
    userId: "b0000000-0000-4000-8000-000000000001",
    organisationId: "d0000000-0000-4000-8000-000000000001",
    actorType: "HUMAN",
  },
  correlationId: "cor_test",
  subjects: [],
  plan: {},
} as unknown as QActionPrepareContext;

function recordingNarrator() {
  const said: string[] = [];
  const narrator: QActionNarrator = {
    proposed: (_run, action) => {
      said.push(proposedLine(action.summary));
      return Promise.resolve();
    },
    refused: (_run, reason) => {
      said.push(refusedLine(reason));
      return Promise.resolve();
    },
    settled: (_context, outcome) => {
      said.push(`settled:${outcome.kind}`);
      return Promise.resolve();
    },
  };
  return { said, narrator };
}

const currentRevision: QActionService["currentRevision"] = (
  _tenantId,
  _runId,
  actionId,
) => Promise.resolve(actionId);

function service(
  propose: QActionService["propose"],
  executeApproved?: QActionService["executeApproved"],
): QActionService {
  return {
    propose,
    executeApproved:
      executeApproved ?? (() => Promise.resolve({ kind: "EXECUTED" })),
    currentRevision,
  } as unknown as QActionService;
}

const proposer = (
  proposal: Awaited<ReturnType<QActionProposer["propose"]>>,
): QActionProposer => ({ propose: () => Promise.resolve(proposal) });

describe("what Q says about an action", () => {
  it("says it prepared something only once the proposal exists, in the proposal's own words", async () => {
    const { said, narrator } = recordingNarrator();
    const events: string[] = [];
    const port = createQActionPort({
      service: service(() => {
        events.push("proposed");
        return Promise.resolve({
          action: {
            id: "11111111-1111-4111-8111-111111111111",
            summary:
              "Update your company profile. Website: https://kivu-freight.example",
          },
          approval: { id: "22222222-2222-4222-8222-222222222222" },
        } as never);
      }),
      proposer: proposer({ actionType: "company.profile.update", payload: {} }),
      narrator: {
        ...narrator,
        proposed: (run, action) => {
          events.push("claimed");
          return narrator.proposed(run, action);
        },
      },
    });
    const outcome = await port.prepare(context);
    expect(outcome.kind).toBe("AWAITING_APPROVAL");
    expect(events).toEqual(["proposed", "claimed"]);
    expect(said).toEqual([
      "Update your company profile. Website: https://kivu-freight.example. Not saved yet: tap Approve on the card, or tell me to go ahead.",
    ]);
  });

  it("the same change already waiting: its card is shown again with 'That's ready', and this run waits on nothing", async () => {
    const shown: { line: string; approvalId?: string }[] = [];
    const port = createQActionPort({
      service: service(() =>
        Promise.resolve({
          action: {
            id: "11111111-1111-4111-8111-111111111111",
            summary: "Share your raise with Savanna Seed",
          },
          approval: {
            id: "22222222-2222-4222-8222-222222222222",
            expiresAt: "2026-10-04T00:00:00.000Z",
          },
          existing: true,
        } as never),
      ),
      proposer: proposer({ actionType: "app.raise.share", payload: {} }),
      narrator: {
        proposed: (_run, action, approval, options) => {
          shown.push({
            line:
              options?.alreadyWaiting === true
                ? alreadyWaitingLine(action.summary)
                : proposedLine(action.summary),
            ...(approval === undefined ? {} : { approvalId: approval.id }),
          });
          return Promise.resolve();
        },
        refused: () => Promise.resolve(),
        settled: () => Promise.resolve(),
      },
    });
    expect(await port.prepare(context)).toEqual({ kind: "NONE" });
    expect(shown).toEqual([
      {
        line: "That's ready: Share your raise with Savanna Seed. It's waiting for your yes.",
        approvalId: "22222222-2222-4222-8222-222222222222",
      },
    ]);
  });

  it("a card that replaced an older one says so, naming both, in one line", async () => {
    const said: string[] = [];
    const port = createQActionPort({
      service: service(() =>
        Promise.resolve({
          action: {
            id: "11111111-1111-4111-8111-111111111111",
            summary:
              "Make your pitch deck downloadable by your organisation only",
          },
          approval: {
            id: "22222222-2222-4222-8222-222222222222",
            expiresAt: "2026-10-04T00:00:00.000Z",
          },
          superseded: [
            {
              summary:
                "Let investors who can find your company download your pitch deck",
            },
          ],
        } as never),
      ),
      proposer: proposer({
        actionType: "app.document.deck_audience.set",
        payload: {},
      }),
      narrator: {
        proposed: (_run, action, _approval, options) => {
          said.push(
            options?.replaces === undefined
              ? proposedLine(action.summary)
              : `${proposedLine(action.summary)} ${replacesLine(options.replaces)}`,
          );
          return Promise.resolve();
        },
        refused: () => Promise.resolve(),
        settled: () => Promise.resolve(),
      },
    });
    expect((await port.prepare(context)).kind).toBe("AWAITING_APPROVAL");
    expect(said).toEqual([
      "Make your pitch deck downloadable by your organisation only. Not saved yet: tap Approve on the card, or tell me to go ahead. This replaces the earlier card: Let investors who can find your company download your pitch deck (no longer waiting).",
    ]);
  });

  it("says honestly why nothing was prepared when the proposer refused, and claims nothing", async () => {
    const { said, narrator } = recordingNarrator();
    let proposed = 0;
    const port = createQActionPort({
      service: service(() => {
        proposed += 1;
        return Promise.reject(new Error("never reached"));
      }),
      proposer: proposer({
        refused:
          "the website needs to be a web address, such as https://example.com",
      }),
      narrator,
    });
    expect(await port.prepare(context)).toEqual({ kind: "NONE" });
    expect(proposed).toBe(0);
    expect(said).toEqual([
      "I couldn't prepare that change: the website needs to be a web address, such as https://example.com. Nothing has been changed.",
    ]);
    expect(said.join(" ")).not.toMatch(/prepared this|approve it/i);
  });

  it("says nothing was prepared when the Approval Engine refuses the proposal", async () => {
    const { said, narrator } = recordingNarrator();
    const port = createQActionPort({
      service: service(() => Promise.reject(new QActionNotPermittedError())),
      proposer: proposer({ actionType: "company.profile.update", payload: {} }),
      narrator,
    });
    expect(await port.prepare(context)).toEqual({ kind: "NONE" });
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^I couldn't prepare that change/);
  });

  it("says nothing at all when nothing was asked", async () => {
    const { said, narrator } = recordingNarrator();
    const port = createQActionPort({
      service: service(() => Promise.reject(new Error("never reached"))),
      proposer: proposer(null),
      narrator,
    });
    expect(await port.prepare(context)).toEqual({ kind: "NONE" });
    expect(said).toEqual([]);
  });

  it("reports the execution only after the gate returned its persisted outcome", async () => {
    const { said, narrator } = recordingNarrator();
    const port = createQActionPort({
      service: service(
        () => Promise.reject(new Error("unused")),
        () => Promise.resolve({ kind: "FAILED", failureCode: "X" }),
      ),
      narrator,
    });
    const outcome = await port.executeApproved({} as never);
    expect(outcome).toEqual({ kind: "FAILED", failureCode: "X" });
    expect(said).toEqual(["settled:FAILED"]);
  });
});

/**
 * Lead 2026-10-03 (runs a05becfe, a5121124): a "Still waiting for your
 * approval: X" reminder is decided after the engine's result -- dropped
 * when this run's card replaced X or was X, kept for any other card.
 */
describe("a deferred waiting line, against the engine's result", () => {
  const OLD_DECK = "aaaaaaaa-0000-4000-8000-000000000001";
  const OLD_OUTCOME = "aaaaaaaa-0000-4000-8000-000000000002";
  const RAISE_SHARE = "aaaaaaaa-0000-4000-8000-000000000003";
  const NEW_CARD = "bbbbbbbb-0000-4000-8000-000000000001";
  const run = (
    waiting: { line: string; actionId: string },
    result: Record<string, unknown>,
  ) => {
    const said: string[] = [];
    let taken = false;
    const port = createQActionPort({
      service: service(() =>
        Promise.resolve({
          action: { id: NEW_CARD, summary: "The new card" },
          approval: {
            id: "cccccccc-0000-4000-8000-000000000001",
            expiresAt: "2026-10-04T00:00:00.000Z",
          },
          ...result,
        } as never),
      ),
      proposer: proposer({ actionType: "app.x", payload: {} }),
      narrator: {
        proposed: (_run, action) => {
          said.push(`card: ${action.summary}`);
          return Promise.resolve();
        },
        refused: () => Promise.resolve(),
        settled: () => Promise.resolve(),
        note: (_run, line) => {
          said.push(line);
          return Promise.resolve();
        },
      },
      waitingLines: {
        take: () => {
          if (taken) return null;
          taken = true;
          return waiting;
        },
      },
    });
    return { port, said };
  };

  it("deck#2: the new card superseded the old deck card -- no 'Still waiting' for it", async () => {
    const { port, said } = run(
      {
        line: "Still waiting for your approval: Let investors who can find your company download your pitch deck.",
        actionId: OLD_DECK,
      },
      { superseded: [{ id: OLD_DECK, summary: "Let investors…" }] },
    );
    await port.prepare(context);
    expect(said).toEqual(["card: The new card"]);
  });

  it("outcome#2: the same, for a superseded outcome card", async () => {
    const { port, said } = run(
      {
        line: "Still waiting for your approval: Decide not to proceed for now.",
        actionId: OLD_OUTCOME,
      },
      { superseded: [{ id: OLD_OUTCOME, summary: "Decide not to proceed" }] },
    );
    await port.prepare(context);
    expect(said).toEqual(["card: The new card"]);
  });

  it("a diligence request while a raise-share card waits keeps the waiting line, after the new card", async () => {
    const { port, said } = run(
      {
        line: "Still waiting for your approval: Share your raise with Savanna Seed.",
        actionId: RAISE_SHARE,
      },
      {},
    );
    await port.prepare(context);
    expect(said).toEqual([
      "card: The new card",
      "Still waiting for your approval: Share your raise with Savanna Seed.",
    ]);
  });

  it("nothing prepared this run: the waiting line is still said", async () => {
    const said: string[] = [];
    const port = createQActionPort({
      service: service(() => Promise.reject(new Error("never reached"))),
      proposer: proposer(null),
      narrator: {
        proposed: () => Promise.resolve(),
        refused: () => Promise.resolve(),
        settled: () => Promise.resolve(),
        note: (_run, line) => {
          said.push(line);
          return Promise.resolve();
        },
      },
      waitingLines: {
        take: () => ({
          line: "Still waiting for your approval: X.",
          actionId: RAISE_SHARE,
        }),
      },
    });
    expect(await port.prepare(context)).toEqual({ kind: "NONE" });
    expect(said).toEqual(["Still waiting for your approval: X."]);
  });
});

/**
 * Lead 2026-10-03, run 0d1ffa3f (Ajopot, conversation 95567253): a raise
 * share card waited; "Share our financial model with Savanna Seed Partners
 * (fictional)." prepared a diligence card, and nothing named the raise
 * card. With a new card, any other card still waiting in the conversation
 * is named once after it, from the conversation's cards.
 */
describe("a new card beside another still waiting (run 0d1ffa3f)", () => {
  const RAISE = "dddddddd-0000-4000-8000-000000000001";
  const DILIGENCE = "eeeeeeee-0000-4000-8000-000000000001";
  const build = (
    cards: readonly { proposalId: string; summary: string; status: string }[],
    result: Record<string, unknown> = {},
  ) => {
    const said: string[] = [];
    const logged: unknown[] = [];
    const record = (fields: unknown, message: string) => {
      if (message === "q waiting reminder") logged.push(fields);
    };
    const port = createQActionPort({
      service: service(() =>
        Promise.resolve({
          action: { id: DILIGENCE, summary: "Share this document with them" },
          approval: {
            id: "ffffffff-0000-4000-8000-000000000001",
            expiresAt: "2026-10-04T00:00:00.000Z",
          },
          ...result,
        } as never),
      ),
      proposer: proposer({ actionType: "app.diligence.change", payload: {} }),
      narrator: {
        proposed: (_run, action) => {
          said.push(proposedLine(action.summary));
          return Promise.resolve();
        },
        refused: () => Promise.resolve(),
        settled: () => Promise.resolve(),
        note: (_run, line) => {
          said.push(line);
          return Promise.resolve();
        },
      },
      pendingInConversation: () => Promise.resolve(cards),
      logger: {
        info: record,
        warn: record,
        error: record,
        debug: record,
        child: () => undefined,
      } as never,
    });
    return { port, said, logged };
  };

  it("the exact sequence: the diligence card, then the raise card still waiting", async () => {
    const { port, said, logged } = build([
      {
        proposalId: RAISE,
        summary: "Share your raise with Savanna Seed Partners (fictional)",
        status: "PENDING",
      },
      // The new card is in the conversation by now, and is not named.
      {
        proposalId: DILIGENCE,
        summary: "Share this document with them",
        status: "PENDING",
      },
    ]);
    expect((await port.prepare(context)).kind).toBe("AWAITING_APPROVAL");
    expect(said).toEqual([
      "Share this document with them. Not saved yet: tap Approve on the card, or tell me to go ahead.",
      "Still waiting for your approval: Share your raise with Savanna Seed Partners (fictional).",
    ]);
    expect(logged).toEqual([
      expect.objectContaining({
        outcome: "said",
        reason: "other card waiting",
      }),
    ]);
  });

  it("a card this result superseded, or one already decided, is not named", async () => {
    const { port, said, logged } = build(
      [
        { proposalId: RAISE, summary: "Old card", status: "PENDING" },
        { proposalId: "x", summary: "Decided card", status: "SAVED" },
        {
          proposalId: DILIGENCE,
          summary: "Share this document with them",
          status: "PENDING",
        },
      ],
      { superseded: [{ id: RAISE, summary: "Old card" }] },
    );
    await port.prepare(context);
    expect(said).toHaveLength(1);
    expect(logged).toEqual([
      expect.objectContaining({
        outcome: "skipped",
        reason: "no other card waiting",
      }),
    ]);
  });

  it("a turn that prepares nothing stays quiet", async () => {
    const said: string[] = [];
    const port = createQActionPort({
      service: service(() => Promise.reject(new Error("never reached"))),
      proposer: proposer(null),
      narrator: {
        proposed: () => Promise.resolve(),
        refused: () => Promise.resolve(),
        settled: () => Promise.resolve(),
        note: (_run, line) => {
          said.push(line);
          return Promise.resolve();
        },
      },
      pendingInConversation: () =>
        Promise.resolve([
          { proposalId: RAISE, summary: "Share your raise", status: "PENDING" },
        ]),
    });
    expect(await port.prepare(context)).toEqual({ kind: "NONE" });
    expect(said).toEqual([]);
  });
});
