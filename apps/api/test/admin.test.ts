import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  ADMIN_PERMISSIONS,
  createPlatformAdmin,
  roleHolds,
  type AdminPermission,
  type AdminRole,
} from "@capital-q/platform-admin";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContextResolver,
} from "@capital-q/security";

import { createApp } from "../src/app.js";
import {
  AccountSuspendedError,
  withSuspension,
} from "../src/security/suspension.js";

/**
 * ADR 0033 RBAC negatives for EVERY admin route: a non-admin gets the 404
 * of a missing path; an admin whose role lacks the permission gets the
 * same 404; a sensitive write without a live step-up gets
 * STEP_UP_REQUIRED; the holder with a step-up gets through. The real
 * platform-admin service decides, over an in-memory table of roles and
 * step-ups.
 */

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const MEMBERSHIP = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);
const SOME_ID = "f0000000-0000-4000-8000-000000000001";

type Person = { readonly role: AdminRole | null; readonly stepUp: boolean };

function fakeSql(people: ReadonlyMap<string, Person>) {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("from identity.platform_admins where user_id")) {
      const person = people.get(String(values[0]));
      return Promise.resolve(
        person?.role === null || person === undefined
          ? []
          : [{ role: person.role }],
      );
    }
    if (text.includes("from platform_ops.step_ups")) {
      const person = people.get(String(values[0]));
      return Promise.resolve(
        person?.stepUp === true
          ? [{ id: SOME_ID, expires_at: new Date(Date.now() + 600_000) }]
          : [],
      );
    }
    return Promise.resolve([]);
  };
  return Object.assign(sql, { json: (value: unknown) => value }) as never;
}

function appFor(
  userId: string,
  people: ReadonlyMap<string, Person>,
): FastifyInstance {
  const sql = fakeSql(people);
  const resolver: ActorContextResolver = {
    resolveHumanContext: () =>
      Promise.resolve({
        status: "RESOLVED",
        context: {
          userId: UserIdSchema.parse(userId),
          tenantId: TENANT,
          organisationId: ORG,
          membershipId: MEMBERSHIP,
          actorType: "HUMAN",
        },
      }),
  };
  return createApp(
    parseApiConfig({ NODE_ENV: "test" }),
    {
      authenticator: {
        authenticate: () =>
          Promise.resolve({
            authUserId: AuthUserIdSchema.parse(
              "a0000000-0000-4000-8000-000000000001",
            ),
          }),
      },
      resolver,
      identities: { lookup: () => Promise.resolve(null) },
    },
    {
      admin: createPlatformAdmin({
        sql,
        transactions: { run: (work) => work({ sql }) },
      }),
      adminVerificationDecider: () =>
        Promise.resolve({ kind: "NOTHING_TO_DECIDE" }),
    },
  ).app;
}

type Route = {
  readonly method: "GET" | "POST" | "DELETE";
  readonly url: string;
  readonly permission: AdminPermission;
  readonly body?: Record<string, unknown>;
  /** A list read the holder gets as 200 even over an empty table. */
  readonly listOk?: boolean;
};

