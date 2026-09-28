import { describe, expect, it } from "vitest";

import {
  QClientActionToolResultSchema,
  QDocumentToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  createClientActionTools,
  createDeclinePendingProposalTool,
  createOwnWorkTools,
  createQToolExecutor,
  createQToolRegistry,
  decisionEventId,
  type ConversationProposal,
  type DiscoveryDecisionPort,
  type DocumentRevisionPort,
  type PendingProposalPort,
  type ProposalPlainStatus,
} from "../src/index.js";
import {
  COMPANY_A,
  actorA,
  actorB,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * R33: Q does what the app's own controls do — Q motion, voice, sign out,
 * the approvals inbox, their documents, Save / Unsave / Pass, declining a
 * waiting change — each through the same service, as the actor, and only
 * in the person's own conversation.
 */

function ownPlan(
  actor = actorA,
  userId = actor.userId,
  purpose:
    "GENERAL_QUESTION" | "COUNTERPARTY_COMPANY_QUESTION" = "GENERAL_QUESTION",
): PermittedContextPlan {
  // The actor-wide scopes a real plan carries (R35: an action's company
  // is admitted under the network scope when no company is on screen).
  const plan = planFor(actor, purpose, [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId } }
        : scope,
    ),
  };
}

const call = (name: string, args: Record<string, unknown>) => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

describe("settings and session client actions", () => {
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createClientActionTools(fakePorts())),
  });
  const intent = async (name: string, args: Record<string, unknown>) => {
    const outcome = await executor.execute(
      call(name, args),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result.ok, name).toBe(true);
    return QClientActionToolResultSchema.parse(
      (outcome.result as { data: unknown }).data,
    ).clientAction;
  };

  it("carries Q motion, voice and sign out to the screen", async () => {
    expect(await intent("set_q_motion", { motion: "off" })).toEqual({
      kind: "SET_Q_MOTION",
      motion: "off",
    });
    expect(await intent("set_voice", { voice: "MALE" })).toEqual({
      kind: "SET_VOICE",
      voice: "MALE",
    });
    expect(await intent("sign_out", {})).toEqual({ kind: "SIGN_OUT" });
  });

  it("refuses a value the control does not have, and another person's conversation", async () => {
    const bad = await executor.execute(
      call("set_q_motion", { motion: "wild" }),
      contextFor(actorA, ownPlan()),
    );
    expect(bad.status).not.toBe("SUCCEEDED");
    const theirs = await executor.execute(
      call("sign_out", {}),
      contextFor(actorA, ownPlan(actorA, actorB.userId)),
    );
    expect(theirs.status).not.toBe("SUCCEEDED");
  });
});

