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
  createDecisionRelay,
  createRecentPendingElsewhere,
  type DecisionRelay,
  keepsItsCard,
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
const SAID_MESSAGE = randomUUID();

type Row = {
  proposalId: string;
  approvalId: string;
  owner: string;
  summary: string;
  approval: QApprovalView["status"];
  action: QApprovalView["action"]["actionStatus"];
  canDecide: boolean;
  tampered?: boolean;
  /** The engine's action type (default person.profile.update). */
  actionType?: string;
  payload?: Record<string, unknown>;
};

/** What the person said in this run after the cards were shown. */
type Said = {
  readonly text: string;
  readonly runId?: string;
  readonly utteranceRef?: string;
  /** Before the card was shown, instead of after. */
  readonly beforeCard?: boolean;
  /** When it was stored (ISO); default: well after the card. */
  readonly at?: string;
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
    /** Null: nothing said since the cards. Default: "yes, go ahead". */
    readonly said?: Said | null;
    readonly relay?: DecisionRelay;
    /** When the cards' messages were stored (ISO); default 10:00:01. */
    readonly cardStoredAt?: string;
  } = {},
) {
  const said =
    options.said === undefined ? { text: "yes, go ahead" } : options.said;
  const commands: { approvalId: string; via: unknown }[] = [];
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
      getConversation: () => {
        const cards = rows.map((row) => ({
          id: randomUUID(),
          role: "Q",
          runId: RUN_EARLIER,
          content: row.summary,
          createdAt: options.cardStoredAt ?? "2026-09-27T10:00:01.000Z",
          blocks: [
            {
              kind: "ACTION_PROPOSAL",
              proposal: { proposalId: row.proposalId, summary: row.summary },
            },
          ],
        }));
        const theirs =
          said === null
            ? []
            : [
                {
                  id: SAID_MESSAGE,
                  role: "USER",
                  runId: said.runId ?? RUN_NOW,
                  content: said.text,
                  createdAt:
                    said.at ??
                    (said.beforeCard === true
                      ? "2026-09-27T09:59:00.000Z"
                      : "2026-09-27T10:05:00.000Z"),
                  ...(said.utteranceRef === undefined
                    ? {}
                    : { utteranceRef: said.utteranceRef }),
                },
              ];
        return Promise.resolve({
          messages:
            said?.beforeCard === true
              ? [...theirs, ...cards]
              : [...cards, ...theirs],
        } as never);
      },
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
        readProposal: (query) => {
          const row = byApproval(query.approvalId);
          if (row === undefined || row.owner !== query.actor.userId) {
            return Promise.reject(new QApprovalNotPermittedError());
          }
          return Promise.resolve({
            view: viewOf(row),
            actionType: row.actionType ?? "person.profile.update",
            payload: row.payload ?? {},
          } as never);
        },
        approve: (command) => {
          commands.push({ approvalId: command.approvalId, via: command.via });
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
            action: { runId: RUN_EARLIER, id: row.proposalId },
          } as never);
        },
        reject: (command) => {
          commands.push({ approvalId: command.approvalId, via: command.via });
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
      ...(options.relay === undefined ? {} : { relay: options.relay }),
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
    commands,
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
    const { port, declines, resumed, commands } = harness([row], {
      said: { text: "no, cancel that" },
    });
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
    // Recorded as their refusal, typed, with the message as evidence.
    expect(commands[0]?.via).toEqual({
      channel: "TEXT",
      evidenceRef: SAID_MESSAGE,
    });
  });

  it("never turns their yes into a no", async () => {
    const row = pending();
    const { port, declines } = harness([row], {
      said: { text: "yes, send it" },
    });
    expect(await port.decline?.(at(OWNER), row.proposalId)).toEqual({
      status: "PENDING",
    });
    expect(declines).toEqual([]);
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
          readProposal: () => Promise.reject(new Error("unused")),
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

describe("approval by the person's own words (owner 2026-10-16)", () => {
  it("records a typed approval as theirs: channel TEXT, the message as evidence", async () => {
    const row = pending();
    const { port, approvals, commands } = harness([row], {
      said: { text: "I approve" },
    });
    expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
      status: "SAVED",
    });
    expect(approvals).toEqual([row.proposalId]);
    expect(commands).toEqual([
      {
        approvalId: row.approvalId,
        via: { channel: "TEXT", evidenceRef: SAID_MESSAGE },
      },
    ]);
  });

  it("records a spoken approval with channel VOICE", async () => {
    const row = pending();
    const { port, commands } = harness([row], {
      said: { text: "yes, go ahead", utteranceRef: "utt_1" },
    });
    await port.approve(at(OWNER), row.proposalId);
    expect(commands[0]?.via).toEqual({
      channel: "VOICE",
      evidenceRef: SAID_MESSAGE,
    });
  });

  it("approves nothing when the person has said nothing since the card was shown", async () => {
    for (const said of [
      null,
      { text: "yes, go ahead", beforeCard: true },
      // Said in an earlier run: not this turn's words.
      { text: "yes, go ahead", runId: randomUUID() },
    ]) {
      const row = pending();
      const { port, approvals, commands } = harness([row], { said });
      expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
        status: "PENDING",
      });
      expect(approvals).toEqual([]);
      expect(commands).toEqual([]);
    }
  });

  it("a yes stored before the card's own message, after its approval was requested, still approves it (live 2026-10-28)", async () => {
    // The card's approval was requested at 10:00:00 (its view); the person
    // typed "yes" 1.5 s later, while the card's message was still being
    // stored (10:00:02). Their words came after the card was asked for.
    const row = pending();
    const { port, approvals, commands } = harness([row], {
      said: { text: "yes", at: "2026-09-27T10:00:01.500Z" },
      cardStoredAt: "2026-09-27T10:00:02.000Z",
    });
    expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
      status: "SAVED",
    });
    expect(approvals).toEqual([row.proposalId]);
    expect(commands).toEqual([
      {
        approvalId: row.approvalId,
        via: { channel: "TEXT", evidenceRef: SAID_MESSAGE },
      },
    ]);
  });

  it("a change asked for, or a no, never stands as approval, whoever asks (the model's tool included)", async () => {
    for (const text of [
      "sounds good, but change the date",
      "yes but make it Friday instead",
      "no, don't send it",
    ]) {
      const row = pending();
      const { port, approvals } = harness([row], { said: { text } });
      expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
        status: "PENDING",
      });
      expect(approvals).toEqual([]);
    }
  });

  it("keeps the card's Approve for money, terms and a private document share", async () => {
    for (const kind of [
      { actionType: "app.capital.commitment.confirm_amount" },
      { actionType: "app.relationship.deal.change" },
      { actionType: "app.disclosure.raise.share" },
      { actionType: "app.diligence.document.share" },
      {
        actionType: "app.diligence.change",
        payload: { operation: "SHARE", input: {} },
      },
    ]) {
      const row = pending(kind);
      const { port, approvals, commands } = harness([row], {
        said: { text: "I approve" },
      });
      expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
        status: "CARD_ONLY",
      });
      expect(approvals).toEqual([]);
      expect(commands).toEqual([]);
    }
  });

  it("approves a message, a meeting or a diligence request by words", async () => {
    for (const kind of [
      { actionType: "app.chat.message.send" },
      { actionType: "app.schedule.meeting.book" },
      { actionType: "email.send" },
      {
        actionType: "app.diligence.change",
        payload: { operation: "REQUEST", input: {} },
      },
    ]) {
      const row = pending(kind);
      const { port, approvals } = harness([row], {
        said: { text: "yes, send it" },
      });
      expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
        status: "SAVED",
      });
      expect(approvals).toEqual([row.proposalId]);
    }
  });
});