const REASON = { reason: "Checked against the report" };
const ROUTES: readonly Route[] = [
  {
    method: "GET",
    url: "/v1/admin/overview",
    permission: "overview.read",
    listOk: true,
  },
  {
    method: "GET",
    url: "/v1/admin/attribution",
    permission: "ledger.read",
    listOk: true,
  },
  {
    method: "GET",
    url: "/v1/admin/disputes",
    permission: "ledger.read",
    listOk: true,
  },
  {
    method: "GET",
    url: "/v1/admin/paused",
    permission: "accounts.read",
    listOk: true,
  },
  {
    method: "POST",
    url: `/v1/admin/paused/${SOME_ID}/reinstate`,
    permission: "accounts.reinstate_q",
  },
  {
    method: "GET",
    url: "/v1/admin/accounts?q=ada",
    permission: "accounts.read",
    listOk: true,
  },
  {
    method: "GET",
    url: `/v1/admin/accounts/${SOME_ID}`,
    permission: "accounts.read",
  },
  {
    method: "POST",
    url: `/v1/admin/accounts/${SOME_ID}/suspension`,
    permission: "accounts.suspend",
    body: { suspend: true, ...REASON },
  },
  {
    method: "GET",
    url: "/v1/admin/organisations?q=ada",
    permission: "accounts.read",
    listOk: true,
  },
  {
    method: "GET",
    url: `/v1/admin/organisations/${SOME_ID}`,
    permission: "accounts.read",
  },
  {
    method: "POST",
    url: `/v1/admin/organisations/${SOME_ID}/suspension`,
    permission: "accounts.suspend",
    body: { suspend: true, ...REASON },
  },
  {
    method: "GET",
    url: "/v1/admin/verification/claims",
    permission: "verification.read",
    listOk: true,
  },
  {
    method: "POST",
    url: `/v1/admin/verification/claims/${SOME_ID}/decision`,
    permission: "verification.decide",
    body: { status: "VERIFIED", decisionBasis: "Registry entry matches" },
  },
  {
    method: "GET",
    url: "/v1/admin/safety",
    permission: "safety.read",
    listOk: true,
  },
  {
    method: "POST",
    url: `/v1/admin/safety/reports/${SOME_ID}/review`,
    permission: "safety.decide",
    body: { outcome: "NO_ACTION", note: "Not a breach" },
  },
  {
    method: "GET",
    url: "/v1/admin/break-glass",
    permission: "safety.read",
    listOk: true,
  },
  {
    method: "POST",
    url: "/v1/admin/break-glass",
    permission: "breakglass.request",
    body: {
      targetType: "RELATIONSHIP_CHAT",
      targetId: SOME_ID,
      reason: "A harassment report names this chat",
    },
  },
  {
    method: "POST",
    url: `/v1/admin/break-glass/${SOME_ID}/decision`,
    permission: "breakglass.approve",
    body: { approve: true, note: "Report checked" },
  },
  {
    method: "GET",
    url: `/v1/admin/break-glass/${SOME_ID}/chat`,
    permission: "breakglass.request",
  },
  {
    method: "GET",
    url: "/v1/admin/q/monitor?window=7d",
    permission: "q.monitor.read",
    listOk: true,
  },
  {
    method: "GET",
    url: "/v1/admin/q/errors",
    permission: "q.monitor.read",
    listOk: true,
  },
  {
    method: "GET",
    url: `/v1/admin/q/runs/${SOME_ID}`,
    permission: "q.trace.read",
  },
  {
    method: "GET",
    url: "/v1/admin/audit",
    permission: "audit.read",
    listOk: true,
  },
  {
    method: "GET",
    url: "/v1/admin/flags",
    permission: "flags.read",
    listOk: true,
  },
  {
    method: "POST",
    url: "/v1/admin/flags/q.daily",
    permission: "flags.write",
    body: { enabled: false, ...REASON },
  },
  {
    method: "GET",
    url: "/v1/admin/email",
    permission: "email.read",
    listOk: true,
  },
  {
    method: "GET",
    url: "/v1/admin/team",
    permission: "overview.read",
    listOk: true,
  },
  {
    method: "POST",
    url: "/v1/admin/team",
    permission: "roles.manage",
    body: { email: "new@example.com", role: "support", ...REASON },
  },
  {
    method: "DELETE",
    url: `/v1/admin/team/${SOME_ID}`,
    permission: "roles.manage",
    body: REASON,
  },
];

const USERS = {
  nobody: "b0000000-0000-4000-8000-000000000000",
} as const;

function idFor(role: AdminRole, stepUp: boolean): string {
  const index = [
    "platform_owner",
    "operator",
    "trust_and_safety",
    "support",
    "analyst",
  ].indexOf(role);
  return `b0000000-0000-4000-8000-0000000000${String(index + 1)}${stepUp ? "1" : "0"}`;
}

const PEOPLE = new Map<string, Person>([
  [USERS.nobody, { role: null, stepUp: false }],
]);
for (const role of [
  "platform_owner",
  "operator",
  "trust_and_safety",
  "support",
  "analyst",
] as const) {
  PEOPLE.set(idFor(role, true), { role, stepUp: true });
  PEOPLE.set(idFor(role, false), { role, stepUp: false });
}

async function call(userId: string, route: Route) {
  const app = appFor(userId, PEOPLE);
  const response = await app.inject({
    method: route.method,
    url: route.url,
    ...(route.body === undefined ? {} : { payload: route.body }),
  });
  await app.close();
  return response;
}