describe("Save, Unsave and Pass from a conversation", () => {
  function world(refuse = false) {
    const seen: Parameters<DiscoveryDecisionPort["decide"]>[] = [];
    const port: DiscoveryDecisionPort = {
      decide: (actor, decision) => {
        seen.push([actor, decision]);
        return Promise.resolve(
          refuse
            ? { status: "NOT_AVAILABLE" }
            : {
                status: "RECORDED",
                deduplicated: false,
                saved: decision.type === "SAVE",
                passed: decision.type === "PASS",
              },
        );
      },
    };
    const executor = createQToolExecutor({
      registry: createQToolRegistry(
        createOwnWorkTools({ discoveryDecisions: port }),
      ),
    });
    return { executor, seen };
  }

  it("records the decision as the actor, with an idempotency key code derives from the run", async () => {
    const { executor, seen } = world();
    const outcome = await executor.execute(
      call("save_company", { companyId: COMPANY_A }),
      contextFor(
        actorA,
        ownPlan(actorA, actorA.userId, "COUNTERPARTY_COMPANY_QUESTION"),
      ),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect((outcome.result as { data: unknown }).data).toEqual({
      status: "DONE",
      saved: true,
      passed: false,
    });
    const [actor, decision] = seen[0] ?? [];
    expect(actor?.userId).toBe(actorA.userId);
    expect(decision?.clientEventId).toMatch(/^q-[0-9a-f]{40}$/);
    // Same run, same decision: the same key, so a retry records nothing twice.
    expect(decision?.clientEventId).toBe(
      decisionEventId(
        contextFor(
          actorA,
          ownPlan(actorA, actorA.userId, "COUNTERPARTY_COMPANY_QUESTION"),
        ).runId,
        "SAVE",
        COMPANY_A,
      ),
    );
    expect(decisionEventId("run-1", "PASS", COMPANY_A)).not.toBe(
      decisionEventId("run-1", "SAVE", COMPANY_A),
    );
  });

  it("says NOT_AVAILABLE when the service refuses, and never takes a name for an id", async () => {
    const { executor } = world(true);
    const refused = await executor.execute(
      call("pass_company", { companyId: COMPANY_A }),
      contextFor(
        actorA,
        ownPlan(actorA, actorA.userId, "COUNTERPARTY_COMPANY_QUESTION"),
      ),
    );
    expect((refused.result as { data: unknown }).data).toEqual({
      status: "NOT_AVAILABLE",
      saved: null,
      passed: null,
    });
    const named = await executor.execute(
      call("unsave_company", { companyId: "Alpha Robotics" }),
      contextFor(
        actorA,
        ownPlan(actorA, actorA.userId, "COUNTERPARTY_COMPANY_QUESTION"),
      ),
    );
    expect(named.status).not.toBe("SUCCEEDED");
  });
});

describe("the approvals inbox and their documents", () => {
  const executor = createQToolExecutor({
    registry: createQToolRegistry(
      createOwnWorkTools({
        approvalInbox: {
          pending: (actor) =>
            Promise.resolve(
              actor.userId === actorA.userId
                ? [
                    {
                      approvalId: "a1",
                      summary: "Change your headline",
                      requestedAt: "2026-09-27T10:00:00.000Z",
                      expiresAt: "2026-09-28T10:00:00.000Z",
                    },
                  ]
                : [],
            ),
        },
        documents: {
          list: (_actor, limit) =>
            Promise.resolve(
              [
                {
                  artifactId: "d1",
                  type: "PITCH_DECK",
                  status: "READY",
                  title: "Alpha deck",
                  currentVersion: 2,
                  updatedAt: "2026-09-27T10:00:00.000Z",
                },
              ].slice(0, limit),
            ),
        },
      }),
    ),
  });

  it("lists what waits for them and what Q made for them", async () => {
    const approvals = await executor.execute(
      call("list_pending_approvals", {}),
      contextFor(actorA, ownPlan()),
    );
    expect(
      (approvals.result as { data: { items: unknown[] } }).data.items,
    ).toHaveLength(1);
    const documents = await executor.execute(
      call("list_my_documents", { limit: 5 }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      (documents.result as { data: { items: { title: string }[] } }).data
        .items[0]?.title,
    ).toBe("Alpha deck");
  });
});

describe("declining a waiting change", () => {
  function world(stored: (ConversationProposal & { owner: string })[]) {
    const declined: string[] = [];
    const port: PendingProposalPort = {
      inConversation: (context) =>
        Promise.resolve(
          stored.filter((entry) => entry.owner === context.actor.userId),
        ),
      approve: () => Promise.reject(new Error("not this tool")),
      decline: (_context, proposalId) => {
        declined.push(proposalId);
        const entry = stored.find((e) => e.proposalId === proposalId);
        if (entry !== undefined) {
          (entry as { status: ProposalPlainStatus }).status = "DECLINED";
        }
        return Promise.resolve({ status: "DECLINED" });
      },
    };
    const decline = port.decline;
    if (decline === undefined) throw new Error("composed above");
    const executor = createQToolExecutor({
      registry: createQToolRegistry([
        createDeclinePendingProposalTool(port, decline),
      ]),
    });
    return { executor, declined };
  }

  it("declines the named waiting change through the port, once", async () => {
    const { executor, declined } = world([
      {
        owner: actorA.userId,
        proposalId: "p1",
        summary: "x",
        status: "PENDING",
      },
      {
        owner: actorA.userId,
        proposalId: "p2",
        summary: "y",
        status: "PENDING",
      },
    ]);
    const first = await executor.execute(
      call("decline_pending_proposal", { proposalId: "p2" }),
      contextFor(actorA, ownPlan()),
    );
    expect((first.result as { data: { outcome: string } }).data.outcome).toBe(
      "DECLINED",
    );
    const again = await executor.execute(
      call("decline_pending_proposal", { proposalId: "p2" }),
      contextFor(actorA, ownPlan()),
    );
    expect((again.result as { data: { outcome: string } }).data.outcome).toBe(
      "ALREADY_DECIDED",
    );
    expect(declined).toEqual(["p2"]);
  });

  it("never declines another person's change", async () => {
    const { executor, declined } = world([
      {
        owner: actorB.userId,
        proposalId: "p9",
        summary: "z",
        status: "PENDING",
      },
    ]);
    const outcome = await executor.execute(
      call("decline_pending_proposal", { proposalId: "p9" }),
      contextFor(actorA, ownPlan()),
    );
    expect((outcome.result as { data: { outcome: string } }).data.outcome).toBe(
      "NOT_PENDING_HERE",
    );
    expect(declined).toEqual([]);
  });
});

describe("revising one of their documents (founder directive 2026-09-28)", () => {
  const ARTIFACT = "00000000-0000-4000-8000-00000000a111";
  function world(outcome: Awaited<ReturnType<DocumentRevisionPort["revise"]>>) {
    const calls: { artifactId: string; instruction: string; runId: string }[] =
      [];
    const port: DocumentRevisionPort = {
      revise: (input) => {
        calls.push({
          artifactId: input.artifactId,
          instruction: input.instruction,
          runId: input.runId,
        });
        return Promise.resolve(outcome);
      },
    };
    const executor = createQToolExecutor({
      registry: createQToolRegistry(
        createOwnWorkTools({ documentRevision: port }),
      ),
    });
    return { executor, calls };
  }

  it("files a new version and returns the card data the answer shows", async () => {
    const { executor, calls } = world({
      status: "REVISED",
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      artifactStatus: "READY",
      title: "Alpha deck",
      currentVersion: 3,
    });
    const outcome = await executor.execute(
      call("revise_my_document", {
        artifactId: ARTIFACT,
        changes: "Shorten the executive summary",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result.ok).toBe(true);
    const read = QDocumentToolResultSchema.parse(
      (outcome.result as { data: unknown }).data,
    );
    expect(read.document).toEqual({
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      status: "READY",
      title: "Alpha deck",
      currentVersion: 3,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        artifactId: ARTIFACT,
        instruction: "Shorten the executive summary",
      }),
    ]);
  });

  it("says NOT_FOUND for a document that is not theirs, and makes no card", async () => {
    const { executor } = world({ status: "NOT_FOUND" });
    const outcome = await executor.execute(
      call("revise_my_document", {
        artifactId: ARTIFACT,
        changes: "Add our Lagos expansion",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result.ok).toBe(true);
    const data = (outcome.result as { data: unknown }).data;
    expect(data).toEqual({ status: "NOT_FOUND" });
    expect(QDocumentToolResultSchema.safeParse(data).success).toBe(false);
  });

  it("is refused outside the person's own conversation", async () => {
    const { executor, calls } = world({ status: "FAILED" });
    const outcome = await executor.execute(
      call("revise_my_document", {
        artifactId: ARTIFACT,
        changes: "Make it shorter",
      }),
      contextFor(actorB, ownPlan(actorA)),
    );
    expect(outcome.result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
