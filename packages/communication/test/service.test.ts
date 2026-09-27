import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  ChatAttachmentUnavailableError,
  ChatIdempotencyConflictError,
  ChatNotConnectedError,
  ChatNotFoundError,
  createChatService,
  type ChatDocumentPort,
  type ChatParty,
} from "../src/index.js";
import { createInMemoryChatStore } from "../src/testing/index.js";

const REL = "00000000-0000-4000-8000-00000000c001";
const OTHER_REL = "00000000-0000-4000-8000-00000000c002";
const DOC = "00000000-0000-4000-8000-00000000d001";
const PENDING_DOC = "00000000-0000-4000-8000-00000000d002";
const VOICE = "00000000-0000-4000-8000-00000000d003";
const DOC_VERSION = "00000000-0000-4000-8000-00000000d0a1";
const DOC_TENANT = "00000000-0000-4000-8000-00000000d0b1";
const snapshot = (documentId: string, mimeType: string) => ({
  documentId,
  documentVersionId: DOC_VERSION,
  documentTenantId: DOC_TENANT,
  title: mimeType.startsWith("audio/") ? "Voice note" : "Seed deck",
  mimeType,
  sizeBytes: 1024,
});

function actor(userId: string, organisationId: string): ActorContext {
  return {
    userId,
    tenantId: "00000000-0000-4000-8000-0000000000a1",
    organisationId,
    membershipId: "00000000-0000-4000-8000-0000000000e1",
    actorType: "HUMAN",
  } as ActorContext;
}

const FOUNDER = actor(
  "00000000-0000-4000-8000-0000000000f1",
  "00000000-0000-4000-8000-0000000000c1",
);
const COFOUNDER = actor(
  "00000000-0000-4000-8000-0000000000f2",
  "00000000-0000-4000-8000-0000000000c1",
);
const INVESTOR = actor(
  "00000000-0000-4000-8000-0000000000b1",
  "00000000-0000-4000-8000-0000000000b0",
);
const STRANGER = actor(
  "00000000-0000-4000-8000-0000000000e9",
  "00000000-0000-4000-8000-0000000000e0",
);

function world(options: { connected?: boolean } = {}) {
  const store = createInMemoryChatStore();
  store.names.set(FOUNDER.userId, "Ada Founder");
  store.names.set(INVESTOR.userId, "Ben Investor");
  store.parties.set(REL, {
    company: FOUNDER.organisationId ?? "",
    investor: INVESTOR.organisationId ?? "",
  });
  const resolved: string[] = [];
  const parties = (a: ActorContext, relationshipId: string) => {
    resolved.push(relationshipId);
    if (relationshipId !== REL) return Promise.resolve(null);
    const connected = options.connected ?? true;
    const party: ChatParty | null =
      a.organisationId === FOUNDER.organisationId
        ? { side: "COMPANY", connected }
        : a.organisationId === INVESTOR.organisationId
          ? { side: "INVESTOR", connected }
          : null;
    return Promise.resolve(party);
  };
  const documents: ChatDocumentPort = (a, documentId) =>
    Promise.resolve(
      a.organisationId !== FOUNDER.organisationId
        ? { outcome: "NOT_FOUND" as const }
        : documentId === DOC
          ? {
              outcome: "READY" as const,
              snapshot: snapshot(DOC, "application/pdf"),
            }
          : documentId === VOICE
            ? {
                outcome: "READY" as const,
                snapshot: snapshot(VOICE, "audio/webm"),
              }
            : documentId === PENDING_DOC
              ? { outcome: "NOT_READY" as const }
              : { outcome: "NOT_FOUND" as const },
    );
  let n = 0;
  const downloads: { disposition: string; documentVersionId: string }[] = [];
  const service = createChatService({
    store,
    parties,
    documents,
    downloads: (share) => {
      downloads.push(share);
      return Promise.resolve({
        url: "https://storage.example.invalid/object/sign/x?token=t",
        expiresAt: "2026-09-27T09:01:00.000Z",
        mimeType: "application/pdf",
      });
    },
    newCorrelationId: () =>
      `cor_00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`,
  });
  return { service, store, resolved, downloads };
}

const text = (body: string) => ({ kind: "TEXT" as const, body });

