import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseQApiConfig } from "@capital-q/config/q-api";
import { QApprovalViewSchema, type QApprovalView } from "@capital-q/contracts";
import {
  QActionPayloadMismatchError,
  QApprovalAlreadyDecidedError,
  QApprovalExpiredError,
  QApprovalNotFoundError,
  QApprovalNotPermittedError,
  type DecideQApprovalResult,
  type QActionService,
} from "@capital-q/q-actions";
import type { QOrchestrator, QResumeInput } from "@capital-q/q-runtime";
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
 * `/v1/q/approvals` at the HTTP boundary (CQ-Q-008 §126). The Approval
 * Engine is a recording double: what a decision does to the database is
 * proven in the q-actions package. What is proven here is that the client
 * can say nothing but "this approval, approve" or "this approval, reject
 * (reason)", that the actor is the verified session and never the body,
 * that a recorded approval resumes the run exactly once, and that every
 * refusal is a plain sentence carrying nothing internal.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const MEMBERSHIP = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);
const CONTEXT: ActorContext = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MEMBERSHIP,
  actorType: "HUMAN",
};

const RUN_ID = "f0000000-0000-4000-8000-000000000001";
const ACTION_ID = "f0000000-0000-4000-8000-000000000002";
const APPROVAL_ID = "f0000000-0000-4000-8000-000000000003";
const COMPANY_ID = "f0000000-0000-4000-8000-000000000004";
const NOW = "2026-09-06T09:00:00.000Z";
const LATER = "2026-09-07T09:00:00.000Z";
const HASH_MARKER = "APPROVAL-INTERNAL-HASH-DO-NOT-EXPOSE";
const INTERNAL_MARKER = "APPROVAL-INTERNAL-ERROR-DO-NOT-LEAK";

const VIEW: QApprovalView = QApprovalViewSchema.parse({
  contractVersion: 1,
  approvalId: APPROVAL_ID,
  runId: RUN_ID,
  status: "PENDING",
  requestedAt: NOW,
  expiresAt: LATER,
  canDecide: true,
  action: {
    actionId: ACTION_ID,
    actionType: "test.confirm_required",
    actionVersion: 1,
    actionClass: "CONFIRM_REQUIRED",
    actionStatus: "AWAITING_APPROVAL",
    targets: [{ kind: "COMPANY", companyId: COMPANY_ID }],
    summary: "Q wants to record a test note about this company.",
    preview: "Please record this.",
  },
});

function decided(
  status: "APPROVED" | "REJECTED",
  wasDecided: boolean,
): DecideQApprovalResult {
  return {
    view: {
      ...VIEW,
      status,
      decidedAt: NOW,
      canDecide: false,
      action: { ...VIEW.action, actionStatus: status },
    },
    decided: wasDecided,
    // The records are internal to the engine; the route reads only the
    // run id from the action and the view from the result.
    action: { id: ACTION_ID, runId: RUN_ID } as never,
    approval: { id: APPROVAL_ID } as never,
  };
}

type Calls = {
  readonly getApproval: unknown[];
  readonly approve: unknown[];
  readonly reject: unknown[];
  readonly resume: QResumeInput[];
};

