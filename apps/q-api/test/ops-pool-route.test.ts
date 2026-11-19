import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  Q_API_OPS_POOL_PATH,
  QApiOpsPoolDtoSchema,
} from "@capital-q/contracts";
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
 * The console's System health reads q-api's pool (incident 19 Nov 2026):
 * counts and ages only, for platform operators holding overview.read, and
 * the same 404 as any console read for everyone else. The public readiness
 * answer stays as it was.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const OPERATOR = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const CUSTOMER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const contextFor = (userId: typeof OPERATOR): ActorContext => ({
  userId,
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
});

const SNAPSHOT = {
  slots: 10,
  held: 3,
  waiting: 0,
  oldestHeldMs: 400,
  recycles: 1,
  lastRecycledAt: "2026-11-19T09:12:00.000Z",
};

function build(options: {
  readonly signedIn: boolean;
  readonly userId?: typeof OPERATOR;
  readonly pool?: typeof SNAPSHOT | null;
}) {
  const asked: string[] = [];
  const security: QApiSecurityDependencies = {
    authenticator: {
      authenticate: () => Promise.resolve(options.signedIn ? PRINCIPAL : null),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({
          status: "RESOLVED",
          context: contextFor(options.userId ?? OPERATOR),
        }),
    },
    identity: {
      lookup: () =>
        Promise.resolve({ userId: options.userId ?? OPERATOR }) as never,
    },
  };
  const app = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    opsPool: {
      pool: () => (options.pool === undefined ? SNAPSHOT : options.pool),
      isOperator: (userId) => {
        asked.push(userId);
        return Promise.resolve(userId === OPERATOR);
      },
    },
  }).app;
  return { app, asked };
}

describe(`GET ${Q_API_OPS_POOL_PATH}`, () => {
  it("gives an operator the pool's counts and ages, and nothing else", async () => {
    const { app, asked } = build({ signedIn: true });
    const response = await app.inject({
      method: "GET",
      url: Q_API_OPS_POOL_PATH,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = QApiOpsPoolDtoSchema.parse(response.json());
    expect(body).toEqual({ pool: SNAPSHOT });
    expect(asked).toEqual([OPERATOR]);
    await app.close();
  });

  it("says null, not a healthy pool, when the process has none to watch", async () => {
    const { app } = build({ signedIn: true, pool: null });
    const response = await app.inject({
      method: "GET",
      url: Q_API_OPS_POOL_PATH,
    });
    expect(response.json()).toEqual({ pool: null });
    await app.close();
  });

  it("is a 404 for a signed-in person who is not an operator", async () => {
    const { app } = build({ signedIn: true, userId: CUSTOMER });
    const response = await app.inject({
      method: "GET",
      url: Q_API_OPS_POOL_PATH,
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("slots");
    await app.close();
  });

  it("refuses a request with no session before anything is read", async () => {
    const { app, asked } = build({ signedIn: false });
    const response = await app.inject({
      method: "GET",
      url: Q_API_OPS_POOL_PATH,
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("slots");
    expect(asked).toEqual([]);
    await app.close();
  });

  it("leaves the public readiness answer without any pool detail", async () => {
    const { app } = build({ signedIn: false });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.body).not.toContain("slots");
    expect(response.body).not.toContain("recycle");
    await app.close();
  });
});
