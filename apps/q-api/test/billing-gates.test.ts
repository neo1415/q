import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type {
  EntitlementDecision,
  EntitlementRefusal,
  EntitlementService,
} from "@capital-q/billing";
import {
  CorrelationIdSchema,
  EntitlementProblemExtensionSchema,
  QActionPayloadHashSchema,
  QActionProposalIdSchema,
  QActionTypeSchema,
  QApprovalIdSchema,
  QRunIdSchema,
} from "@capital-q/contracts";
import {
  defineQAction,
  type ApprovedQAction,
  type QActionExecutionContext,
  type QActionExecutionReport,
} from "@capital-q/q-actions";
import {
  ActorContextSchema,
  AuthUserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createDocumentImages } from "../src/composition/document-images.js";
import {
  createQEntitlementPort,
  meteredQAction,
} from "../src/composition/entitlements.js";
import type { RehearsalService } from "../src/composition/rehearsals.js";
import { registerRehearsalRoutes } from "../src/http/rehearsals.js";

/**
 * BILLING (ADR 0034): every q-api entry point the plan controls refuses
 * past the plan before any model or provider work, and gives a unit back
 * when the work did not happen.
 */

const ACTOR: ActorContext = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

const REFUSAL: EntitlementRefusal = {
  feature: "q.rehearsals",
  featureName: "Rehearsals",
  reason: "LIMIT_REACHED",
  planKey: "free",
  planName: "Free",
  limit: 1,
  used: 1,
  resetsAt: "2026-11-01T00:00:00.000Z",
  upgradePath: "/settings/plan",
  message:
    "Your Free plan includes 1 rehearsal a month and you've used 1. It resets on 1 November. You can see what each plan includes in Settings → Plan.",
};

function meter(allowed: boolean) {
  const calls: string[] = [];
  const decision = (): EntitlementDecision =>
    allowed
      ? { allowed: true, remaining: 0, replayed: false }
      : { allowed: false, refusal: REFUSAL };
  const service: EntitlementService = {
    summary: () => Promise.reject(new Error("not under test")),
    check: (_account, feature) => {
      calls.push(`check:${feature}`);
      return Promise.resolve(decision());
    },
    consume: (input) => {
      calls.push(`consume:${input.feature}:${input.surface}`);
      return Promise.resolve(decision());
    },
    release: (input) => {
      calls.push(`release:${input.feature}`);
      return Promise.resolve(true);
    },
  };
  return { service, calls };
}

describe("an approved errand, outreach or stand-in draws one unit when it runs", () => {
  function action(report: QActionExecutionReport<{ ok: boolean }>) {
    let ran = 0;
    const definition = defineQAction<{ id: string }, { ok: boolean }>({
      actionType: QActionTypeSchema.parse("relationship.errand.start"),
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "test",
      description: "test",
      payload: z.object({ id: z.string() }).strict(),
      result: z.object({ ok: z.boolean() }).strict(),
      targets: () => [],
      describe: () => ({ summary: "test" }),
      authorize: () => Promise.resolve({ outcome: "ALLOW" }),
      executor: {
        execute: () => {
          ran += 1;
          return Promise.resolve(report);
        },
      },
    });
    return { definition, ran: () => ran };
  }
  const approved: ApprovedQAction<unknown> = {
    actionId: QActionProposalIdSchema.parse(
      "10000000-0000-4000-8000-000000000001",
    ),
    runId: QRunIdSchema.parse("20000000-0000-4000-8000-000000000001"),
    tenantId: ACTOR.tenantId,
    organisationId: ACTOR.organisationId ?? null,
    actionType: QActionTypeSchema.parse("relationship.errand.start"),
    actionVersion: 1,
    targets: [],
    payload: { id: "x" },
    idempotencyKey: "qa_0123456789",
    payloadHash: QActionPayloadHashSchema.parse(`sha256:${"0".repeat(64)}`),
    approvalId: QApprovalIdSchema.parse("30000000-0000-4000-8000-000000000001"),
    approvedByUserId: ACTOR.userId,
  };
  const context: QActionExecutionContext = {
    approver: ACTOR,
    correlationId: CorrelationIdSchema.parse(
      "cor_40000000-0000-4000-8000-000000000001",
    ),
    attempt: 1,
  };

  it("is refused at proposal when the plan does not cover it", async () => {
    const { service } = meter(false);
    const gated = meteredQAction(
      action({ outcome: "EXECUTED", result: { ok: true } }).definition,
      "q.delegations",
      service,
    );
    expect(await gated.authorize({ id: "x" }, ACTOR)).toEqual({
      outcome: "DENY",
      code: "ENTITLEMENT_REQUIRED",
    });
  });

  it("fails plainly, without running, when the plan ran out after approval", async () => {
    const { service } = meter(false);
    const inner = action({ outcome: "EXECUTED", result: { ok: true } });
    const gated = meteredQAction(inner.definition, "q.delegations", service);
    expect(await gated.executor.execute(approved, context)).toEqual({
      outcome: "FAILED",
      failureCode: "ENTITLEMENT_REQUIRED",
      retryable: false,
    });
    expect(inner.ran()).toBe(0);
  });

  it("takes the unit as the approver and gives it back when the action definitely failed", async () => {
    const { service, calls } = meter(true);
    const gated = meteredQAction(
      action({ outcome: "FAILED", failureCode: "X", retryable: false })
        .definition,
      "q.delegations",
      service,
    );
    await gated.executor.execute(approved, context);
    expect(calls).toEqual([
      "consume:q.delegations:Q_ACTION",
      "release:q.delegations",
    ]);
  });
});

