import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import {
  createQActionRegistry,
  createQActionService,
  type QActionRepositories,
} from "@capital-q/q-actions";
import { ActorContextSchema } from "@capital-q/security";

import { createChatMessageSendAction } from "../src/composition/chat-actions.js";
import { createWorkforceDelivery } from "../src/composition/workforce/delivery.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";

/**
 * D23 (live 15 Nov 2026, investor "What's waiting"): three different
 * waiting messages all listed as "Message Ajopot", and two notices both
 * "Your plan is ready", read as duplicates. Each is listed under a title
 * of its own -- the draft's first words, the plan's subject -- by the one
 * listing every surface reads (the work list, the digest, Q's list).
 */

const TENANT = randomUUID();
const USER = randomUUID();
const ORG = randomUUID();
const NOW = new Date("2026-11-15T12:00:00.000Z");

const actor = ActorContextSchema.parse({
  actorType: "HUMAN",
  tenantId: TENANT,
  userId: USER,
  organisationId: ORG,
  roles: [],
  permissions: [],
  scopes: [],
  authenticationStrength: "PASSWORD",
});

function pending(summary: string, preview: string | null, at: string) {
  return {
    approvalId: randomUUID(),
    runId: randomUUID(),
    conversationId: null,
    summary,
    preview,
    requestedAt: at,
    expiresAt: "2026-11-16T12:00:00.000Z",
    targets: [],
    actionType: "chat.message.send",
  };
}

function listing(rows: readonly ReturnType<typeof pending>[]) {
  const repositories = {
    approvals: { listPendingForApprover: () => Promise.resolve(rows) },
  } as unknown as QActionRepositories;
  return createQActionService({
    sql: {} as DatabaseExecutor,
    transactions: {
      run: (work: (context: TransactionContext) => Promise<unknown>) =>
        work({ sql: {} } as unknown as TransactionContext),
    } as unknown as TransactionManager,
    repositories,
    runtime: {} as never,
    registry: createQActionRegistry([
      createChatMessageSendAction({ chat: {} as never }),
    ]),
    authorization: {} as never,
    audit: {} as never,
    clock: { now: () => NOW },
  });
}

describe("waiting messages to one person are listed apart (D23)", () => {
  it("names each by its draft's first words, or the day it was prepared", async () => {
    const service = listing([
      pending(
        "Message Ajopot",
        "Thanks for the deck, could we talk about your unit economics next week?",
        "2026-11-15T10:00:00.000Z",
      ),
      pending(
        "Message Ajopot",
        "Following up on the data room access.\n\n(shares one of your documents)",
        "2026-11-15T09:00:00.000Z",
      ),
      pending("Message Ajopot", null, "2026-11-14T09:00:00.000Z"),
    ]);
    const rows = await service.listPendingApprovals({ actor });
    expect(rows.map((row) => row.summary)).toEqual([
      "Message Ajopot: Thanks for the deck, could we…",
      "Message Ajopot: Following up on the data room…",
      "Message Ajopot, prepared 14 Nov",
    ]);
    expect(new Set(rows.map((row) => row.summary)).size).toBe(3);
    // The preview is the title's source only; the listing never carries it.
    for (const row of rows) expect(row).not.toHaveProperty("preview");
  });

  it("leaves an action without a list title as it was summarised", async () => {
    const service = listing([
      {
        ...pending("Book a call with Ajopot", "Tuesday", NOW.toISOString()),
        actionType: "meeting.reschedule",
      },
    ]);
    const [row] = await service.listPendingApprovals({ actor });
    expect(row?.summary).toBe("Book a call with Ajopot");
  });
});

function planRow(goal: string): WorkRow {
  return {
    job_id: randomUUID(),
    tenant_id: TENANT,
    user_id: USER,
    state: "COMPLETED",
    plan: {},
    trace: { runId: randomUUID() },
    results: {
      plan: {
        status: "DONE",
        summary: "The plan is ready",
        outputs: {
          plan: {
            block: {
              kind: "PLAN",
              planId: randomUUID(),
              version: 1,
              title: goal,
              steps: 3,
              reviewed: true,
              affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
            },
            line: "Your plan is ready: 3 steps.",
          },
        },
      },
    },
    attempts: 1,
    max_attempts: 3,
    reason: null,
    created_at: new Date(),
    updated_at: new Date(),
    finished_at: new Date(),
  };
}

describe("plan-ready notices name their plan (D23)", () => {
  it("titles each notice with the plan's own subject", async () => {
    const titles: string[] = [];
    const deliver = createWorkforceDelivery({
      sql: {} as never,
      transactions: { run: (work) => work({} as never) },
      runtime: {
        runs: {
          findForActor: () => Promise.resolve(null),
          allocateEventSequence: () => Promise.resolve(2),
        },
        runEvents: { append: () => Promise.resolve({}) },
        messages: { insert: () => Promise.resolve(null) },
      } as never,
      notify: (_owner, notice) => {
        titles.push(notice.title);
        return Promise.resolve();
      },
    });
    const owner = { tenantId: TENANT, userId: USER };
    await deliver(owner, planRow("Raise a seed round"));
    await deliver(owner, planRow("Close the Lagos pilot."));
    expect(titles).toEqual([
      "Your plan is ready: Raise a seed round",
      "Your plan is ready: Close the Lagos pilot",
    ]);
  });
});
