import { describe, expect, it } from "vitest";

import type { QActionPrepareContext } from "@capital-q/q-runtime";

import {
  alreadyWaitingLine,
  createQActionPort,
  proposedLine,
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