function fakeEngine(overrides: Partial<QActionService> = {}) {
  const calls: Calls = { getApproval: [], approve: [], reject: [], resume: [] };
  const service: QActionService = {
    propose: () => Promise.reject(new Error("not used")),
    getApproval: (query) => {
      calls.getApproval.push(query);
      return Promise.resolve(VIEW);
    },
    approve: (command) => {
      calls.approve.push(command);
      return Promise.resolve(decided("APPROVED", true));
    },
    reject: (command) => {
      calls.reject.push(command);
      return Promise.resolve(decided("REJECTED", true));
    },
    executeApproved: () => Promise.reject(new Error("not used")),
    findApprovalForAction: () => Promise.resolve(null),
    ...overrides,
  };
  const orchestrator: QOrchestrator = {
    start: () => Promise.reject(new Error("not used")),
    resume: (input) => {
      calls.resume.push(input);
      return Promise.resolve({
        runId: input.runId,
        status: "COMPLETED",
      } as never);
    },
    cancel: () => Promise.reject(new Error("not used")),
  };
  return { service, orchestrator, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly context?: ActorContext | undefined;
  readonly service: QActionService;
  readonly orchestrator?: QOrchestrator | undefined;
}): FastifyInstance {
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          options.context === undefined
            ? { status: "CONTEXT_REQUIRED" }
            : { status: "RESOLVED", context: options.context },
        ),
    },
  };
  return createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    qActions: options.service,
    ...(options.orchestrator === undefined
      ? {}
      : {
          orchestration: {
            orchestrator: options.orchestrator,
            autostart: false,
          },
        }),
  }).app;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("GET /v1/q/approvals/:approvalId", () => {
  it("refuses an unauthenticated caller before touching the engine", async () => {
    const { service, calls } = fakeEngine();
    const app = buildApp({ principal: null, service });
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/approvals/${APPROVAL_ID}`,
    });
    expect(response.statusCode).toBe(401);
    expect(calls.getApproval).toHaveLength(0);
    await app.close();
  });

  it("requires a resolved organisation context", async () => {
    const { service, calls } = fakeEngine();
    const app = buildApp({ principal: PRINCIPAL, service });
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/approvals/${APPROVAL_ID}`,
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(calls.getApproval).toHaveLength(0);
    await app.close();
  });

  it("returns the public view for the resolved actor, without cache", async () => {
    const { service, calls } = fakeEngine();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/approvals/${APPROVAL_ID}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(VIEW);
    expect(response.body).not.toContain("sha256:");
    expect(response.body).not.toContain("payloadHash");
    const query = calls.getApproval[0] as { actor: ActorContext };
    expect(query.actor).toEqual(CONTEXT);
    await app.close();
  });

  it("rejects an identifier that is not an approval id", async () => {
    const { service, calls } = fakeEngine();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/approvals/not-an-id",
    });
    expect(response.statusCode).toBe(422);
    expect(calls.getApproval).toHaveLength(0);
    await app.close();
  });

  it("answers not found with one sentence, for a foreign or missing approval alike", async () => {
    const { service } = fakeEngine({
      getApproval: () => Promise.reject(new QApprovalNotFoundError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/approvals/${APPROVAL_ID}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string; detail: string }>()).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      detail: "We couldn't find that approval.",
    });
    await app.close();
  });
});

