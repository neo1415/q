import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  OnboardingSessionViewSchema,
  type OnboardingSessionView,
} from "@capital-q/contracts";
import {
  OnboardingMutationConflictError,
  OnboardingRuntimeConfigurationError,
  OnboardingSessionNotFoundError,
  OnboardingSessionStateError,
  OnboardingSessionVersionConflictError,
  type OnboardingActor,
  type OnboardingService,
} from "@capital-q/onboarding";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * HTTP adaptation of the onboarding runtime over a recording double: the
 * bootstrap-friendly actor hook (authenticated person with or without an
 * organisation context), body validation, Idempotency-Key requirements,
 * safe session views, error mapping and the absence of any definition,
 * binding or suggestion-creation route. Runtime behaviour itself is proven
 * against the database in the onboarding package.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const USER_ID = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const CONTEXT: ActorContext = {
  userId: USER_ID,
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const SESSION_ID = "f0000000-0000-4000-8000-000000000001";

const VIEW: OnboardingSessionView = {
  session: {
    id: SESSION_ID,
    journeyType: "founder",
    definitionVersionId: "f0000000-0000-4000-8000-0000000000d1",
    definitionVersion: 1,
    status: "ACTIVE",
    subject: null,
    currentStepKey: "intent",
    version: 1,
    startedAt: "2026-09-04T00:00:00.000Z",
    lastActivityAt: "2026-09-04T00:00:00.000Z",
    completedAt: null,
  },
  phases: [{ phaseKey: "company", label: "Company" }],
  currentStep: {
    stepKey: "intent",
    stepType: "single_select",
    required: true,
    prompt: "Are you raising?",
    phaseKey: "company",
    presentation: {
      stepType: "single_select",
      options: [{ optionKey: "raising_now", label: "Now" }],
    },
  },
  progress: {
    currentStepKey: "intent",
    currentPhaseKey: "company",
    eligibleSteps: [
      {
        stepKey: "intent",
        phaseKey: "company",
        required: true,
        status: "IN_PROGRESS",
      },
    ],
    eligibleStepCount: 1,
    completedEligibleStepCount: 0,
    canGoBack: false,
    canSkipCurrentStep: false,
    canComplete: false,
  },
  pendingSuggestions: [],
  responses: [],
};

type Runtime = OnboardingService["runtime"];

function fakeRuntime(overrides: Partial<Runtime> = {}) {
  const calls: { readonly method: string; readonly input: unknown }[] = [];
  const record =
    <T>(method: string, result: () => Promise<T>) =>
    (input: unknown) => {
      calls.push({ method, input });
      return result();
    };
  const runtime: Runtime = {
    startSession: record("startSession", () =>
      Promise.resolve({ view: VIEW, created: true }),
    ),
    getCurrentSession: record("getCurrentSession", () => Promise.resolve(VIEW)),
    getSession: record("getSession", () => Promise.resolve(VIEW)),
    submitResponse: record("submitResponse", () =>
      Promise.resolve({
        ...VIEW,
        pathChanges: {
          becameEligibleStepKeys: ["raise"],
          becameIneligibleStepKeys: [],
        },
      }),
    ),
    skipStep: record("skipStep", () => Promise.resolve(VIEW)),
    goBack: record("goBack", () => Promise.resolve(VIEW)),
    completeSession: record("completeSession", () => Promise.resolve(VIEW)),
    resolveSuggestion: record("resolveSuggestion", () => Promise.resolve(VIEW)),
    ...overrides,
  };
  return { runtime, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly identity?: { userId: typeof USER_ID } | null;
  readonly context?: "RESOLVED" | "CONTEXT_REQUIRED" | "CONTEXT_NOT_ACCESSIBLE";
  readonly runtime: Runtime;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          options.context === "RESOLVED" || options.context === undefined
            ? { status: "RESOLVED", context: CONTEXT }
            : { status: options.context },
        ),
    },
    identities: {
      lookup: () =>
        Promise.resolve(
          options.identity === null
            ? null
            : { userId: USER_ID, displayName: "Ada" },
        ),
    },
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    onboarding: options.runtime,
  }).app;
}

const KEY = { "idempotency-key": "11111111-1111-4111-8111-111111111111" };