describe("keepsItsCard", () => {
  it("keeps any class but the one approvable class on its card", () => {
    expect(
      keepsItsCard({ actionType: "email.send", actionClass: "RESTRICTED" }),
    ).toBe(true);
    expect(
      keepsItsCard({
        actionType: "email.send",
        actionClass: "CONFIRM_REQUIRED",
      }),
    ).toBe(false);
  });
});

describe("one outcome line per action decided in words (live 2026-10-16)", () => {
  it("the action's own line is handed to the turn that approved, never written twice", async () => {
    const relay = createDecisionRelay();
    const row = pending();
    let narratedOnRun = 0;
    const { port } = harness([row], {
      relay,
      said: { text: "I approve" },
      // The execution's narrator: hands its line over while claimed.
      continueApproved: () => {
        const id = row.proposalId;
        if (relay.heldFor(id)) relay.hold(id, "Done. I'll remind you: X.");
        else narratedOnRun += 1;
        row.action = "EXECUTED";
        return Promise.resolve();
      },
    });
    expect(await port.approve(at(OWNER), row.proposalId)).toEqual({
      status: "SAVED",
      line: "Done. I'll remind you: X.",
    });
    expect(narratedOnRun).toBe(0);
    // Released: a later settlement is narrated on its run as before.
    expect(relay.heldFor(row.proposalId)).toBe(false);
  });
});
