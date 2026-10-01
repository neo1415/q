import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  createFakeBillingProvider,
  signStripePayload,
  type BillingAccounts,
  type EntitlementRefusal,
  type EntitlementService,
  type ProviderEvent,
} from "@capital-q/billing";
import { parseApiConfig } from "@capital-q/config/api";
import {
  BILLING_CHECKOUT_PATH,
  BILLING_PLAN_PATH,
  BILLING_STRIPE_WEBHOOK_PATH,
  EntitlementProblemExtensionSchema,
  GATEQ_GATEWAYS_PATH,
} from "@capital-q/contracts";
import type { Gateway, GateQService } from "@capital-q/gateq";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * BILLING over HTTP (ADR 0034): the plan page reads the server-resolved
 * account; checkout needs the organisation's admin and a configured
 * provider; the Stripe webhook accepts only a verified, fresh signature;
 * a gated entry point (gateway create) answers ENTITLEMENT_REQUIRED with
 * the caller's own plan and never runs the work.
 */

const SECRET = "whsec_disabled-locally-000000000000";
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
const INVESTOR = "11111111-0000-4000-8000-000000000013";

const REFUSAL: EntitlementRefusal = {
  feature: "gateq.gateways",
  featureName: "GateQ gateways",
  reason: "LIMIT_REACHED",
  planKey: "free",
  planName: "Free",
  limit: 1,
  used: 1,
  resetsAt: null,
  upgradePath: "/settings/plan",
  message:
    "Your Free plan includes 1 gateway and you have 1. You can see what each plan includes in Settings → Plan.",
};

function fakeEntitlements(allowed: boolean): EntitlementService & {
  readonly checks: { feature: string; count: number | undefined }[];
} {
  const checks: { feature: string; count: number | undefined }[] = [];
  return {
    checks,
    summary: (account) =>
      Promise.resolve({
        accountKey: `o:${account.organisationId ?? ""}`,
        plan: {
          id: "00000000-0000-4000-8000-000000000001",
          key: "launch",
          version: 1,
          name: "Launch",
          description: "Launch plan.",
          audience: "ANY",
        },
        source: "LAUNCH_DEFAULT",
        endsAt: null,
        features: [],
      }),
    check: (_account, feature, options) => {
      checks.push({ feature, count: options?.count });
      return Promise.resolve(
        allowed
          ? { allowed: true, remaining: 1, replayed: false }
          : { allowed: false, refusal: REFUSAL },
      );
    },
    consume: () =>
      Promise.resolve({ allowed: true, remaining: null, replayed: false }),
    release: () => Promise.resolve(true),
  };
}

function fakeAccounts(): BillingAccounts {
  return {
    catalogue: () =>
      Promise.resolve({
        plans: [
          {
            key: "founder_pro",
            version: 1,
            name: "Founder Pro",
            description: "Pro.",
            audience: "FOUNDER",
            selfServe: true,
            features: [],
          },
        ],
      }),
    accountDetail: () => Promise.reject(new Error("not under test")),
    assignPlan: () => Promise.reject(new Error("not under test")),
    setOverride: () => Promise.reject(new Error("not under test")),
    customerOf: () => Promise.resolve(null),
    lookupKeyOf: (key) =>
      Promise.resolve(key === "founder_pro" ? "founder_pro_monthly" : null),
  };
}

const GATEWAY: Gateway = {
  id: "66666666-0000-4000-8000-000000000001" as Gateway["id"],
  tenantId: CONTEXT.tenantId,
  investorOrganisationId: INVESTOR,
  organisationId: CONTEXT.organisationId ?? "",
  publicId: "gq_0123456789abcdefghjkmnpqrs",
  name: "Seed programme",
  status: "ACTIVE",
  createdByUserId: CONTEXT.userId,
  createdAt: "2026-09-21T12:00:00.000Z",
  updatedAt: "2026-09-21T12:00:00.000Z",
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function build(options: {
  readonly admin: boolean;
  readonly provider?: boolean;
  readonly allowed?: boolean;
}) {
  const provider =
    options.provider === true
      ? createFakeBillingProvider({ webhookSecret: SECRET })
      : undefined;
  const applied: ProviderEvent[] = [];
  const created: string[] = [];
  const entitlements = fakeEntitlements(options.allowed ?? true);
  const gateq: GateQService = {
    createGateway: (command) => {
      created.push(command.name);
      return Promise.resolve(GATEWAY);
    },
    listGateways: () => Promise.resolve([GATEWAY]),
    getPolicy: notUnderTest,
    listVersions: () => Promise.resolve([]),
    createDraft: notUnderTest,
    replaceDraft: notUnderTest,
    publishVersion: notUnderTest,
    qualifyCompany: notUnderTest,
    publicGateway: () => Promise.resolve(null),
  };
  const { app } = createApp(
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
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
      },
      identities: { lookup: () => Promise.resolve(null) },
    },
    {
      gateq,
      billing: {
        entitlements,
        accounts: fakeAccounts(),
        provider,
        applyWebhook: (event) => {
          applied.push(event);
          return Promise.resolve("APPLIED");
        },
        canManage: () => Promise.resolve(options.admin),
        webOrigin: "https://app.example.test",
      },
    },
  );
  return { app, provider, applied, created, entitlements };
}

async function close(app: FastifyInstance) {
  await app.close();
}

