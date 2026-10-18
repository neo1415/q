import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  conversationTitle,
  createGetQConversation,
  createListQConversations,
  toQConversationSummary,
} from "../src/application/conversations.js";
import type { QRuntimeDependencies } from "../src/application/dependencies.js";
import type {
  QConversation,
  QConversationMessage,
  QRunRecord,
} from "../src/contracts/index.js";
import { QConversationNotFoundError } from "../src/domain/errors.js";

/**
 * A person's conversations (ADR 0012), over recording doubles: the
 * projection carries a title even before the extractor has written one,
 * paging is by last activity, and a conversation that is not the
 * actor's is not found.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});

function conversation(
  id: string,
  overrides: Partial<QConversation> = {},
): QConversation {
  return {
    id,
    tenantId: TENANT,
    userId: USER,
    organisationId: null,
    contextType: "PERSONAL",
    subjects: [],
    title: null,
    summary: null,
    summaryThrough: null,
    lastMessageAt: "2026-09-17T10:00:00.000Z",
    createdAt: "2026-09-17T09:00:00.000Z",
    archivedAt: null,
    ...overrides,
  } as QConversation;
}

function message(
  conversationId: string,
  role: "USER" | "Q",
  content: string,
  runId = "f0000000-0000-4000-8000-000000000001",
): QConversationMessage {
  return {
    id: `${conversationId.slice(0, 8)}-0000-4000-8000-00000000000${role === "USER" ? "1" : "2"}`,
    tenantId: TENANT,
    conversationId,
    runId,
    role,
    content,
    contentType: "TEXT",
    createdAt: "2026-09-17T10:00:00.000Z",
  } as QConversationMessage;
}

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";

function dependencies(input: {
  readonly conversations: readonly QConversation[];
  readonly messages: readonly QConversationMessage[];
  readonly latestRun?: QRunRecord | null;
}): QRuntimeDependencies {
  const refusals: unknown[] = [];
  return {
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    subjects: {} as never,
    securityEvents: {
      record: (event: unknown) => {
        refusals.push(event);
        return Promise.resolve();
      },
    } as never,
    repositories: {
      conversations: {
        findForOwner: (
          _e: unknown,
          tenantId: string,
          userId: string,
          id: string,
        ) =>
          Promise.resolve(
            input.conversations.find(
              (c) =>
                c.id === id && c.tenantId === tenantId && c.userId === userId,
            ) ?? null,
          ),
        findOwnership: (_e: unknown, id: string) => {
          const found = input.conversations.find((c) => c.id === id);
          return Promise.resolve(
            found === null || found === undefined
              ? null
              : { tenantId: found.tenantId, userId: found.userId },
          );
        },
        listForOwner: (
          _e: unknown,
          tenantId: string,
          userId: string,
          page: { readonly limit: number },
        ) =>
          Promise.resolve(
            input.conversations
              .filter((c) => c.tenantId === tenantId && c.userId === userId)
              .slice(0, page.limit),
          ),
      },
      messages: {
        listRecentForConversation: (
          _e: unknown,
          _t: unknown,
          id: string,
          limit: number,
        ) =>
          Promise.resolve(
            input.messages.filter((m) => m.conversationId === id).slice(-limit),
          ),
      },
      runs: {
        findLatestForConversation: () =>
          Promise.resolve(input.latestRun ?? null),
      },
    } as never,
  };
}

describe("conversation titles", () => {
  it("uses the extractor's title, else the opening words, else a plain label", () => {
    expect(
      conversationTitle(conversation(A, { title: "Paystack comparison" }), "x"),
    ).toBe("Paystack comparison");
    expect(
      conversationTitle(conversation(A), "How do I compare with Paystack?"),
    ).toBe("How do I compare with Paystack?");
    expect(
      conversationTitle(
        conversation(A),
        "A very long opening question that goes on and on about many different things at once",
      ),
    ).toMatch(/…$/);
    expect(conversationTitle(conversation(A), null)).toBe("New conversation");
  });

  it("projects only the public fields, never the summary", () => {
    const summary = toQConversationSummary(
      conversation(A, { summary: "MODEL-WRITTEN-SUMMARY" }),
      "Opening",
    );
    expect(JSON.stringify(summary)).not.toContain("MODEL-WRITTEN-SUMMARY");
    expect(summary).toEqual({
      conversationId: A,
      title: "Opening",
      subjects: [],
      createdAt: "2026-09-17T09:00:00.000Z",
      lastMessageAt: "2026-09-17T10:00:00.000Z",
    });
  });
});

describe("listing and opening conversations", () => {
  it("lists the actor's own conversations with a title each and a cursor when full", async () => {
    const list = createListQConversations(
      dependencies({
        conversations: [conversation(A), conversation(B, { title: "Second" })],
        messages: [message(A, "USER", "First words")],
      }),
    );
    const page = await list({ actor, limit: 2 });
    expect(page.items.map((i) => i.title)).toEqual(["First words", "Second"]);
    expect(page.nextBefore).toBe("2026-09-17T10:00:00.000Z");
    const short = await list({ actor, limit: 5 });
    expect(short.nextBefore).toBeUndefined();
  });

  it("opens the actor's conversation with its turns and latest run, and hides anyone else's", async () => {
    const get = createGetQConversation(
      dependencies({
        conversations: [
          conversation(A),
          conversation(B, { userId: OTHER } as never),
        ],
        messages: [message(A, "USER", "Hello"), message(A, "Q", "Hi.")],
        latestRun: {
          id: "f0000000-0000-4000-8000-000000000001",
          conversationId: A,
          status: "COMPLETED",
          createdAt: "2026-09-17T10:00:00.000Z",
        } as QRunRecord,
      }),
    );
    const opened = await get({ actor, conversationId: A as never });
    expect(opened.detail.messages.map((m) => m.role)).toEqual(["USER", "Q"]);
    expect(opened.detail.latestRun?.status).toBe("COMPLETED");
    expect(opened.detail.conversation.title).toBe("Hello");
    await expect(
      get({ actor, conversationId: B as never }),
    ).rejects.toBeInstanceOf(QConversationNotFoundError);
  });
});