describe("/v1/onboarding/sessions", () => {
  it("requires authentication and an application identity", async () => {
    const anonymous = buildApp({
      principal: null,
      runtime: fakeRuntime().runtime,
    });
    expect(
      (
        await anonymous.inject({
          method: "GET",
          url: `/v1/onboarding/sessions/${SESSION_ID}`,
        })
      ).statusCode,
    ).toBe(401);
    const noPerson = buildApp({
      principal: PRINCIPAL,
      identity: null,
      runtime: fakeRuntime().runtime,
    });
    expect(
      (
        await noPerson.inject({
          method: "GET",
          url: `/v1/onboarding/sessions/${SESSION_ID}`,
        })
      ).statusCode,
    ).toBe(403);
    const refused = buildApp({
      principal: PRINCIPAL,
      context: "CONTEXT_NOT_ACCESSIBLE",
      runtime: fakeRuntime().runtime,
    });
    expect(
      (
        await refused.inject({
          method: "GET",
          url: `/v1/onboarding/sessions/${SESSION_ID}`,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("a person without any organisation context can start a bootstrap session (§60-61, §124)", async () => {
    const { runtime, calls } = fakeRuntime();
    const app = buildApp({
      principal: PRINCIPAL,
      context: "CONTEXT_REQUIRED",
      runtime,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/onboarding/sessions",
      headers: KEY,
      payload: { journeyType: "founder" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["location"]).toBe(
      `/v1/onboarding/sessions/${SESSION_ID}`,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(OnboardingSessionViewSchema.safeParse(response.json()).success).toBe(
      true,
    );
    const actor = (calls[0]?.input as { actor: OnboardingActor }).actor;
    expect(actor).toEqual({
      userId: USER_ID,
      context: null,
      principal: PRINCIPAL,
    });
    expect(calls[0]?.input).toMatchObject({
      journeyType: "founder",
      idempotencyKey: KEY["idempotency-key"],
    });
    expect((calls[0]?.input as { subject?: unknown }).subject).toBeUndefined();
  });

  it("with a resolved context the actor carries it; a resumed session answers 200", async () => {
    const { runtime, calls } = fakeRuntime({
      startSession: (input) => {
        calls.push({ method: "startSession", input });
        return Promise.resolve({ view: VIEW, created: false });
      },
    });
    const app = buildApp({ principal: PRINCIPAL, runtime });
    const response = await app.inject({
      method: "POST",
      url: "/v1/onboarding/sessions",
      headers: KEY,
      payload: {
        journeyType: "founder",
        subject: {
          type: "COMPANY",
          id: "a1111111-1111-4111-8111-111111111111",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0]?.input).toMatchObject({
      actor: { userId: USER_ID, context: CONTEXT, principal: PRINCIPAL },
      subject: {
        subjectType: "COMPANY",
        subjectId: "a1111111-1111-4111-8111-111111111111",
      },
    });
  });

  it("rejects trusted fields, malformed bodies and a missing Idempotency-Key (§123, §125)", async () => {
    const { runtime, calls } = fakeRuntime();
    const app = buildApp({ principal: PRINCIPAL, runtime });
    for (const payload of [
      {},
      { journeyType: "admin" },
      {
        journeyType: "founder",
        tenantId: "c0000000-0000-4000-8000-000000000009",
      },
      {
        journeyType: "founder",
        organisationId: "d0000000-0000-4000-8000-000000000009",
      },
      {
        journeyType: "founder",
        userId: "b0000000-0000-4000-8000-000000000009",
      },
      {
        journeyType: "founder",
        definitionVersionId: "f0000000-0000-4000-8000-0000000000d9",
      },
      { journeyType: "founder", subject: { type: "COMPANY" } },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/sessions",
        headers: KEY,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    const noKey = await app.inject({
      method: "POST",
      url: "/v1/onboarding/sessions",
      payload: { journeyType: "founder" },
    });
    expect(noKey.statusCode).toBe(422);
    expect(calls).toEqual([]);
  });

  it("submit, skip, back, complete and suggestion resolution adapt the contracts and return the safe view", async () => {
    const { runtime, calls } = fakeRuntime();
    const app = buildApp({ principal: PRINCIPAL, runtime });
    const submit = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/responses`,
      headers: KEY,
      payload: {
        stepKey: "intent",
        response: {
          value: { type: "SINGLE_SELECT", optionKey: "raising_now" },
        },
        expectedSessionVersion: 1,
      },
    });
    expect(submit.statusCode).toBe(200);
    const body = OnboardingSessionViewSchema.parse(submit.json());
    expect(body.pathChanges).toEqual({
      becameEligibleStepKeys: ["raise"],
      becameIneligibleStepKeys: [],
    });
    expect(JSON.stringify(body)).not.toMatch(/writesTo|targetKey|branching/);
    expect(calls.at(-1)?.input).toMatchObject({
      sessionId: SESSION_ID,
      stepKey: "intent",
      response: { value: { type: "SINGLE_SELECT", optionKey: "raising_now" } },
      expectedSessionVersion: 1,
      idempotencyKey: KEY["idempotency-key"],
    });

    const skip = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/steps/notes/skip`,
      headers: KEY,
      payload: { expectedSessionVersion: 2 },
    });
    expect(skip.statusCode).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "skipStep",
      input: { stepKey: "notes", expectedSessionVersion: 2 },
    });

    const back = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/back`,
      payload: { expectedSessionVersion: 3, targetStepKey: "intent" },
    });
    expect(back.statusCode).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "goBack",
      input: { targetStepKey: "intent" },
    });

    const complete = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/complete`,
      payload: { expectedSessionVersion: 4 },
    });
    expect(complete.statusCode).toBe(200);
    expect(calls.at(-1)?.method).toBe("completeSession");

    const resolve = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/suggestions/f0000000-0000-4000-8000-0000000000a1/resolve`,
      headers: KEY,
      payload: {
        resolution: "EDIT",
        response: { value: { type: "TEXT", text: "Alpha" } },
        expectedSessionVersion: 5,
      },
    });
    expect(resolve.statusCode).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "resolveSuggestion",
      input: {
        resolution: "EDIT",
        suggestionId: "f0000000-0000-4000-8000-0000000000a1",
      },
    });

    const badResolve = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/suggestions/f0000000-0000-4000-8000-0000000000a1/resolve`,
      headers: KEY,
      payload: {
        resolution: "ACCEPT",
        response: { value: { type: "TEXT", text: "Alpha" } },
        expectedSessionVersion: 5,
      },
    });
    expect(badResolve.statusCode).toBe(422);
    const badSubmit = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/responses`,
      headers: KEY,
      payload: {
        stepKey: "intent",
        response: {
          value: { type: "SINGLE_SELECT", optionKey: "x" },
          sourceModality: "SUGGESTION_ACCEPT",
        },
        expectedSessionVersion: 1,
      },
    });
    expect(badSubmit.statusCode).toBe(422);
    const badId = await app.inject({
      method: "GET",
      url: "/v1/onboarding/sessions/not-a-uuid",
    });
    expect(badId.statusCode).toBe(422);
  });

  it("maps runtime failures to stable problem codes without leaking internals (§201-202)", async () => {
    const failing = (error: Error) => () => Promise.reject(error);
    const app = buildApp({
      principal: PRINCIPAL,
      runtime: fakeRuntime({
        getSession: failing(new OnboardingSessionNotFoundError()),
        submitResponse: failing(new OnboardingSessionVersionConflictError()),
        skipStep: failing(new OnboardingSessionStateError("STEP_REQUIRED")),
        goBack: failing(new OnboardingMutationConflictError()),
        completeSession: failing(
          new OnboardingRuntimeConfigurationError(
            "WRITE_TARGET_HANDLER_MISSING",
            "step name writes to company.stage",
          ),
        ),
      }).runtime,
    });
    const notFound = await app.inject({
      method: "GET",
      url: `/v1/onboarding/sessions/${SESSION_ID}`,
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const conflict = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/responses`,
      headers: KEY,
      payload: {
        stepKey: "intent",
        response: { value: { type: "SINGLE_SELECT", optionKey: "x" } },
        expectedSessionVersion: 1,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    const required = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/steps/intent/skip`,
      headers: KEY,
      payload: { expectedSessionVersion: 1 },
    });
    expect(required.statusCode).toBe(409);
    expect(required.json()).toMatchObject({
      code: "RESOURCE_CONFLICT",
      detail: expect.stringContaining("STEP_REQUIRED") as unknown,
    });
    const idem = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/back`,
      payload: { expectedSessionVersion: 1 },
    });
    expect(idem.statusCode).toBe(409);
    expect(idem.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const misconfigured = await app.inject({
      method: "POST",
      url: `/v1/onboarding/sessions/${SESSION_ID}/complete`,
      payload: { expectedSessionVersion: 1 },
    });
    expect(misconfigured.statusCode).toBe(500);
    expect(misconfigured.json()).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(JSON.stringify(misconfigured.json())).not.toMatch(
      /company\.stage|handler/,
    );
  });

  it('GET /sessions/current returns the caller\'s latest session, 404 when none, and never reads "current" as an id', async () => {
    const { runtime, calls } = fakeRuntime();
    const app = buildApp({
      principal: PRINCIPAL,
      context: "CONTEXT_REQUIRED",
      runtime,
    });
    const found = await app.inject({
      method: "GET",
      url: "/v1/onboarding/sessions/current?journeyType=founder",
    });
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toBe("no-store");
    expect(OnboardingSessionViewSchema.parse(found.json()).session.id).toBe(
      SESSION_ID,
    );
    expect(calls).toEqual([
      {
        method: "getCurrentSession",
        input: {
          actor: { userId: USER_ID, context: null, principal: PRINCIPAL },
          journeyType: "founder",
        },
      },
    ]);
    const badJourney = await app.inject({
      method: "GET",
      url: "/v1/onboarding/sessions/current?journeyType=marketplace",
    });
    expect(badJourney.statusCode).toBe(422);

    const none = buildApp({
      principal: PRINCIPAL,
      context: "CONTEXT_REQUIRED",
      runtime: fakeRuntime({
        getCurrentSession: () => Promise.resolve(null),
      }).runtime,
    });
    const missing = await none.inject({
      method: "GET",
      url: "/v1/onboarding/sessions/current?journeyType=founder",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("exposes no definition, binding, suggestion-creation or listing route", async () => {
    const app = buildApp({
      principal: PRINCIPAL,
      runtime: fakeRuntime().runtime,
    });
    for (const [method, url] of [
      ["GET", "/v1/onboarding/definitions"],
      ["POST", "/v1/onboarding/definitions"],
      ["GET", "/v1/onboarding/sessions"],
      ["POST", `/v1/onboarding/sessions/${SESSION_ID}/bind`],
      ["POST", `/v1/onboarding/sessions/${SESSION_ID}/suggestions`],
      ["DELETE", `/v1/onboarding/sessions/${SESSION_ID}`],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});