describe("admin console RBAC (every route)", () => {
  it("covers every permission in the table", () => {
    const covered = new Set(ROUTES.map((route) => route.permission));
    for (const permission of Object.keys(ADMIN_PERMISSIONS)) {
      expect(covered.has(permission as AdminPermission), permission).toBe(true);
    }
  });

  for (const route of ROUTES) {
    describe(`${route.method} ${route.url}`, () => {
      it("is a 404 for a person who is not an admin", async () => {
        const response = await call(USERS.nobody, route);
        expect(response.statusCode).toBe(404);
        expect(response.json<{ code: string }>().code).toBe(
          "RESOURCE_NOT_FOUND",
        );
      });

      it("is a 404 for every admin role without the permission", async () => {
        for (const role of [
          "platform_owner",
          "operator",
          "trust_and_safety",
          "support",
          "analyst",
        ] as const) {
          if (roleHolds(role, route.permission)) continue;
          const response = await call(idFor(role, true), route);
          expect(response.statusCode, role).toBe(404);
        }
      });

      const stepUp = ADMIN_PERMISSIONS[route.permission].stepUp;
      if (stepUp) {
        it("asks a holder without a live step-up to confirm it's them", async () => {
          const holder = ADMIN_PERMISSIONS[route.permission].roles[0];
          if (holder === undefined) throw new Error("no holder");
          const response = await call(idFor(holder, false), route);
          expect(response.statusCode).toBe(403);
          expect(response.json<{ code: string }>().code).toBe(
            "STEP_UP_REQUIRED",
          );
        });
      }

      it("lets a holder through", async () => {
        const holder = ADMIN_PERMISSIONS[route.permission].roles[0];
        if (holder === undefined) throw new Error("no holder");
        const response = await call(idFor(holder, true), route);
        expect(response.statusCode).not.toBe(500);
        expect(response.json<{ code?: string }>().code).not.toBe(
          "STEP_UP_REQUIRED",
        );
        if (route.listOk === true) expect(response.statusCode).toBe(200);
      });
    });
  }

  it("tells an admin their role and permissions, and a non-admin nothing", async () => {
    const owner = await call(idFor("analyst", false), {
      method: "GET",
      url: "/v1/admin/me",
      permission: "overview.read",
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json<{ role: string; permissions: string[] }>().role).toBe(
      "analyst",
    );
    expect(owner.json<{ permissions: string[] }>().permissions).not.toContain(
      "accounts.read",
    );
    const nobody = await call(USERS.nobody, {
      method: "GET",
      url: "/v1/admin/me",
      permission: "overview.read",
    });
    expect(nobody.statusCode).toBe(404);
  });

  it("refuses a step-up for a non-admin and a stale or unverifiable token", async () => {
    const nobody = await call(USERS.nobody, {
      method: "POST",
      url: "/v1/admin/step-up",
      permission: "overview.read",
      body: { accessToken: "x".repeat(40) },
    });
    expect(nobody.statusCode).toBe(404);
    const unverified = await call(idFor("operator", false), {
      method: "POST",
      url: "/v1/admin/step-up",
      permission: "overview.read",
      body: { accessToken: "x".repeat(40) },
    });
    expect(unverified.statusCode).toBe(401);
  });
});

describe("account suspension", () => {
  it("turns a suspended person's resolved context into ACCOUNT_SUSPENDED", async () => {
    const resolver = withSuspension(
      {
        resolveHumanContext: () =>
          Promise.resolve({
            status: "RESOLVED",
            context: {
              userId: UserIdSchema.parse(USERS.nobody),
              tenantId: TENANT,
              organisationId: ORG,
              membershipId: MEMBERSHIP,
              actorType: "HUMAN",
            },
          }),
      },
      (userId) => Promise.resolve(userId === USERS.nobody),
    );
    const app = createApp(
      parseApiConfig({ NODE_ENV: "test" }),
      {
        authenticator: {
          authenticate: () =>
            Promise.resolve({
              authUserId: AuthUserIdSchema.parse(
                "a0000000-0000-4000-8000-000000000001",
              ),
            }),
        },
        resolver,
        identities: { lookup: () => Promise.resolve(null) },
      },
      {
        admin: createPlatformAdmin({
          sql: fakeSql(PEOPLE),
          transactions: { run: (w) => w({ sql: fakeSql(PEOPLE) }) },
        }),
      },
    ).app;
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/overview",
    });
    await app.close();
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("ACCOUNT_SUSPENDED");
    await expect(
      resolver.resolveHumanContext({
        principal: {
          authUserId: AuthUserIdSchema.parse(
            "a0000000-0000-4000-8000-000000000001",
          ),
        },
      }),
    ).rejects.toBeInstanceOf(AccountSuspendedError);
  });
});