describe("the plan page", () => {
  it("reads the server-resolved organisation's plan, and says who may buy", async () => {
    const { app } = build({ admin: false });
    const response = await app.inject({
      method: "GET",
      url: BILLING_PLAN_PATH,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      account: "ORGANISATION",
      plan: { key: "launch" },
      source: "LAUNCH_DEFAULT",
      canManage: false,
      checkoutAvailable: false,
    });
    await close(app);
  });
});

describe("checkout", () => {
  const post = (app: FastifyInstance, body: unknown) =>
    app.inject({
      method: "POST",
      url: BILLING_CHECKOUT_PATH,
      headers: { "idempotency-key": "checkout-key-0001" },
      payload: body as Record<string, unknown>,
    });

  it("is refused to a member who is not the organisation's admin", async () => {
    const { app, provider } = build({ admin: false, provider: true });
    const response = await post(app, { planKey: "founder_pro" });
    expect(response.statusCode).toBe(403);
    expect(provider?.checkouts).toHaveLength(0);
    await close(app);
  });

  it("says plainly that online payment is off when no provider is configured", async () => {
    const { app } = build({ admin: true });
    const response = await post(app, { planKey: "founder_pro" });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe("PROVIDER_UNAVAILABLE");
    await close(app);
  });

  it("opens hosted checkout for the actor's own organisation, never one named in the body", async () => {
    const { app, provider } = build({ admin: true, provider: true });
    const smuggled = await post(app, {
      planKey: "founder_pro",
      organisationId: "99999999-0000-4000-8000-000000000001",
    });
    expect(smuggled.statusCode).toBe(400);
    const response = await post(app, { planKey: "founder_pro" });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ url: string }>().url).toContain(
      "founder_pro_monthly",
    );
    expect(provider?.checkouts[0]).toMatchObject({
      accountKey: `o:${CONTEXT.organisationId ?? ""}`,
      lookupKey: "founder_pro_monthly",
      successUrl: "https://app.example.test/settings/plan?checkout=done",
    });
    const unknown = await post(app, { planKey: "launch" });
    expect(unknown.statusCode).toBe(404);
    await close(app);
  });
});

describe("the Stripe webhook", () => {
  const body = JSON.stringify({
    id: "evt_fixture_1",
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: "sub_1" } },
  });
  const deliver = (app: FastifyInstance, signature: string | undefined) =>
    app.inject({
      method: "POST",
      url: BILLING_STRIPE_WEBHOOK_PATH,
      headers: {
        "content-type": "application/json",
        ...(signature === undefined ? {} : { "stripe-signature": signature }),
      },
      payload: body,
    });

  it("is closed (503) until the provider is configured", async () => {
    const { app, applied } = build({ admin: false });
    const response = await deliver(
      app,
      signStripePayload(body, SECRET, new Date()),
    );
    expect(response.statusCode).toBe(503);
    expect(applied).toHaveLength(0);
    await close(app);
  });

  it("refuses an unsigned, forged or replayed delivery and applies nothing", async () => {
    const { app, applied } = build({ admin: false, provider: true });
    expect((await deliver(app, undefined)).statusCode).toBe(401);
    expect(
      (
        await deliver(
          app,
          signStripePayload(body, "whsec_forged-000000000000", new Date()),
        )
      ).statusCode,
    ).toBe(401);
    const old = signStripePayload(
      body,
      SECRET,
      new Date(Date.now() - 10 * 60_000),
    );
    expect((await deliver(app, old)).statusCode).toBe(401);
    expect(applied).toHaveLength(0);
    await close(app);
  });

  it("applies a verified delivery over the exact raw bytes", async () => {
    const { app, applied } = build({ admin: false, provider: true });
    const response = await deliver(
      app,
      signStripePayload(body, SECRET, new Date()),
    );
    expect(response.statusCode).toBe(200);
    expect(applied.map((event) => event.id)).toEqual(["evt_fixture_1"]);
    await close(app);
  });
});

describe("a gated entry point: creating a GateQ gateway", () => {
  const create = (app: FastifyInstance) =>
    app.inject({
      method: "POST",
      url: GATEQ_GATEWAYS_PATH,
      payload: { investorOrganisationId: INVESTOR, name: "Second gateway" },
    });

  it("answers ENTITLEMENT_REQUIRED with the caller's plan and does not create it", async () => {
    const { app, created, entitlements } = build({
      admin: true,
      allowed: false,
    });
    const response = await create(app);
    expect(response.statusCode).toBe(402);
    const problem = response.json<{
      code: string;
      entitlement: unknown;
      detail: string;
    }>();
    expect(problem.code).toBe("ENTITLEMENT_REQUIRED");
    expect(
      EntitlementProblemExtensionSchema.parse(problem.entitlement).upgradePath,
    ).toBe("/settings/plan");
    expect(problem.detail).toBe(REFUSAL.message);
    expect(created).toHaveLength(0);
    expect(entitlements.checks).toEqual([
      { feature: "gateq.gateways", count: 1 },
    ]);
    await close(app);
  });

  it("creates it when the plan allows", async () => {
    const { app, created } = build({ admin: true, allowed: true });
    expect((await create(app)).statusCode).toBe(201);
    expect(created).toEqual(["Second gateway"]);
    await close(app);
  });
});