describe("POST /v1/q/rehearsals", () => {
  function app(allowed: boolean, outcome: "OK" | "Q_UNAVAILABLE" = "OK") {
    const { service, calls } = meter(allowed);
    let starts = 0;
    const notUnderTest = () => Promise.reject(new Error("not under test"));
    const rehearsals: RehearsalService = {
      partners: notUnderTest,
      persona: notUnderTest,
      meeting: notUnderTest,
      start: () => {
        starts += 1;
        return Promise.resolve(
          outcome === "OK"
            ? ({ kind: "FINISHED" } as const)
            : { kind: "Q_UNAVAILABLE" as const },
        );
      },
      get: notUnderTest,
      list: notUnderTest,
      say: notUnderTest,
      screen: notUnderTest,
      finish: notUnderTest,
      opening: notUnderTest,
    };
    const server = Fastify();
    registerRehearsalRoutes(server, {
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
          Promise.resolve({ status: "RESOLVED", context: ACTOR }),
      },
      rehearsals,
      entitlements: service,
    });
    return { server, calls, starts: () => starts };
  }
  const body = {
    investorOrganisationId: "11111111-0000-4000-8000-000000000013",
  };

  it("answers ENTITLEMENT_REQUIRED before any model work when the month's rehearsals are used", async () => {
    const { server, starts } = app(false);
    const response = await server.inject({
      method: "POST",
      url: "/v1/q/rehearsals",
      payload: body,
    });
    expect(response.statusCode).toBe(402);
    const problem = response.json<{ code: string; entitlement: unknown }>();
    expect(problem.code).toBe("ENTITLEMENT_REQUIRED");
    expect(
      EntitlementProblemExtensionSchema.parse(problem.entitlement).feature,
    ).toBe("q.rehearsals");
    expect(starts()).toBe(0);
    await server.close();
  });

  it("gives the unit back when the rehearsal does not start", async () => {
    const { server, calls, starts } = app(true, "Q_UNAVAILABLE");
    const response = await server.inject({
      method: "POST",
      url: "/v1/q/rehearsals",
      payload: body,
    });
    expect(response.statusCode).toBe(503);
    expect(starts()).toBe(1);
    expect(calls).toEqual([
      "consume:q.rehearsals:Q_API",
      "release:q.rehearsals",
    ]);
    await server.close();
  });
});

describe("AI images in documents", () => {
  it("makes no picture (and calls no provider) when the plan's images are used", async () => {
    const { service } = meter(false);
    let generated = 0;
    const sql = Object.assign(() => Promise.resolve([{ n: 0 }]), {
      json: (v: unknown) => v,
    }) as never;
    const images = createDocumentImages({
      sql,
      gateway: {
        enabled: true,
        generate: () => {
          generated += 1;
          return Promise.resolve({ status: "FAILED" as const });
        },
      },
      store: {
        put: () => Promise.resolve(true),
        get: () => Promise.resolve(null),
        sign: () => Promise.resolve(null),
      },
      budgets: {
        perDocument: 5,
        perOrganisationPerDay: 50,
        platformPerDay: 500,
      },
      meter: createQEntitlementPort(service, "Q_API"),
    });
    const port = images.illustrationsFor({
      actor: ACTOR,
      runId: "90000000-0000-4000-8000-000000000001",
    });
    expect(
      await port?.illustrate({
        prompt: "A harbour at dawn",
        purpose: "COVER",
        alt: "Harbour",
      }),
    ).toBeNull();
    expect(generated).toBe(0);
  });

  it("gives the unit back when the provider makes no picture", async () => {
    const { service, calls } = meter(true);
    const sql = Object.assign(() => Promise.resolve([{ n: 0 }]), {
      json: (v: unknown) => v,
    }) as never;
    const images = createDocumentImages({
      sql,
      gateway: {
        enabled: true,
        generate: () => Promise.resolve({ status: "FAILED" as const }),
      },
      store: {
        put: () => Promise.resolve(true),
        get: () => Promise.resolve(null),
        sign: () => Promise.resolve(null),
      },
      budgets: {
        perDocument: 5,
        perOrganisationPerDay: 50,
        platformPerDay: 500,
      },
      meter: createQEntitlementPort(service, "Q_API"),
    });
    const port = images.illustrationsFor({
      actor: ACTOR,
      runId: "90000000-0000-4000-8000-000000000001",
    });
    expect(
      await port?.illustrate({
        prompt: "A harbour at dawn",
        purpose: "COVER",
        alt: "Harbour",
      }),
    ).toBeNull();
    expect(calls).toEqual([
      "consume:documents.ai_images:Q_API",
      "release:documents.ai_images",
    ]);
  });
});
