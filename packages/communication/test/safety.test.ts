import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  ChatBlockedError,
  ChatIdempotencyConflictError,
  ChatNotFoundError,
  ChatReportReasonError,
  createChatSafetyService,
  createChatService,
  type ChatParty,
  type ChatSafetyAuditEntry,
} from "../src/index.js";
import {
  createInMemoryChatSafetyStore,
  createInMemoryChatStore,
} from "../src/testing/index.js";

const REL = "00000000-0000-4000-8000-00000000c001";
const OTHER_REL = "00000000-0000-4000-8000-00000000c002";

function actor(
  userId: string,
  organisationId: string,
  actorType: "HUMAN" | "Q" = "HUMAN",
): ActorContext {
  return {
    userId,
    tenantId: "00000000-0000-4000-8000-0000000000a1",
    organisationId,
    membershipId: "00000000-0000-4000-8000-0000000000e1",
    actorType,
  } as ActorContext;
}

const COMPANY_ORG = "00000000-0000-4000-8000-0000000000c1";
const INVESTOR_ORG = "00000000-0000-4000-8000-0000000000b0";
const FOUNDER = actor("00000000-0000-4000-8000-0000000000f1", COMPANY_ORG);
const COFOUNDER = actor("00000000-0000-4000-8000-0000000000f2", COMPANY_ORG);
const INVESTOR = actor("00000000-0000-4000-8000-0000000000b1", INVESTOR_ORG);
const STRANGER = actor(
  "00000000-0000-4000-8000-0000000000e9",
  "00000000-0000-4000-8000-0000000000e0",
);

function world() {
  const store = createInMemoryChatStore();
  const safetyStore = createInMemoryChatSafetyStore(store);
  const parties = (a: ActorContext, relationshipId: string) => {
    if (relationshipId !== REL) return Promise.resolve(null);
    const party: ChatParty | null =
      a.organisationId === COMPANY_ORG
        ? { side: "COMPANY", connected: true }
        : a.organisationId === INVESTOR_ORG
          ? { side: "INVESTOR", connected: true }
          : null;
    return Promise.resolve(party);
  };
  let n = 0;
  const chat = createChatService({
    store,
    parties,
    documents: () => Promise.resolve({ outcome: "NOT_FOUND" }),
    newCorrelationId: () =>
      `cor_00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`,
  });
  const audits: ChatSafetyAuditEntry[] = [];
  const safety = createChatSafetyService({
    store: safetyStore,
    parties,
    audit: (_tx, entry) => {
      audits.push(entry);
      return Promise.resolve();
    },
  });
  return { chat, safety, store, safetyStore, audits };
}

const say = (a: ActorContext, body: string, key: string) => ({
  actor: a,
  relationshipId: REL,
  request: { kind: "TEXT" as const, body },
  idempotencyKey: key,
});

