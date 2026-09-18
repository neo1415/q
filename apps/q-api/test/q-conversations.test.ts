import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  QConversationNotFoundError,
  type QRuntimeService,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";

/**
 * `/v1/q/conversations` at the HTTP boundary (ADR 0012). The runtime is a
 * recording double; what is proven here is that the actor comes from the
 * verified session, that the responses are the public projections, and
 * that a conversation the runtime refuses is a 404 with nothing inside.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const CONVERSATION = "f0000000-0000-4000-8000-000000000002";
const NOW = "2026-09-17T10:00:00.000Z";

const SUMMARY = {
  conversationId: CONVERSATION,
  title: "Runway",
  subjects: [],
  createdAt: NOW,
  lastMessageAt: NOW,
};

function fakeService() {
  const calls = {
    list: [] as unknown[],
    get: [] as unknown[],
    archive: [] as unknown[],
  };
  const service = {
    listConversations: (query: unknown) => {
      calls.list.push(query);
      return Promise.resolve({ items: [SUMMARY], nextBefore: NOW });
    },
    getConversation: (query: { conversationId: string }) => {
      calls.get.push(query);
      if (query.conversationId !== CONVERSATION) {
        return Promise.reject(new QConversationNotFoundError());
      }
      return Promise.resolve({
        conversation: { summary: "PRIVATE-SUMMARY" },
        messages: [],
        latestRun: null,
        detail: {
          conversation: SUMMARY,
          messages: [
            {
              messageId: "f0000000-0000-4000-8000-000000000003",
              runId: "f0000000-0000-4000-8000-000000000001",
              role: "USER",
              text: "How much runway?",
              createdAt: NOW,
            },
          ],
          latestRun: {
            runId: "f0000000-0000-4000-8000-000000000001",
            conversationId: CONVERSATION,
            status: "COMPLETED",
            createdAt: NOW,
          },
        },
      });
    },
    archiveConversation: (command: unknown) => {
      calls.archive.push(command);
      return Promise.resolve();
    },
  } as unknown as QRuntimeService;
  return { service, calls };
}

function buildApp(
  service: QRuntimeService,
  principal = PRINCIPAL,
): FastifyInstance {
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  return createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    qRuntime: service,
  }).app;
}

describe("/v1/q/conversations", () => {
  it("lists the owner's conversations under the session's actor, with the paging cursor", async () => {
    const { service, calls } = fakeService();
    const app = buildApp(service);
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/conversations?limit=10",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [SUMMARY], nextBefore: NOW });
    expect(calls.list[0]).toMatchObject({ actor: CONTEXT, limit: 10 });
    await app.close();
  });

  it("opens a conversation as its public detail and never the summary text", async () => {
    const { service } = fakeService();
    const app = buildApp(service);
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/conversations/${CONVERSATION}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("PRIVATE-SUMMARY");
    expect(
      response.json<{ latestRun: { status: string } }>().latestRun.status,
    ).toBe("COMPLETED");
    await app.close();
  });

  it("answers 404 for a conversation the runtime refuses, and 422 for a malformed id", async () => {
    const { service } = fakeService();
    const app = buildApp(service);
    const missing = await app.inject({
      method: "GET",
      url: "/v1/q/conversations/f0000000-0000-4000-8000-000000000009",
    });
    expect(missing.statusCode).toBe(404);
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/q/conversations/not-an-id",
    });
    expect(malformed.statusCode).toBe(422);
    await app.close();
  });

  it("archives idempotently with no body and answers 204", async () => {
    const { service, calls } = fakeService();
    const app = buildApp(service);
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/conversations/${CONVERSATION}/archive`,
    });
    expect(response.statusCode).toBe(204);
    expect(calls.archive[0]).toMatchObject({
      actor: CONTEXT,
      conversationId: CONVERSATION,
    });
    await app.close();
  });

  it("refuses an unauthenticated caller", async () => {
    const { service, calls } = fakeService();
    const app = buildApp(service, null as never);
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/conversations",
    });
    expect(response.statusCode).toBe(401);
    expect(calls.list).toHaveLength(0);
    await app.close();
  });
});
