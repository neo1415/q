import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { QApprovalViewSchema, type QApprovalView } from "@capital-q/contracts";
import {
  QActionPayloadMismatchError,
  QApprovalNotPermittedError,
} from "@capital-q/q-actions";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createConversationApprovalPort,
  plainProposalStatus,
  type ConversationApprovalDependencies,
} from "../src/composition/conversation-approvals.js";

/**
 * The port behind approval by conversation (live test 2026-09-27 #1, #2).
 * The Approval Engine and the runtime are fakes that keep the engine's
 * observable rules: an approval is readable and decidable only by the
 * person it was requested from, a repeated approve by that person is the
 * same decision (decided: false), and a changed payload is refused.
 */

const TENANT = randomUUID();
const actor = (userId: string): ActorContext =>
  ActorContextSchema.parse({
    userId,
    tenantId: TENANT,
    organisationId: randomUUID(),
    membershipId: randomUUID(),
    actorType: "HUMAN",
  });

const OWNER = actor(randomUUID());
const STRANGER = actor(randomUUID());
const CONVERSATION = randomUUID();
const RUN_NOW = randomUUID();
const RUN_EARLIER = randomUUID();
const CORRELATION = `cor_${randomUUID()}`;

type Row = {
  proposalId: string;
  approvalId: string;
  owner: string;
  summary: string;
  approval: QApprovalView["status"];
  action: QApprovalView["action"]["actionStatus"];
  canDecide: boolean;
  tampered?: boolean;
};

function viewOf(row: Row): QApprovalView {
  return QApprovalViewSchema.parse({
    contractVersion: 1,
    approvalId: row.approvalId,
    runId: RUN_EARLIER,
    status: row.approval,
    requestedAt: "2026-09-27T10:00:00.000Z",
    expiresAt: "2026-09-28T10:00:00.000Z",
    canDecide: row.canDecide,
    action: {
      actionId: row.proposalId,
      actionType: "person.profile.update",
      actionVersion: 1,
      actionClass: "CONFIRM_REQUIRED",
      actionStatus: row.action,
      targets: [{ kind: "COMPANY", companyId: randomUUID() }],
      summary: row.summary,
    },
  });
}

function harness(rows: Row[]) {
  const approvals: string[] = [];
  const declines: string[] = [];
  const resumed: string[] = [];
  const byApproval = (id: string) => rows.find((row) => row.approvalId === id);
  const dependencies: ConversationApprovalDependencies = {
    runtime: {
      getRun: (query) =>
        Promise.resolve({
          run: { conversationId: CONVERSATION, id: query.runId },
        } as never),
      getConversation: () =>
        Promise.resolve({
          messages: rows.map((row) => ({
            role: "ASSISTANT",
            blocks: [
              {
                kind: "ACTION_PROPOSAL",
                proposal: { proposalId: row.proposalId, summary: row.summary },
              },
            ],
          })),
        } as never),
    },
    late: () => ({
      actions: {
        findApprovalForAction: (_tenant, actionId) => {
          const row = rows.find(
            (candidate) => candidate.proposalId === actionId,
          );
          return Promise.resolve(
            row === undefined ? null : ({ id: row.approvalId } as never),
          );
        },
        getApproval: (query) => {
          const row = byApproval(query.approvalId);
          if (row === undefined || row.owner !== query.actor.userId) {
            return Promise.reject(new QApprovalNotPermittedError());
          }
          return Promise.resolve(viewOf(row));
        },
        approve: (command) => {
          const row = byApproval(command.approvalId);
          if (row === undefined || row.owner !== command.actor.userId) {
            return Promise.reject(new QApprovalNotPermittedError());
          }
          if (row.tampered === true) {
            return Promise.reject(new QActionPayloadMismatchError());
          }
          const decided = row.approval === "PENDING";
          if (decided) {
            approvals.push(row.proposalId);
            row.approval = "APPROVED";
            row.action = "APPROVED";
            row.canDecide = false;
          }
          return Promise.resolve({
            decided,
            action: { runId: RUN_EARLIER },
          } as never);
        },
        reject: (command) => {
          const row = byApproval(command.approvalId);
          if (row === undefined || row.owner !== command.actor.userId) {
            return Promise.reject(new QApprovalNotPermittedError());
          }
          const decided = row.approval === "PENDING";
          if (decided) {
            declines.push(row.proposalId);
            row.approval = "REJECTED";
            row.action = "REJECTED";
            row.canDecide = false;
          }
          return Promise.resolve({ decided } as never);
        },
      },
      orchestrator: {
        start: () => Promise.reject(new Error("unused")),
        cancel: () => Promise.reject(new Error("unused")),
        resume: (input) => {
          resumed.push(input.runId);
          // The execution gate runs the approved action.
          for (const row of rows) {
            if (row.approval === "APPROVED") row.action = "EXECUTED";
          }
          return Promise.resolve({} as never);
        },
      },
    }),
  };
  return {
    port: createConversationApprovalPort(dependencies),
    approvals,
    declines,
    resumed,
  };
}