describe("chat block", () => {
  it("stops sending both ways while active, and says nothing about who blocked", async () => {
    const { chat, safety, audits } = world();
    await chat.send(say(INVESTOR, "Hello", "key-00000001"));
    await safety.block({
      actor: FOUNDER,
      relationshipId: REL,
      idempotencyKey: "block-0001",
    });

    const blocked = chat.send(say(INVESTOR, "Still there?", "key-00000002"));
    await expect(blocked).rejects.toBeInstanceOf(ChatBlockedError);
    await expect(blocked).rejects.toThrow(
      "You can't message this relationship right now.",
    );
    await expect(
      chat.send(say(FOUNDER, "One more thing", "key-00000003")),
    ).rejects.toBeInstanceOf(ChatBlockedError);

    const theirs = await chat.thread({ actor: INVESTOR, relationshipId: REL });
    expect(theirs.status).toBe("BLOCKED");
    expect(theirs.blockedByYourSide).toBe(false);
    // History stays readable.
    expect(theirs.messages).toHaveLength(1);
    const ours = await chat.thread({ actor: COFOUNDER, relationshipId: REL });
    expect(ours.status).toBe("BLOCKED");
    expect(ours.blockedByYourSide).toBe(true);

    expect(audits.map((a) => [a.actionType, a.resourceType])).toEqual([
      ["chat.blocked", "chat_block"],
    ]);
    expect(audits[0]?.relationshipId).toBe(REL);
    expect(audits[0]?.metadata).toEqual({ side: "COMPANY" });
  });

  it("is idempotent: a repeat or a second member's Block writes and audits once", async () => {
    const { safety, safetyStore, audits } = world();
    const first = await safety.block({
      actor: FOUNDER,
      relationshipId: REL,
      idempotencyKey: "block-0001",
    });
    const repeat = await safety.block({
      actor: FOUNDER,
      relationshipId: REL,
      idempotencyKey: "block-0001",
    });
    const colleague = await safety.block({
      actor: COFOUNDER,
      relationshipId: REL,
      idempotencyKey: "block-0002",
    });
    expect([first, repeat, colleague].map((r) => r.deduplicated)).toEqual([
      false,
      true,
      true,
    ]);
    expect(safetyStore.blockRows).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("lets the blocking side lift it; the blocked side cannot lift it", async () => {
    const { chat, safety, audits } = world();
    await safety.block({
      actor: FOUNDER,
      relationshipId: REL,
      idempotencyKey: "block-0001",
    });
    expect(
      await safety.unblock({ actor: INVESTOR, relationshipId: REL }),
    ).toEqual({ lifted: false });
    await expect(
      chat.send(say(INVESTOR, "Hi", "key-00000001")),
    ).rejects.toBeInstanceOf(ChatBlockedError);

    expect(
      await safety.unblock({ actor: COFOUNDER, relationshipId: REL }),
    ).toEqual({ lifted: true });
    const sent = await chat.send(say(INVESTOR, "Hi again", "key-00000002"));
    expect(sent.message.body).toBe("Hi again");
    expect((await chat.thread({ actor: INVESTOR, relationshipId: REL })).status).toBe(
      "OPEN",
    );
    expect(audits.map((a) => a.actionType)).toEqual([
      "chat.blocked",
      "chat.unblocked",
    ]);
  });

  it("refuses a non-party, an unknown relationship and a non-person alike", async () => {
    const { safety, audits } = world();
    for (const call of [
      safety.block({ actor: STRANGER, relationshipId: REL, idempotencyKey: "block-0001" }),
      safety.block({ actor: FOUNDER, relationshipId: OTHER_REL, idempotencyKey: "block-0002" }),
      safety.block({ actor: FOUNDER, relationshipId: "not-a-uuid", idempotencyKey: "block-0003" }),
      safety.block({
        actor: actor(FOUNDER.userId, COMPANY_ORG, "Q"),
        relationshipId: REL,
        idempotencyKey: "block-0004",
      }),
      safety.unblock({ actor: STRANGER, relationshipId: REL }),
    ]) {
      await expect(call).rejects.toBeInstanceOf(ChatNotFoundError);
    }
    expect(audits).toHaveLength(0);
  });

  it("keeps unsend possible while blocked", async () => {
    const { chat, safety } = world();
    const sent = await chat.send(say(FOUNDER, "Oops", "key-00000001"));
    await safety.block({
      actor: INVESTOR,
      relationshipId: REL,
      idempotencyKey: "block-0001",
    });
    await chat.unsend({
      actor: FOUNDER,
      relationshipId: REL,
      messageId: sent.message.messageId,
      idempotencyKey: "unsend-0001",
    });
    const thread = await chat.thread({ actor: FOUNDER, relationshipId: REL });
    expect(thread.messages[0]?.unsent).toBe(true);
  });

  it("tells Q the thread is blocked", async () => {
    const { chat, safety } = world();
    await safety.block({
      actor: INVESTOR,
      relationshipId: REL,
      idempotencyKey: "block-0001",
    });
    const read = await chat.readForQ({ actor: FOUNDER, relationshipId: REL });
    expect(read.blocked).toBe(true);
  });
});

describe("chat report", () => {
  it("opens a report on the other side's message and audits it without the note", async () => {
    const { chat, safety, safetyStore, audits } = world();
    const sent = await chat.send(say(INVESTOR, "Buy my token", "key-00000001"));
    const result = await safety.report({
      actor: FOUNDER,
      relationshipId: REL,
      request: {
        reasonCode: "SCAM",
        messageId: sent.message.messageId,
        note: "Asked for money up front",
      },
      idempotencyKey: "report-0001",
    });
    expect(result).toMatchObject({ status: "OPEN", deduplicated: false });
    expect(safetyStore.reports[0]).toMatchObject({
      side: "COMPANY",
      reasonCode: "SCAM",
      note: "Asked for money up front",
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actionType: "chat.reported",
      resourceType: "chat_report",
      resourceId: result.reportId,
      metadata: { side: "COMPANY", reasonCode: "SCAM", namesMessage: true },
    });
    expect(JSON.stringify(audits[0]?.metadata)).not.toContain("money");
  });

  it("is idempotent per key; a reused key for a different report conflicts", async () => {
    const { safety, safetyStore, audits } = world();
    const request = { reasonCode: "SPAM" };
    const first = await safety.report({
      actor: FOUNDER,
      relationshipId: REL,
      request,
      idempotencyKey: "report-0001",
    });
    const repeat = await safety.report({
      actor: FOUNDER,
      relationshipId: REL,
      request,
      idempotencyKey: "report-0001",
    });
    expect(repeat).toEqual({ ...first, deduplicated: true });
    await expect(
      safety.report({
        actor: FOUNDER,
        relationshipId: REL,
        request: { reasonCode: "OTHER" },
        idempotencyKey: "report-0001",
      }),
    ).rejects.toBeInstanceOf(ChatIdempotencyConflictError);
    expect(safetyStore.reports).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("refuses an unknown reason, your own side's message and a stranger", async () => {
    const { chat, safety, audits } = world();
    const own = await chat.send(say(FOUNDER, "Mine", "key-00000001"));
    await expect(
      safety.report({
        actor: FOUNDER,
        relationshipId: REL,
        request: { reasonCode: "NOT_A_REASON" },
        idempotencyKey: "report-0001",
      }),
    ).rejects.toBeInstanceOf(ChatReportReasonError);
    await expect(
      safety.report({
        actor: COFOUNDER,
        relationshipId: REL,
        request: { reasonCode: "SPAM", messageId: own.message.messageId },
        idempotencyKey: "report-0002",
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(
      safety.report({
        actor: STRANGER,
        relationshipId: REL,
        request: { reasonCode: "SPAM" },
        idempotencyKey: "report-0003",
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    expect(audits).toHaveLength(0);
  });
});
