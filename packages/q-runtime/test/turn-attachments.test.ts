import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  QConversationIdSchema,
  QUserMessageSchema,
  type QMessageAttachment,
} from "@capital-q/contracts";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createCreateQRun } from "../src/application/create-run.js";
import type { QRuntimeDependencies } from "../src/application/dependencies.js";
import { toQMessage } from "../src/index.js";

/**
 * D82 (owner live 2026-11-09, "it's not even in the chat"): the turn that
 * carried a file records it, so the chip survives a reload. Derived by the
 * server: the documents on the screen that no earlier turn of the
 * conversation carried, titled by Evidence as the person (one they may
 * not read is dropped). No new request field.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TERMS = "d0000000-0000-4000-8000-0000000000a1";
const TALENT = "d0000000-0000-4000-8000-0000000000a2";
const NOT_THEIRS = "d0000000-0000-4000-8000-0000000000a3";

const person = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

const TITLES: Record<string, string> = {
  [TERMS]: "TERMS AND CONDITIONS",
  [TALENT]: "Talent_Q_Research",
};

function harness(earlier: readonly string[] | null) {
  const conversationId = QConversationIdSchema.parse(randomUUID());
  const inserted: {
    role: string;
    attachments?: readonly QMessageAttachment[];
  }[] = [];
  const askedTitles: string[][] = [];
  const dependencies = {
    sql: {} as never,
    transactions: {
      run: (work: (tx: unknown) => unknown) => work({ sql: {} }),
    },
    subjects: { supports: () => true, resolve: () => Promise.resolve(null) },
    attachedDocuments: {
      titled: (actor: ActorContext, ids: readonly string[]) => {
        expect(actor.userId).toBe(person.userId);
        askedTitles.push([...ids]);
        // Evidence as the actor: a document not theirs is refused.
        return Promise.resolve(
          ids.flatMap((id) => {
            const title = TITLES[id];
            return title === undefined ? [] : [{ documentId: id, title }];
          }),
        );
      },
    },
    repositories: {
      runCreationRequests: {
        lock: () => Promise.resolve(),
        find: () => Promise.resolve(null),
        record: () => Promise.resolve(),
      },
      conversations: {
        insert: (_tx: unknown, input: object) =>
          Promise.resolve({ id: conversationId, ...input }),
        setSubjects: () => Promise.resolve(),
        findForOwner: () =>
          Promise.resolve({
            id: conversationId,
            tenantId: TENANT,
            userId: person.userId,
            organisationId: person.organisationId,
            contextType: "GENERAL",
            subjects: [],
            title: null,
            summary: null,
            archivedAt: null,
          }),
      },
      runs: {
        insert: (_tx: unknown, input: object) =>
          Promise.resolve({
            id: randomUUID(),
            tenantId: TENANT,
            status: "RECEIVED",
            ...input,
          }),
        allocateEventSequence: () => Promise.resolve(1),
      },
      messages: {
        insert: (
          _tx: unknown,
          input: { role: string; attachments?: readonly QMessageAttachment[] },
        ) => {
          inserted.push(input);
          return Promise.resolve({ id: randomUUID(), ...input });
        },
        attachedDocumentIds: () => Promise.resolve(earlier ?? []),
      },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    },
  } as unknown as QRuntimeDependencies;
  const create = createCreateQRun(dependencies);
  const ask = (ids: readonly string[], openedBy?: "Q") =>
    create({
      actor: person,
      input: {
        capability: "ANSWER",
        message: { text: "Whats this about?" },
        modality: "TEXT",
        ...(earlier === null ? {} : { conversationId }),
        screen: {
          route: "HOME",
          ...(ids.length === 0 ? {} : { attachedDocumentIds: [...ids] }),
        },
      },
      idempotencyKey: randomUUID(),
      correlationId: "cor_test",
      ...(openedBy === undefined ? {} : { openedBy }),
    });
  return { ask, inserted, askedTitles };
}

describe("the files a person's turn carried (D82)", () => {
  it("the first turn with a file records it, titled by Evidence as the person", async () => {
    const h = harness(null);
    await h.ask([TERMS]);
    expect(h.inserted.at(-1)).toMatchObject({
      role: "USER",
      attachments: [{ documentId: TERMS, title: "TERMS AND CONDITIONS" }],
    });
  });

  it("a later turn records only what it newly carried, never a file an earlier turn did", async () => {
    const h = harness([TERMS]);
    await h.ask([TERMS, TALENT]);
    expect(h.askedTitles).toEqual([[TALENT]]);
    expect(h.inserted.at(-1)?.attachments).toEqual([
      { documentId: TALENT, title: "Talent_Q_Research" },
    ]);
    const again = harness([TERMS, TALENT]);
    await again.ask([TERMS, TALENT]);
    expect(again.inserted.at(-1)?.attachments).toBeUndefined();
    expect(again.askedTitles).toEqual([]);
  });

  it("a document they may not read is not recorded; Q's own opening never carries files", async () => {
    const h = harness(null);
    await h.ask([NOT_THEIRS]);
    expect(h.inserted.at(-1)?.attachments).toBeUndefined();
    const q = harness(null);
    await q.ask([TERMS], "Q");
    expect(q.inserted.at(-1)?.attachments).toBeUndefined();
  });

  it("served back on the person's turn, in the public contract", () => {
    const message = toQMessage({
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: QConversationIdSchema.parse(randomUUID()),
      runId: randomUUID(),
      role: "USER",
      content: "Whats this about?",
      contentType: "TEXT",
      attachments: [{ documentId: TERMS, title: "TERMS AND CONDITIONS" }],
      createdAt: new Date().toISOString(),
    } as never);
    expect(QUserMessageSchema.parse(message).attachments).toEqual([
      { documentId: TERMS, title: "TERMS AND CONDITIONS" },
    ]);
  });
});
