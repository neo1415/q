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
  createRecentPendingElsewhere,
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

function harness(
  rows: Row[],
  options: {
    readonly continueApproved?: () => Promise<void>;
    readonly applyWithinMs?: number;
  } = {},
) {
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
        listPendingApprovals: () => Promise.resolve([]),
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
  const late = dependencies.late;
  const continueApproved = options.continueApproved;
  return {
    port: createConversationApprovalPort({
      ...dependencies,
      ...(options.applyWithinMs === undefined
        ? {}
        : { applyWithinMs: options.applyWithinMs }),
      late:
        continueApproved === undefined
          ? late
          : () => ({ ...late(), continueApproved }),
    }),
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

  it("never says 'being applied' when the continuation ended and the action still waits (live 2026-10-01, 6b04d028)", async () => {
    for (const ending of [
      () => Promise.resolve(),
      () => Promise.reject(new Error("resume failed")),
    ]) {
      const row = pending();
      const { port } = harness([row], { continueApproved: ending });
      expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
        status: "NOT_SAVED",
      });
    }
  });

  it("says it is being applied only while the continuation may still be running", async () => {
    const row = pending();
    const { port } = harness([row], {
      continueApproved: () => new Promise<void>(() => undefined),
      applyWithinMs: 20,
    });
    expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
      status: "SAVING",
    });
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

describe("changes waiting in their other conversations (live 2026-10-01)", () => {
  const NOW = Date.parse("2026-10-01T16:00:00.000Z");
  const row = (
    approvalId: string,
    conversationId: string | null,
    minutesAgo: number,
  ) => ({
    approvalId,
    runId: RUN_EARLIER,
    conversationId,
    summary: "Q looks after Nixo for you",
    requestedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
    expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
  });
  const elsewhere = (rows: Row[], pending: ReturnType<typeof row>[]) =>
    createRecentPendingElsewhere({
      now: () => NOW,
      runtime: {
        getRun: (query) =>
          Promise.resolve({
            run: { conversationId: CONVERSATION, id: query.runId },
          } as never),
        getConversation: () => Promise.reject(new Error("unused")),
      },
      late: () => ({
        actions: {
          findApprovalForAction: () => Promise.reject(new Error("unused")),
          approve: () => Promise.reject(new Error("unused")),
          reject: () => Promise.reject(new Error("unused")),
          listPendingApprovals: (query) =>
            Promise.resolve(
              query.actor.userId === OWNER.userId ? (pending as never) : [],
            ),
          getApproval: (query) => {
            const found = rows.find(
              (candidate) => candidate.approvalId === query.approvalId,
            );
            if (found === undefined || found.owner !== query.actor.userId) {
              return Promise.reject(new QApprovalNotPermittedError());
            }
            return Promise.resolve(viewOf(found));
          },
        },
        orchestrator: undefined,
      }),
    });
  const context = (who: ActorContext) => ({
    actor: who,
    runId: RUN_NOW,
    correlationId: CORRELATION,
    tenantId: TENANT,
    userId: who.userId,
  });
  const errand = (approvalId: string, proposalId: string): Row => ({
    proposalId,
    approvalId,
    owner: OWNER.userId,
    summary: "Q looks after Nixo for you",
    approval: "PENDING",
    action: "AWAITING_APPROVAL",
    canDecide: true,
  });

  it("lists a change asked for recently in another conversation, read back as them", async () => {
    const approvalId = randomUUID();
    const proposalId = randomUUID();
    const read = elsewhere(
      [errand(approvalId, proposalId)],
      [row(approvalId, randomUUID(), 5)],
    );
    expect(await read(context(OWNER))).toEqual([
      {
        proposalId,
        summary: "Q looks after Nixo for you",
        status: "PENDING",
      },
    ]);
  });

  it("leaves out this conversation's own, older ones, and anyone else's", async () => {
    const mine = randomUUID();
    const old = randomUUID();
    const rows = [errand(mine, randomUUID()), errand(old, randomUUID())];
    const read = elsewhere(rows, [
      row(mine, CONVERSATION, 5),
      row(old, randomUUID(), 45),
    ]);
    expect(await read(context(OWNER))).toEqual([]);
    const all = elsewhere(rows, [row(mine, randomUUID(), 5)]);
    expect(await all(context(STRANGER))).toEqual([]);
  });
});
