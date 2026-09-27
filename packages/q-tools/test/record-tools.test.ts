import { describe, expect, it } from "vitest";

import {
  QClientActionToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  createApprovePendingProposalTool,
  createDeclinePendingProposalTool,
  createOpenPageTool,
  createOwnRecordTools,
  createQToolExecutor,
  createQToolRegistry,
  createRecordChangeTools,
  type ConversationProposal,
  type OwnRecordsPort,
  type PendingProposalPort,
  type RecordChange,
  type RecordChangePort,
} from "../src/index.js";
import {
  COMPANY_A,
  COMPANY_B_NETWORK,
  actorA,
  actorB,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * R33 backlog: the record forms as Prepare → Approve, reads of the
 * person's own records, opening a record's page, and approving or
 * declining an inbox item. Whose record is always code's to resolve.
 */

function ownPlan(
  actor = actorA,
  companyIds: readonly string[] = [COMPANY_A],
): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    ...companyIds.map((companyId) => ({
      kind: "COMPANY_PROFILE" as const,
      sensitivity: "CONFIDENTIAL" as const,
      companyId,
    })),
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

const call = (name: string, args: Record<string, unknown>) => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

const dataOf = (outcome: { result: unknown }) =>
  (outcome.result as { data: Record<string, unknown> }).data;

describe("record changes are prepared for the person's own record only", () => {
  function world(answer: Awaited<ReturnType<RecordChangePort["prepare"]>>) {
    const prepared: RecordChange[] = [];
    const port: RecordChangePort = {
      prepare: (entry) => {
        prepared.push(entry.change);
        return Promise.resolve(answer);
      },
    };
    const executor = createQToolExecutor({
      registry: createQToolRegistry(createRecordChangeTools(fakePorts(), port)),
    });
    return { executor, prepared };
  }
  const PREPARED = {
    status: "PREPARED" as const,
    awaitingApprovalOf: "Update your raise",
    reason: null,
  };

  it("binds the raise change to their own company from the plan", async () => {
    const { executor, prepared } = world(PREPARED);
    const outcome = await executor.execute(
      call("propose_raise_change", {
        operation: "UPDATE",
        target: { amount: "2000000", currency: "USD" },
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(dataOf(outcome)["status"]).toBe("PREPARED");
    expect(prepared).toEqual([
      {
        kind: "CAPITAL_OBJECTIVE",
        companyId: COMPANY_A,
        operation: "UPDATE",
        fields: { target: { amount: "2000000", currency: "USD" } },
      },
    ]);
  });

  it("never prepares for a company that is not theirs", async () => {
    const { executor, prepared } = world(PREPARED);
    const outcome = await executor.execute(
      call("propose_team_change", { change: "TEAM_FACTS", teamSize: 12 }),
      contextFor(actorA, ownPlan(actorA, [COMPANY_B_NETWORK])),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(prepared).toEqual([]);
  });

  it("closing needs a reason, and a refusal is reported as the composition said", async () => {
    const { executor } = world({
      status: "REFUSED",
      awaitingApprovalOf: null,
      reason: "That doesn't fit the form.",
    });
    const missing = await executor.execute(
      call("propose_raise_change", { operation: "CLOSE" }),
      contextFor(actorA, ownPlan()),
    );
    expect(missing.status).not.toBe("SUCCEEDED");
    const refused = await executor.execute(
      call("propose_team_change", {
        change: "FOUNDER_PROFILE",
        professionalSummary: "Operator",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(refused)).toEqual({
      status: "REFUSED",
      awaitingApprovalOf: null,
      reason: "That doesn't fit the form.",
    });
  });
});

describe("reading their own records", () => {
  const seen: Parameters<OwnRecordsPort["read"]>[1][] = [];
  const records: OwnRecordsPort = {
    read: (_actor, query) => {
      seen.push(query);
      return Promise.resolve(
        query.record === "VERIFICATION_STATUS" ? { state: "UNVERIFIED" } : null,
      );
    },
    reassessReadiness: () => Promise.resolve({ state: "NOT_READY" }),
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(
      createOwnRecordTools({ ...fakePorts(), ownRecords: records }),
    ),
  });

  it("reads the screen's record for their own company, and says NONE when there is none", async () => {
    const found = await executor.execute(
      call("read_my_record", { record: "VERIFICATION_STATUS" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(found)).toEqual({
      status: "FOUND",
      data: { state: "UNVERIFIED" },
    });
    expect(seen[0]).toMatchObject({
      subjectType: "COMPANY",
      subjectId: COMPANY_A,
    });
    const none = await executor.execute(
      call("read_my_record", { record: "COMPANY_TEAM" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(none)).toEqual({ status: "NONE", data: null });
  });

  it("is refused with no own company in the plan", async () => {
    const outcome = await executor.execute(
      call("read_my_record", { record: "MARKETPLACE_READINESS" }),
      contextFor(actorB, ownPlan(actorB, [COMPANY_A])),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});

describe("opening a record's page", () => {
  const executor = createQToolExecutor({
    registry: createQToolRegistry([createOpenPageTool(fakePorts())]),
  });

  it("carries the page for a company in their tenant", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "COMPANY", id: COMPANY_A }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
    ).toEqual({ kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: COMPANY_A });
  });

  it("refuses a name in place of an id", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "COMPANY", id: "Alpha Robotics" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});

describe("approving and declining an inbox item (lead decision 2026-09-27)", () => {
  function world(
    item: {
      -readonly [K in keyof ConversationProposal]: ConversationProposal[K];
    } & {
      owner: string;
    },
  ) {
    const decided: string[] = [];
    const port: PendingProposalPort = {
      inConversation: () => Promise.resolve([]),
      approve: (_context, proposalId) => {
        decided.push(`approve:${proposalId}`);
        item.status = "SAVED";
        return Promise.resolve({ status: "SAVED" });
      },
      decline: (_context, proposalId) => {
        decided.push(`decline:${proposalId}`);
        item.status = "DECLINED";
        return Promise.resolve({ status: "DECLINED" });
      },
      inboxItem: (context, approvalId) =>
        Promise.resolve(
          approvalId === "ap-1" && context.actor.userId === item.owner
            ? { ...item }
            : null,
        ),
    };
    const decline = port.decline;
    if (decline === undefined) throw new Error("composed above");
    const executor = createQToolExecutor({
      registry: createQToolRegistry([
        createApprovePendingProposalTool(port),
        createDeclinePendingProposalTool(port, decline),
      ]),
    });
    return { executor, decided };
  }

  it("approves the listed item once, by its approval id", async () => {
    const { executor, decided } = world({
      owner: actorA.userId,
      proposalId: "p-7",
      summary: "Update your raise",
      status: "PENDING",
    });
    const first = await executor.execute(
      call("approve_pending_proposal", { approvalId: "ap-1" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(first)["outcome"]).toBe("SAVED");
    const again = await executor.execute(
      call("approve_pending_proposal", { approvalId: "ap-1" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(again)["outcome"]).toBe("ALREADY_DECIDED");
    expect(decided).toEqual(["approve:p-7"]);
  });

  it("never decides another person's approval, and needs exactly one id", async () => {
    const { executor, decided } = world({
      owner: actorB.userId,
      proposalId: "p-8",
      summary: "x",
      status: "PENDING",
    });
    const theirs = await executor.execute(
      call("decline_pending_proposal", { approvalId: "ap-1" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(theirs)["outcome"]).toBe("NOT_FOUND");
    const both = await executor.execute(
      call("approve_pending_proposal", { approvalId: "ap-1", proposalId: "p" }),
      contextFor(actorA, ownPlan()),
    );
    expect(both.status).not.toBe("SUCCEEDED");
    expect(decided).toEqual([]);
  });
});