describe("POST /v1/q/approvals/:approvalId/approve", () => {
  it("records the decision for the session's actor and resumes the run once, after responding", async () => {
    const { service, orchestrator, calls } = fakeEngine();
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service,
      orchestrator,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/approve`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json<QApprovalView>()).toMatchObject({
      approvalId: APPROVAL_ID,
      status: "APPROVED",
      canDecide: false,
    });
    const command = calls.approve[0] as {
      actor: ActorContext;
      approvalId: string;
    };
    expect(command.actor).toEqual(CONTEXT);
    expect(command.approvalId).toBe(APPROVAL_ID);
    await settle();
    expect(calls.resume).toHaveLength(1);
    expect(calls.resume[0]).toMatchObject({ actor: CONTEXT, runId: RUN_ID });
    await app.close();
  });

  it("accepts a missing body as the empty decision", async () => {
    const { service, calls } = fakeEngine();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/approve`,
    });
    expect(response.statusCode).toBe(200);
    expect(calls.approve).toHaveLength(1);
    await app.close();
  });

  it.each([
    ["a payload", { payload: { note: "changed" } }],
    ["a hash", { payloadHash: `sha256:${"a".repeat(64)}` }],
    ["an expected hash", { expectedPayloadHash: `sha256:${"a".repeat(64)}` }],
    ["an approver", { approvedByUserId: USER }],
    ["a tenant", { tenantId: TENANT }],
    ["a role", { role: "organisation_admin" }],
    ["an approval flag", { approved: true }],
    ["a bypass", { skipReauthorization: true }],
    ["an executor choice", { executor: "gmail" }],
  ])("refuses an approve body that carries %s", async (_label, body) => {
    const { service, orchestrator, calls } = fakeEngine();
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service,
      orchestrator,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/approve`,
      payload: body,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe("VALIDATION_FAILED");
    expect(calls.approve).toHaveLength(0);
    await settle();
    expect(calls.resume).toHaveLength(0);
    await app.close();
  });

  it("does not resume again for a retried approve the engine reports as already decided", async () => {
    const { service, orchestrator, calls } = fakeEngine({
      approve: () => Promise.resolve(decided("APPROVED", false)),
    });
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service,
      orchestrator,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/approve`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<QApprovalView>().status).toBe("APPROVED");
    await settle();
    expect(calls.resume).toHaveLength(0);
    await app.close();
  });

  it("refuses an unauthenticated caller and never resumes", async () => {
    const { service, orchestrator, calls } = fakeEngine();
    const app = buildApp({ principal: null, service, orchestrator });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/approve`,
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(calls.approve).toHaveLength(0);
    await settle();
    expect(calls.resume).toHaveLength(0);
    await app.close();
  });

  it.each([
    [new QApprovalNotFoundError(), 404, "RESOURCE_NOT_FOUND"],
    [new QApprovalNotPermittedError(), 403, "PERMISSION_DENIED"],
    [new QApprovalExpiredError(), 410, "Q_ACTION_EXPIRED"],
    [new QApprovalAlreadyDecidedError("REJECTED"), 409, "RESOURCE_CONFLICT"],
    [new QActionPayloadMismatchError(), 409, "RESOURCE_CONFLICT"],
  ])(
    "maps %s to a plain-English problem without resuming",
    async (error, status, code) => {
      const { service, orchestrator, calls } = fakeEngine({
        approve: () => Promise.reject(error),
      });
      const app = buildApp({
        principal: PRINCIPAL,
        context: CONTEXT,
        service,
        orchestrator,
      });
      const response = await app.inject({
        method: "POST",
        url: `/v1/q/approvals/${APPROVAL_ID}/approve`,
        payload: {},
      });
      expect(response.statusCode).toBe(status);
      const problem = response.json<{ code: string; detail: string }>();
      expect(problem.code).toBe(code);
      expect(problem.detail).toBe(error.message);
      expect(response.body).not.toContain("sha256:");
      expect(response.body).not.toContain("tenant");
      expect(response.body).not.toMatch(/REJECTED|hash|payload/i);
      await settle();
      expect(calls.resume).toHaveLength(0);
      await app.close();
    },
  );

  it("hides an internal engine failure behind a generic problem", async () => {
    const { service, orchestrator, calls } = fakeEngine({
      approve: () =>
        Promise.reject(new Error(`boom ${HASH_MARKER} ${INTERNAL_MARKER}`)),
    });
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service,
      orchestrator,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/approve`,
      payload: {},
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(HASH_MARKER);
    expect(response.body).not.toContain(INTERNAL_MARKER);
    expect(response.body).not.toContain("boom");
    await settle();
    expect(calls.resume).toHaveLength(0);
    await app.close();
  });

  it("answers the decision even when the resume fails afterwards", async () => {
    const { service, calls } = fakeEngine();
    const orchestrator: QOrchestrator = {
      start: () => Promise.reject(new Error("not used")),
      resume: () => Promise.reject(new Error(`resume ${INTERNAL_MARKER}`)),
      cancel: () => Promise.reject(new Error("not used")),
    };
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service,
      orchestrator,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/approve`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(INTERNAL_MARKER);
    expect(calls.approve).toHaveLength(1);
    await settle();
    await app.close();
  });
});

describe("POST /v1/q/approvals/:approvalId/reject", () => {
  it("records a rejection with an optional bounded reason and never resumes", async () => {
    const { service, orchestrator, calls } = fakeEngine();
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service,
      orchestrator,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/reject`,
      payload: { reason: "Not now." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<QApprovalView>().status).toBe("REJECTED");
    const command = calls.reject[0] as { actor: ActorContext; reason?: string };
    expect(command.actor).toEqual(CONTEXT);
    expect(command.reason).toBe("Not now.");
    await settle();
    expect(calls.resume).toHaveLength(0);
    await app.close();
  });

  it("accepts an empty rejection", async () => {
    const { service, calls } = fakeEngine();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/reject`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(calls.reject).toHaveLength(1);
    await app.close();
  });

  it.each([
    ["an overlong reason", { reason: "x".repeat(501) }],
    ["a payload", { payload: { note: "x" } }],
    ["an approval flag", { approved: false, force: true }],
    ["an approver", { rejectedByUserId: USER }],
  ])("refuses a reject body that carries %s", async (_label, body) => {
    const { service, calls } = fakeEngine();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/reject`,
      payload: body,
    });
    expect(response.statusCode).toBe(422);
    expect(calls.reject).toHaveLength(0);
    await app.close();
  });

  it("reports an already decided approval as a conflict", async () => {
    const { service } = fakeEngine({
      reject: () =>
        Promise.reject(new QApprovalAlreadyDecidedError("APPROVED")),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `/v1/q/approvals/${APPROVAL_ID}/reject`,
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("RESOURCE_CONFLICT");
    expect(response.body).not.toContain("APPROVED");
    await app.close();
  });
});
