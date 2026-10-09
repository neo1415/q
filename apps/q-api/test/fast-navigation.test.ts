import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  Q_FAST_NAVIGATION_PATH,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type {
  ContextFirewallPort,
  QToolCallOutcome,
  QToolPort,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createFastNavigation,
  type FastNavigationResolver,
} from "../src/composition/fast-navigation.js";
import { registerFastNavigationRoutes } from "../src/http/fast-navigation.js";
import { registerProblemHandling } from "../src/http/problem-handler.js";

/**
 * RECOVERY-2026-10 (C, founder 2026-10-09: "stupid fast"): the code-only
 * navigation reader. A page by name needs no plan and no tool; a record by
 * name goes through the firewall's plan and open_page's own authorize step,
 * and nothing the firewall or open_page refuses ever moves the screen.
 */

const ACTOR: ActorContext = {
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
const SHIFTWELL = "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70";
const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

function planFor(runId: string): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId: ACTOR.tenantId,
    actor: { userId: ACTOR.userId, organisationId: ACTOR.organisationId },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

function outcome(data: unknown, ok: boolean): QToolCallOutcome {
  return {
    callId: "c",
    toolName: null,
    toolVersion: null,
    classification: null,
    status: ok ? "SUCCEEDED" : "DENIED",
    failureCode: ok ? null : "NOT_AVAILABLE",
    sensitivity: null,
    result: ok
      ? { ok: true, data }
      : {
          ok: false,
          error: { code: "NOT_AVAILABLE", safeMessage: "Not available." },
        },
    latencyMs: 1,
  };
}

function reader(options: { denied?: boolean; names?: readonly string[] }) {
  const calls = { plans: 0, opens: [] as unknown[] };
  const firewall: ContextFirewallPort = {
    plan: (request) => {
      calls.plans += 1;
      return Promise.resolve(
        options.denied === true
          ? { outcome: "DENIED", reason: "NOT_AUTHORISED", denied: [] }
          : { outcome: "AUTHORISED", plan: planFor(request.runId) },
      );
    },
  };
  const tools: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: (proposal) => {
      calls.opens.push(proposal.arguments);
      const { page, name } = proposal.arguments as {
        page: string;
        name: string;
      };
      return Promise.resolve(
        name === "Shiftwell"
          ? outcome(
              {
                status: "SCREEN_WILL_DO_IT",
                clientAction: { kind: "OPEN_RECORD_PAGE", page, id: SHIFTWELL },
              },
              true,
            )
          : outcome(null, false),
      );
    },
  };
  const resolve = createFastNavigation({
    firewall,
    tools,
    ownRelationships: () =>
      Promise.resolve({
        items: (options.names ?? ["Shiftwell"]).map((name) => ({
          counterpart: { name },
        })),
      }),
  });
  return { resolve, calls };
}

describe("fast navigation reader (RECOVERY C, stupid fast)", () => {
  it("moves on a page by name with no plan and no tool", async () => {
    const { resolve, calls } = reader({});
    const decided = await resolve(ACTOR, "open discover");
    expect(decided).toMatchObject({
      kind: "NAVIGATE",
      intent: { kind: "NAVIGATE", destination: "DISCOVER" },
    });
    expect(calls).toEqual({ plans: 0, opens: [] });
  });

  it("opens their own record by name through open_page", async () => {
    const { resolve, calls } = reader({});
    const decided = await resolve(ACTOR, "Take me to Shiftwell relationship");
    expect(decided).toMatchObject({
      kind: "NAVIGATE",
      intent: { kind: "OPEN_RECORD_PAGE", id: SHIFTWELL },
    });
    expect(calls.plans).toBe(1);
    expect(calls.opens.length).toBeGreaterThan(0);
  });

  it("never moves when the firewall refuses the plan", async () => {
    const { resolve, calls } = reader({ denied: true });
    const decided = await resolve(ACTOR, "Take me to Shiftwell relationship");
    expect(decided.kind).toBe("LEAVE_TO_Q");
    expect(calls.opens).toEqual([]);
  });

  it("never moves when open_page refuses, and leaves ambiguity to Q", async () => {
    const unknown = reader({ names: ["Shiftwell"] });
    expect(
      (await unknown.resolve(ACTOR, "Take me to Nowhereco relationship")).kind,
    ).toBe("LEAVE_TO_Q");
    const several = reader({ names: ["Shiftwell Labs", "Shiftwell Health"] });
    expect((await several.resolve(ACTOR, "Open Shiftwell")).kind).toBe(
      "LEAVE_TO_Q",
    );
    expect(several.calls.opens).toEqual([]);
  });

  it("answers in well under the page-name budget", async () => {
    const { resolve } = reader({});
    const started = performance.now();
    await resolve(ACTOR, "open relationships");
    expect(performance.now() - started).toBeLessThan(150);
  });
});

async function server(resolve: FastNavigationResolver) {
  const app = Fastify();
  registerProblemHandling(app, createLogger({ level: "silent" }));
  registerFastNavigationRoutes(app, {
    authenticator: {
      authenticate: (request) =>
        Promise.resolve(
          request.headers.authorization === `Bearer ${BEARER}`
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
        Promise.resolve({ status: "RESOLVED" as const, context: ACTOR }),
    },
    resolve,
  });
  await app.ready();
  return app;
}

describe(`POST ${Q_FAST_NAVIGATION_PATH}`, () => {
  it("resolves as the person the server resolved", async () => {
    const seen: ActorContext[] = [];
    const app = await server((actor, text) => {
      seen.push(actor);
      return reader({}).resolve(actor, text);
    });
    const response = await app.inject({
      method: "POST",
      url: Q_FAST_NAVIGATION_PATH,
      headers: { authorization: `Bearer ${BEARER}` },
      payload: { text: "open discover", final: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ kind: "NAVIGATE" });
    expect(seen).toEqual([ACTOR]);
    await app.close();
  });

  it("refuses without a session and refuses a body off the contract", async () => {
    const app = await server(() => Promise.reject(new Error("not reached")));
    const anonymous = await app.inject({
      method: "POST",
      url: Q_FAST_NAVIGATION_PATH,
      payload: { text: "open discover", final: true },
    });
    expect(anonymous.statusCode).toBe(401);
    const invalid = await app.inject({
      method: "POST",
      url: Q_FAST_NAVIGATION_PATH,
      headers: { authorization: `Bearer ${BEARER}` },
      payload: { text: "x".repeat(301), final: true },
    });
    expect(invalid.statusCode).toBe(422);
    await app.close();
  });
});