const at = (who: ActorContext) => ({
  actor: who,
  runId: RUN_NOW,
  correlationId: CORRELATION,
});

const pending = (overrides: Partial<Row> = {}): Row => ({
  proposalId: randomUUID(),
  approvalId: randomUUID(),
  owner: OWNER.userId,
  summary: "Update your profile. Headline: Angel investor.",
  approval: "PENDING",
  action: "AWAITING_APPROVAL",
  canDecide: true,
  ...overrides,
});

describe("plainProposalStatus", () => {
  it("says saved only when the action executed", () => {
    const row = pending();
    expect(plainProposalStatus(viewOf(row))).toBe("PENDING");
    expect(
      plainProposalStatus(
        viewOf({ ...row, approval: "APPROVED", action: "APPROVED" }),
      ),
    ).toBe("SAVING");
    expect(
      plainProposalStatus(
        viewOf({ ...row, approval: "APPROVED", action: "EXECUTED" }),
      ),
    ).toBe("SAVED");
    expect(
      plainProposalStatus(
        viewOf({ ...row, approval: "APPROVED", action: "FAILED" }),
      ),
    ).toBe("NOT_SAVED");
    expect(
      plainProposalStatus(
        viewOf({ ...row, approval: "REJECTED", action: "REJECTED" }),
      ),
    ).toBe("DECLINED");
    expect(plainProposalStatus(viewOf({ ...row, canDecide: false }))).toBe(
      "EXPIRED",
    );
    expect(
      plainProposalStatus(
        viewOf({ ...row, approval: "REVOKED", action: "WITHDRAWN" }),
      ),
    ).toBe("EXPIRED");
  });
});

describe("createConversationApprovalPort", () => {
  it("lists only the proposals addressed to the person reading", async () => {
    const mine = pending();
    const theirs = pending({ owner: STRANGER.userId });
    const { port } = harness([mine, theirs]);
    expect(
      (await port.inConversation(at(OWNER))).map((p) => p.proposalId),
    ).toEqual([mine.proposalId]);
    expect(
      (await port.inConversation(at(STRANGER))).map((p) => p.proposalId),
    ).toEqual([theirs.proposalId]);
  });

  it("approves through the engine once, resumes the paused run once, and reports saved", async () => {
    const row = pending();
    const { port, approvals, resumed } = harness([row]);
    expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
      status: "SAVED",
    });
    expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
      status: "SAVED",
    });
    expect(approvals).toEqual([row.proposalId]);
    expect(resumed).toEqual([RUN_EARLIER]);
  });

  it("reports CHANGED and approves nothing when the payload no longer matches", async () => {
    const row = pending({ tampered: true });
    const { port, approvals, resumed } = harness([row]);
    expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
      status: "CHANGED",
    });
    expect(approvals).toEqual([]);
    expect(resumed).toEqual([]);
  });

  it("refuses another person's proposal", async () => {
    const row = pending();
    const { port, approvals } = harness([row]);
    await expect(port.approve(at(STRANGER), row.proposalId)).rejects.toThrow();
    expect(approvals).toEqual([]);
  });
});

describe("declining by conversation (R33)", () => {
  it("rejects through the engine as the person, once, and nothing executes", async () => {
    const row = pending();
    const { port, declines, resumed } = harness([row]);
    const decline = port.decline;
    expect(decline).toBeDefined();
    if (decline === undefined) return;
    expect(await decline(at(OWNER), row.proposalId)).toEqual({
      status: "DECLINED",
    });
    expect(await decline(at(OWNER), row.proposalId)).toEqual({
      status: "DECLINED",
    });
    expect(declines).toEqual([row.proposalId]);
    expect(resumed).toEqual([]);
  });

  it("never declines another person's change", async () => {
    const row = pending({ owner: randomUUID() });
    const { port, declines } = harness([row]);
    await expect(port.decline?.(at(OWNER), row.proposalId)).rejects.toThrow();
    expect(declines).toEqual([]);
  });
});