describe("relationship chat", () => {
  it("lets both parties talk, in order, and records activity for originals only", async () => {
    const { service, store } = world();
    await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("Hi Ben"),
      idempotencyKey: "key-00000001",
    });
    const reply = await service.send({
      actor: INVESTOR,
      relationshipId: REL,
      request: text("Hi Ada"),
      idempotencyKey: "key-00000002",
    });
    expect(reply.message.side).toBe("INVESTOR");

    const thread = await service.thread({
      actor: FOUNDER,
      relationshipId: REL,
    });
    expect(thread.status).toBe("OPEN");
    expect(thread.messages.map((m) => [m.body, m.mine, m.senderName])).toEqual([
      ["Hi Ben", true, "Ada Founder"],
      ["Hi Ada", false, "Ben Investor"],
    ]);
    expect(thread.unread).toBe(1);
    expect(store.activity).toHaveLength(2);

    // A colleague on the company side reads the same thread.
    const colleague = await service.thread({
      actor: COFOUNDER,
      relationshipId: REL,
    });
    expect(colleague.messages).toHaveLength(2);
    expect(colleague.messages[0]?.mine).toBe(false);
  });

  it("gives a non-party nothing: not the thread, not a send, not Q's read", async () => {
    const { service } = world();
    await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("private to us"),
      idempotencyKey: "key-00000003",
    });
    await expect(
      service.thread({ actor: STRANGER, relationshipId: REL }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(
      service.send({
        actor: STRANGER,
        relationshipId: REL,
        request: text("hello"),
        idempotencyKey: "key-00000004",
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(
      service.readForQ({ actor: STRANGER, relationshipId: REL }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(
      service.thread({ actor: FOUNDER, relationshipId: OTHER_REL }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    expect((await service.unread(STRANGER)).items).toEqual([]);
  });

  it("does not ask Network about a malformed id", async () => {
    const { service, resolved } = world();
    await expect(
      service.thread({ actor: FOUNDER, relationshipId: "../../etc" }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    expect(resolved).toEqual([]);
  });

  it("opens the composer only once the relationship is connected", async () => {
    const { service } = world({ connected: false });
    await expect(
      service.send({
        actor: FOUNDER,
        relationshipId: REL,
        request: text("too early"),
        idempotencyKey: "key-00000005",
      }),
    ).rejects.toBeInstanceOf(ChatNotConnectedError);
    const thread = await service.thread({
      actor: FOUNDER,
      relationshipId: REL,
    });
    expect(thread.status).toBe("NOT_CONNECTED");
    expect(thread.messages).toEqual([]);
  });

  it("is idempotent per sender key, and refuses a key reused for other words", async () => {
    const { service, store } = world();
    const first = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("once"),
      idempotencyKey: "key-00000006",
    });
    const again = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("once"),
      idempotencyKey: "key-00000006",
    });
    expect(again.deduplicated).toBe(true);
    expect(again.message.messageId).toBe(first.message.messageId);
    expect(store.rows).toHaveLength(1);
    await expect(
      service.send({
        actor: FOUNDER,
        relationshipId: REL,
        request: text("twice"),
        idempotencyKey: "key-00000006",
      }),
    ).rejects.toBeInstanceOf(ChatIdempotencyConflictError);
  });

  it("refuses a send by anything but a person", async () => {
    const { service } = world();
    await expect(
      service.send({
        actor: { ...FOUNDER, actorType: "Q" },
        relationshipId: REL,
        request: text("x"),
        idempotencyKey: "key-00000007",
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("shares only the sender's own scanned documents", async () => {
    const { service } = world();
    const sent = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: { kind: "ATTACHMENT", documentId: DOC },
      idempotencyKey: "key-00000008",
    });
    expect(sent.message.attachment).toEqual({
      documentId: DOC,
      title: "Seed deck",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    await expect(
      service.send({
        actor: FOUNDER,
        relationshipId: REL,
        request: { kind: "ATTACHMENT", documentId: PENDING_DOC },
        idempotencyKey: "key-00000009",
      }),
    ).rejects.toMatchObject({ reason: "NOT_READY" });
    await expect(
      service.send({
        actor: INVESTOR,
        relationshipId: REL,
        request: { kind: "VOICE_NOTE", documentId: DOC, durationMs: 4000 },
        idempotencyKey: "key-00000010",
      }),
    ).rejects.toBeInstanceOf(ChatAttachmentUnavailableError);
  });

  it("opens a shared file for either party, never once unsent, never for a stranger", async () => {
    const { service, downloads } = world();
    const file = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: { kind: "ATTACHMENT", documentId: DOC },
      idempotencyKey: "key-00000020",
    });
    const voice = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: { kind: "VOICE_NOTE", documentId: VOICE, durationMs: 3000 },
      idempotencyKey: "key-00000021",
    });
    const plain = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("no file"),
      idempotencyKey: "key-00000022",
    });

    await service.attachment({
      actor: INVESTOR,
      relationshipId: REL,
      messageId: file.message.messageId,
    });
    await service.attachment({
      actor: INVESTOR,
      relationshipId: REL,
      messageId: voice.message.messageId,
    });
    expect(downloads).toEqual([
      {
        documentTenantId: DOC_TENANT,
        documentId: DOC,
        documentVersionId: DOC_VERSION,
        disposition: "ATTACHMENT",
      },
      {
        documentTenantId: DOC_TENANT,
        documentId: VOICE,
        documentVersionId: DOC_VERSION,
        disposition: "INLINE",
      },
    ]);

    await expect(
      service.attachment({
        actor: STRANGER,
        relationshipId: REL,
        messageId: file.message.messageId,
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(
      service.attachment({
        actor: INVESTOR,
        relationshipId: REL,
        messageId: plain.message.messageId,
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    await service.unsend({
      actor: FOUNDER,
      relationshipId: REL,
      messageId: file.message.messageId,
      idempotencyKey: "key-00000023",
    });
    await expect(
      service.attachment({
        actor: INVESTOR,
        relationshipId: REL,
        messageId: file.message.messageId,
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    expect(downloads).toHaveLength(2);
  });

  it("never sends audio as a document or a document as a voice note", async () => {
    const { service } = world();
    await expect(
      service.send({
        actor: FOUNDER,
        relationshipId: REL,
        request: { kind: "VOICE_NOTE", documentId: DOC, durationMs: 3000 },
        idempotencyKey: "key-00000024",
      }),
    ).rejects.toBeInstanceOf(ChatAttachmentUnavailableError);
    await expect(
      service.send({
        actor: FOUNDER,
        relationshipId: REL,
        request: { kind: "ATTACHMENT", documentId: VOICE },
        idempotencyKey: "key-00000025",
      }),
    ).rejects.toBeInstanceOf(ChatAttachmentUnavailableError);
  });

  it("unsends only your own message, as a tombstone the poll picks up", async () => {
    const { service, store } = world();
    const mine = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("oops"),
      idempotencyKey: "key-00000011",
    });
    const theirs = await service.send({
      actor: INVESTOR,
      relationshipId: REL,
      request: text("hello"),
      idempotencyKey: "key-00000012",
    });
    const polled = await service.thread({
      actor: INVESTOR,
      relationshipId: REL,
    });
    const cursor = polled.cursor ?? "";

    await expect(
      service.unsend({
        actor: FOUNDER,
        relationshipId: REL,
        messageId: theirs.message.messageId,
        idempotencyKey: "key-00000013",
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    await service.unsend({
      actor: FOUNDER,
      relationshipId: REL,
      messageId: mine.message.messageId,
      idempotencyKey: "key-00000014",
    });

    const changes = await service.thread({
      actor: INVESTOR,
      relationshipId: REL,
      after: cursor,
    });
    expect(changes.messages).toHaveLength(1);
    expect(changes.messages[0]).toMatchObject({
      messageId: mine.message.messageId,
      unsent: true,
      body: null,
    });
    // History is kept: the original row is still there, next to its tombstone.
    expect(
      store.rows.filter((r) => r.id === mine.message.messageId),
    ).toHaveLength(1);
    expect(store.activity).toHaveLength(2);
  });

  it("moves the read cursor forward only and shows the other side's", async () => {
    const { service } = world();
    const a = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("one"),
      idempotencyKey: "key-00000015",
    });
    const b = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("two"),
      idempotencyKey: "key-00000016",
    });
    expect((await service.unread(INVESTOR)).items).toEqual([
      { relationshipId: REL, unread: 2 },
    ]);
    await service.markRead({
      actor: INVESTOR,
      relationshipId: REL,
      lastReadMessageId: b.message.messageId,
    });
    await service.markRead({
      actor: INVESTOR,
      relationshipId: REL,
      lastReadMessageId: a.message.messageId,
    });
    const founderView = await service.thread({
      actor: FOUNDER,
      relationshipId: REL,
    });
    expect(founderView.counterpartLastReadMessageId).toBe(b.message.messageId);
    expect((await service.unread(INVESTOR)).items).toEqual([]);
    await expect(
      service.markRead({
        actor: STRANGER,
        relationshipId: REL,
        lastReadMessageId: b.message.messageId,
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("gives Q only the invoker's own thread, bounded, without unsent words", async () => {
    const { service } = world();
    const gone = await service.send({
      actor: FOUNDER,
      relationshipId: REL,
      request: text("retracted figure"),
      idempotencyKey: "key-00000017",
    });
    await service.unsend({
      actor: FOUNDER,
      relationshipId: REL,
      messageId: gone.message.messageId,
      idempotencyKey: "key-00000018",
    });
    await service.send({
      actor: INVESTOR,
      relationshipId: REL,
      request: text("x".repeat(2000)),
      idempotencyKey: "key-00000019",
    });
    const read = await service.readForQ({
      actor: FOUNDER,
      relationshipId: REL,
    });
    expect(read.messages).toHaveLength(1);
    expect(read.messages[0]?.from).toBe("OTHER_SIDE");
    expect(read.messages[0]?.text?.length).toBe(600);
    expect(JSON.stringify(read)).not.toContain("retracted figure");
  });
});
