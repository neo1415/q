import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { PermittedContextPlan } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  allow,
  createQToolExecutor,
  createQToolRegistry,
  defineQTool,
} from "@capital-q/q-tools";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { Q_MCP_PATH } from "../src/http/q-mcp.js";

/**
 * Q as an MCP server, over real HTTP: an authenticated host lists exactly
 * the tools the firewall's plan admits and calls one through the
 * pipeline; nobody else gets past the door.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";

const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const PRINCIPAL = {
  authUserId: "a0000000-0000-4000-8000-000000000001",
  email: "person@example.com",
} as unknown as AuthenticatedPrincipal;

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function planWith(kinds: readonly string[]): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: "context-firewall-v2",
    planId: "66666666-6666-4666-8666-666666666666",
    fingerprint: "a".repeat(64),
    runId: "44444444-4444-4444-8444-444444444444",
    tenantId: TENANT,
    actor: { userId: USER, organisationId: ORG },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: kinds.map((kind) => ({ kind, sensitivity: "PUBLIC" })),
    denied: [],
    maxSensitivity: "CONFIDENTIAL",
    allowedLayers: ["STRUCTURED_STATE"],
    combinationConstraints: [],
    evaluatedAt: "2026-09-17T10:00:00.000Z",
    revalidateAfter: "2026-09-17T10:05:00.000Z",
    revalidateOnResume: true,
  } as unknown as PermittedContextPlan;
}

const registry = createQToolRegistry([
  defineQTool<{ companyId: string }, { name: string }, null>({
    id: "test.lookup",
    version: 1,
    status: "ACTIVE",
    providerName: "lookup_company",
    description: "Returns a test company's name.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: ["GENERAL_QUESTION"],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "test",
    visibleStage: null,
    input: z.object({ companyId: z.string() }).strict(),
    output: z.object({ name: z.string() }).strict(),
    authorize: () => Promise.resolve(allow("PUBLIC", null)),
    execute: (input) => Promise.resolve({ name: `Company ${input.companyId}` }),
  }),
]);

const running: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

async function serve(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly decision: Awaited<ReturnType<ContextFirewallPort["plan"]>>;
}) {
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    mcp: {
      firewall: { plan: () => Promise.resolve(options.decision) },
      registry,
      tools: createQToolExecutor({ registry }),
      logger,
    },
  });
  running.push(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no port");
  }
  return `http://127.0.0.1:${String(address.port)}${Q_MCP_PATH}`;
}

async function rpc(url: string, method: string, params: unknown = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer test",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

describe("POST /v1/mcp", () => {
  it("refuses an unauthenticated host", async () => {
    const url = await serve({
      principal: null,
      decision: {
        outcome: "AUTHORISED",
        plan: planWith(["NETWORK_VISIBLE_DATA"]),
      },
    });
    const { status } = await rpc(url, "tools/list");
    expect(status).toBe(401);
  });

  it("answers 403 when the firewall admits no context", async () => {
    const url = await serve({
      principal: PRINCIPAL,
      decision: {
        outcome: "DENIED",
        reason: "NO_AUTHORISED_CONTEXT",
        denied: [],
      } as unknown as Awaited<ReturnType<ContextFirewallPort["plan"]>>,
    });
    const { status } = await rpc(url, "tools/list");
    expect(status).toBe(403);
  });

  it("lists the plan's tools and executes one through the pipeline", async () => {
    const url = await serve({
      principal: PRINCIPAL,
      decision: {
        outcome: "AUTHORISED",
        plan: planWith(["NETWORK_VISIBLE_DATA"]),
      },
    });
    const listed = await rpc(url, "tools/list");
    expect(listed.status).toBe(200);
    const tools = (listed.body as { result: { tools: { name: string }[] } })
      .result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(["lookup_company"]);

    const called = await rpc(url, "tools/call", {
      name: "lookup_company",
      arguments: { companyId: "c-9" },
    });
    expect(called.status).toBe(200);
    const result = (called.body as { result: { structuredContent: unknown } })
      .result;
    expect(result.structuredContent).toEqual({ name: "Company c-9" });
  });

  it("offers nothing to a plan the registry admits nothing to", async () => {
    const url = await serve({
      principal: PRINCIPAL,
      decision: { outcome: "AUTHORISED", plan: planWith(["COMPANY_PROFILE"]) },
    });
    const listed = await rpc(url, "tools/list");
    expect(
      (listed.body as { result: { tools: unknown[] } }).result.tools,
    ).toEqual([]);
  });
});
