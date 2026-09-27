import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import { createChatService, type ChatParty } from "@capital-q/communication";
import { createInMemoryChatStore } from "@capital-q/communication/testing";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * /v1/relationships/:id/messages (R34) over fastify.inject: a party lists
 * and sends (idempotently), a non-party gets the same 404 as a missing
 * thread, a not-yet-connected relationship refuses a send with 409, and a
 * send without an Idempotency-Key is refused before anything is written.
 */

const REL = "00000000-0000-4000-8000-00000000c001";
const OTHER = "00000000-0000-4000-8000-00000000c002";

function contextFor(org: string): ActorContext {
  return {
    userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
    tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
    organisationId: OrganisationIdSchema.parse(org),
    membershipId: MembershipIdSchema.parse(
      "e0000000-0000-4000-8000-000000000001",
    ),
    actorType: "HUMAN",
  };
}
const COMPANY_ORG = "d0000000-0000-4000-8000-000000000001";

function build(options: { connected?: boolean; org?: string } = {}) {
  const store = createInMemoryChatStore();
  const chat = createChatService({
    store,
    parties: (actor, relationshipId) =>
      Promise.resolve<ChatParty | null>(
        relationshipId === REL && actor.organisationId === COMPANY_ORG
          ? { side: "COMPANY", connected: options.connected ?? true }
          : null,
      ),
    documents: () => Promise.resolve({ outcome: "NOT_FOUND" }),
    newCorrelationId: () => "cor_00000000-0000-4000-8000-000000000001",
  });
  const context = contextFor(options.org ?? COMPANY_ORG);
  const security: ApiSecurityDependencies = {
    authenticator: {
      authenticate: () =>
        Promise.resolve({
          authUserId: AuthUserIdSchema.parse(
            "a0000000-0000-4000-8000-000000000001",
          ),
        }),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context }),
    },
    identities: {
      lookup: () =>
        Promise.resolve({ userId: context.userId, displayName: "Ada" }),
    },
  };
  const app = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    chat,
  }).app;
  return { app, store };
}

const send = (body: unknown, key?: string) => ({
  method: "POST" as const,
  url: `/v1/relationships/${REL}/messages`,
  payload: body as Record<string, unknown>,
  headers: key === undefined ? {} : { "idempotency-key": key },
});

describe("/v1/relationships/:relationshipId/messages", () => {
  it("sends once per key and lists the thread", async () => {
    const { app, store } = build();
    const first = await app.inject(
      send({ kind: "TEXT", body: "Hello" }, "chat-key-0001"),
    );
    expect(first.statusCode).toBe(201);
    const again = await app.inject(
      send({ kind: "TEXT", body: "Hello" }, "chat-key-0001"),
    );
    expect(again.statusCode).toBe(200);
    expect(again.json<{ deduplicated: boolean }>().deduplicated).toBe(true);
    expect(store.rows).toHaveLength(1);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/relationships/${REL}/messages`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    const thread = listed.json<{
      status: string;
      messages: { body: string; mine: boolean }[];
    }>();
    expect(thread.status).toBe("OPEN");
    expect(thread.messages).toEqual([
      expect.objectContaining({ body: "Hello", mine: true }),
    ]);
  });

  it("requires an Idempotency-Key and a valid body before writing", async () => {
    const { app, store } = build();
    expect(
      (await app.inject(send({ kind: "TEXT", body: "x" }))).statusCode,
    ).toBe(422);
    expect(
      (await app.inject(send({ kind: "TEXT", body: "" }, "chat-key-0002")))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject(
          send({ kind: "TEXT", body: "x", tenantId: "t" }, "chat-key-0003"),
        )
      ).statusCode,
    ).toBe(422);
    expect(store.rows).toHaveLength(0);
  });

  it("answers a non-party exactly as a missing thread", async () => {
    const { app } = build({ org: "d0000000-0000-4000-8000-000000000009" });
    const theirs = await app.inject({
      method: "GET",
      url: `/v1/relationships/${REL}/messages`,
    });
    const missing = await app.inject({
      method: "GET",
      url: `/v1/relationships/${OTHER}/messages`,
    });
    expect(theirs.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(theirs.json<{ code: string }>().code).toBe(
      missing.json<{ code: string }>().code,
    );
    expect(
      (await app.inject(send({ kind: "TEXT", body: "hi" }, "chat-key-0004")))
        .statusCode,
    ).toBe(404);
  });

  it("refuses a send before the relationship is connected", async () => {
    const { app } = build({ connected: false });
    const refused = await app.inject(
      send({ kind: "TEXT", body: "early" }, "chat-key-0005"),
    );
    expect(refused.statusCode).toBe(409);
  });

  it("marks read, unsends and reports unread", async () => {
    const { app } = build();
    const sent = await app.inject(
      send({ kind: "TEXT", body: "gone soon" }, "chat-key-0006"),
    );
    const id = sent.json<{ message: { messageId: string } }>().message
      .messageId;
    const read = await app.inject({
      method: "POST",
      url: `/v1/relationships/${REL}/messages/read`,
      payload: { lastReadMessageId: id },
    });
    expect(read.statusCode).toBe(204);
    const unsent = await app.inject({
      method: "POST",
      url: `/v1/relationships/${REL}/messages/${id}/unsend`,
      headers: { "idempotency-key": "chat-key-0007" },
    });
    expect(unsent.statusCode).toBe(204);
    const unread = await app.inject({ method: "GET", url: "/v1/chat/unread" });
    expect(unread.json()).toEqual({ items: [] });
  });
});
