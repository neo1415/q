import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { MemoryItem } from "@capital-q/q-knowledge";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";

/**
 * What Q remembers, for the person (ADR 0012): read and forgotten as the
 * session's own actor only; an id that is not theirs is a 404.
 */

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
const OWN = "11111111-0000-4000-8000-000000000001";
const NOT_OWN = "11111111-0000-4000-8000-000000000002";

const ITEM = {
  id: OWN,
  subject: null,
  memoryType: "correction",
  content: "Their company is Yamfield Agro.",
  quote: "my company is Yamfield Agro",
  createdAt: "2026-09-29T08:00:00.000Z",
} as unknown as MemoryItem;

function buildApp(signedIn = true) {
  const actors: ActorContext[] = [];
  const security: QApiSecurityDependencies = {
    authenticator: {
      authenticate: () =>
        Promise.resolve(
          signedIn
            ? {
                authUserId: AuthUserIdSchema.parse(
                  "a0000000-0000-4000-8000-000000000001",
                ),
              }
            : null,
        ),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    memory: {
      list: (actor) => {
        actors.push(actor);
        return Promise.resolve([ITEM]);
      },
      forget: ({ actor, memoryItemId }) => {
        actors.push(actor);
        return Promise.resolve(memoryItemId === OWN ? ITEM : null);
      },
    },
  });
  return { app, actors };
}

describe("Q memory routes", () => {
  it("lists the session actor's own memory, in plain words", async () => {
    const { app, actors } = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/q/memory" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          memoryItemId: OWN,
          kind: "correction",
          content: "Their company is Yamfield Agro.",
          quote: "my company is Yamfield Agro",
          about: "YOU",
          learnedAt: "2026-09-29T08:00:00.000Z",
        },
      ],
    });
    expect(actors).toEqual([CONTEXT]);
  });

  it("forgets their own item, and answers 404 for one that is not theirs", async () => {
    const { app } = buildApp();
    const own = await app.inject({
      method: "POST",
      url: `/v1/q/memory/${OWN}/forget`,
    });
    expect(own.statusCode).toBe(204);
    const other = await app.inject({
      method: "POST",
      url: `/v1/q/memory/${NOT_OWN}/forget`,
    });
    expect(other.statusCode).toBe(404);
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/q/memory/not-an-id/forget",
    });
    expect(malformed.statusCode).toBe(404);
  });

  it("requires a session", async () => {
    const { app, actors } = buildApp(false);
    const response = await app.inject({ method: "GET", url: "/v1/q/memory" });
    expect(response.statusCode).toBe(401);
    expect(actors).toHaveLength(0);
  });
});
