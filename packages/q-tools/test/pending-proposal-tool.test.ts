import { describe, expect, it } from "vitest";

import {
  createApprovePendingProposalTool,
  createQToolExecutor,
  createQToolRegistry,
  type ApprovePendingProposalOutput,
  type ConversationProposal,
  type PendingProposalPort,
  type ProposalPlainStatus,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

/**
 * `approve_pending_proposal` (live test 2026-09-27 #1). The model decides
 * the person approved and names the proposal it was shown; code approves
 * only the ONE change waiting for this person in this conversation, and
 * only through the port that makes the card's approve call. The fake below
 * holds proposals per owner and applies an approval once, as the engine's
 * idempotent approve does, so a repeat can be seen not to execute twice.
 */

type Stored = {
  readonly owner: string;
  readonly proposalId: string;
  readonly summary: string;
  readonly payload: string;
  status: ProposalPlainStatus;
  /** The payload hash no longer matches: the engine refuses the approval. */
  tampered?: boolean;
};

function world(stored: Stored[]) {
  const executed: { proposalId: string; payload: string }[] = [];
  const port: PendingProposalPort = {
    inConversation: (context) =>
      Promise.resolve(
        stored
          .filter((entry) => entry.owner === context.actor.userId)
          .map((entry): ConversationProposal => ({
            proposalId: entry.proposalId,
            summary: entry.summary,
            status: entry.status,
          })),
      ),
    approve: (context, proposalId) => {
      const entry = stored.find(
        (candidate) =>
          candidate.proposalId === proposalId &&
          candidate.owner === context.actor.userId,
      );
      if (entry === undefined) return Promise.reject(new Error("not found"));
      if (entry.tampered === true)
        return Promise.resolve({ status: "CHANGED" });
      if (entry.status === "PENDING") {
        executed.push({ proposalId, payload: entry.payload });
        entry.status = "SAVED";
      }
      return Promise.resolve({ status: entry.status });
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry([createApprovePendingProposalTool(port)]),
  });
  return { executor, executed };
}

const ownConversation = (actor: typeof actorA, userId = actor.userId) => {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) => ({
      ...scope,
      filter: { ...scope.filter, userId },
    })),
  };
};

async function approve(
  executor: ReturnType<typeof world>["executor"],
  proposalId: string,
  actor = actorA,
) {
  const outcome = await executor.execute(
    {
      callId: "a1",
      name: "approve_pending_proposal",
      arguments: { proposalId },
    },
    contextFor(actor, ownConversation(actor)),
  );
  return outcome;
}

function data(outcome: Awaited<ReturnType<typeof approve>>) {
  expect(outcome.status).toBe("SUCCEEDED");
  if (!outcome.result.ok) throw new Error("expected a result");
  return outcome.result.data as ApprovePendingProposalOutput;
}

const headline = (overrides: Partial<Stored> = {}): Stored => ({
  owner: actorA.userId,
  proposalId: "p-headline",
  summary: "Update your profile. Headline: Angel investor.",
  payload: "headline=Angel investor",
  status: "PENDING",
  ...overrides,
});

describe("approve_pending_proposal", () => {
  it("approves exactly the one pending payload, once, and reports it saved", async () => {
    const { executor, executed } = world([headline()]);
    const first = data(await approve(executor, "p-headline"));
    expect(first.outcome).toBe("SAVED");
    expect(first.proposal?.status).toBe("SAVED");
    expect(executed).toEqual([
      { proposalId: "p-headline", payload: "headline=Angel investor" },
    ]);

    // Said again: nothing executes twice, and the answer is the real status.
    const again = data(await approve(executor, "p-headline"));
    expect(again.outcome).toBe("ALREADY_DECIDED");
    expect(again.proposal?.status).toBe("SAVED");
    expect(executed).toHaveLength(1);
  });

  it("approves nothing when nothing is waiting", async () => {
    const { executor, executed } = world([
      headline({ status: "DECLINED", proposalId: "p-old" }),
    ]);
    const result = data(await approve(executor, "p-anything"));
    expect(result.outcome).toBe("NONE_PENDING");
    expect(executed).toEqual([]);
  });

  it("asks which when several are waiting, approving none", async () => {
    const { executor, executed } = world([
      headline(),
      headline({
        proposalId: "p-country",
        summary: "Update your investor profile. Country: NG.",
        payload: "hqCountry=NG",
      }),
    ]);
    const result = data(await approve(executor, "p-headline"));
    expect(result.outcome).toBe("SEVERAL_PENDING");
    expect(result.pending.map((entry) => entry.proposalId)).toEqual([
      "p-headline",
      "p-country",
    ]);
    expect(executed).toEqual([]);
  });

  it("refuses an id that is not the one waiting, naming the one that is", async () => {
    const { executor, executed } = world([headline()]);
    const result = data(await approve(executor, "p-invented"));
    expect(result.outcome).toBe("NOT_THE_PENDING_ONE");
    expect(result.pending.map((entry) => entry.proposalId)).toEqual([
      "p-headline",
    ]);
    expect(executed).toEqual([]);
  });

  it("does not approve a payload that changed after it was proposed", async () => {
    const { executor, executed } = world([headline({ tampered: true })]);
    const result = data(await approve(executor, "p-headline"));
    expect(result.outcome).toBe("CHANGED");
    expect(executed).toEqual([]);
  });

  it("never approves another person's proposal, even with its id", async () => {
    const { executor, executed } = world([headline()]);
    // actorB's conversation holds nothing of actorA's.
    const result = data(await approve(executor, "p-headline", actorB));
    expect(result.outcome).toBe("NONE_PENDING");
    expect(executed).toEqual([]);
  });

  it("is refused outright outside the person's own conversation", async () => {
    const { executor, executed } = world([headline()]);
    const outcome = await executor.execute(
      {
        callId: "a1",
        name: "approve_pending_proposal",
        arguments: { proposalId: "p-headline" },
      },
      contextFor(actorA, ownConversation(actorA, actorB.userId)),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
    expect(executed).toEqual([]);
  });

  it("takes no field but the proposal id: a payload cannot ride along", async () => {
    const { executor, executed } = world([headline()]);
    const outcome = await executor.execute(
      {
        callId: "a1",
        name: "approve_pending_proposal",
        arguments: { proposalId: "p-headline", payload: "headline=Other" },
      },
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
    expect(executed).toEqual([]);
  });
});
