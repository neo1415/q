import { afterEach, describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import type {
  OnboardingSessionView,
  SayOnboardingResponse,
} from "@capital-q/contracts";
import type { OnboardingService } from "@capital-q/onboarding";
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
 * `/say` is the one Q interview, over HTTP (QX-004 core gate: one Q).
 *
 * Capital Q had grown two conversational implementations: the interviewer
 * in q-api, which the spoken thread used, and a template engine reached
 * through this route, which is what a typed demo actually met. The typed
 * one read a step's raw label back as a question -- "Your firm" -- to a
 * person who had typed their firm at registration two screens earlier.
 *
 * What these prove is that the split is gone and cannot quietly come back:
 * the turn goes to the interviewer under the caller's own bearer, Q's
 * words come back untouched, and a build with no interviewer closes the
 * route rather than answering from the engine it replaced.
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
const BEARER = "the-callers-own-token";

const VIEW: OnboardingSessionView = {
  session: {
    id: SESSION_ID,
    journeyType: "investor",
    definitionVersionId: "f0000000-0000-4000-8000-0000000000d1",
    definitionVersion: 1,
    status: "ACTIVE",
    subject: null,
    currentStepKey: "I0.investor_type",
    version: 3,
    startedAt: "2026-09-22T09:00:00.000Z",
    lastActivityAt: "2026-09-22T09:00:00.000Z",
    completedAt: null,
  },
  phases: [{ phaseKey: "mandate", label: "Mandate" }],
  currentStep: {
    stepKey: "I0.investor_type",
    stepType: "single_select",
    required: true,
    prompt: "How do you invest?",
    phaseKey: "mandate",
    presentation: {
      stepType: "single_select",
      options: [{ optionKey: "angel", label: "Angel investor" }],
    },
  },
  progress: {
    currentStepKey: "I0.investor_type",
    currentPhaseKey: "mandate",
    eligibleSteps: [
      {
        stepKey: "I0.investor_type",
        phaseKey: "mandate",
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

function fakeRuntime(): {
  readonly runtime: Runtime;
  readonly sayCalls: { count: number };
} {
  const sayCalls = { count: 0 };
  const unused = () => Promise.reject(new Error("not used in these tests"));
  const runtime = {
    startSession: unused,
    getSession: () => Promise.resolve(VIEW),
    getCurrentSession: () => Promise.resolve(VIEW),
    submitResponse: unused,
    skipStep: unused,
    goBack: unused,
    completeSession: unused,
    resolveSuggestion: unused,
    answerInterviewQuestion: unused,
    dismissInterviewQuestion: unused,
    say: () => {
      sayCalls.count += 1;
      return Promise.reject(
        new Error("the template conversation must never be reached"),
      );
    },
  } as unknown as Runtime;
  return { runtime, sayCalls };
}

function buildApp(options: {
  readonly runtime: Runtime;
  readonly qApiUrl?: string | undefined;
}) {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT } as const),
    },
    identities: {
      lookup: () => Promise.resolve({ userId: USER_ID, displayName: "Ada" }),
    },
  };
  return createApp(
    parseApiConfig({
      NODE_ENV: "test",
      ...(options.qApiUrl === undefined
        ? {}
        : { CQ_Q_API_URL: options.qApiUrl }),
    }),
    security,
    { onboarding: options.runtime },
  ).app;
}

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

const SAY = {
  method: "POST" as const,
  url: `/v1/onboarding/sessions/${SESSION_ID}/say`,
  headers: {
    "idempotency-key": "11111111-1111-4111-8111-111111111111",
    authorization: `Bearer ${BEARER}`,
  },
};

describe("POST /v1/onboarding/sessions/:id/say", () => {
  it("carries the turn to the one interviewer under the caller's own bearer, and returns Q's words untouched", async () => {
    const seen: {
      url: string;
      auth: string | null;
      body: Record<string, unknown>;
    }[] = [];
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof URL
          ? input.href
          : typeof input === "string"
            ? input
            : input.url;
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        auth: headers.get("authorization"),
        body: JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as Record<string, unknown>,
      });
      return Promise.resolve(
        Response.json({
          reply:
            "Angel investor, got it. And for your firm, do you operate through Zino Aviation, or another one?",
          intent: "ANSWER",
          asking: null,
          recorded: ["I0.investor_type"],
          skipped: [],
          questionForQ: null,
          researching: null,
          navigate: null,
          handoff: null,
          degraded: false,
        }),
      );
    };

    const { runtime, sayCalls } = fakeRuntime();
    const app = buildApp({ runtime, qApiUrl: "http://q.test" });
    const response = await app.inject({
      ...SAY,
      payload: {
        text: "I'm an angel investor.",
        expectedSessionVersion: 3,
        recentTurns: [{ role: "q", text: "How do you invest?" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SayOnboardingResponse>();
    // Q's sentence, as Q wrote it. Nothing here composes prose.
    expect(body.reply).toContain("Zino Aviation");
    expect(body.understood).toBeNull();
    expect(body.degraded).toBe(false);
    // What was recorded is read back from the session, not from the prose.
    expect(body.view.session.id).toBe(SESSION_ID);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://q.test/v1/q/interview/turn");
    // The person's own authority, exactly: no service credential.
    expect(seen[0]?.auth).toBe(`Bearer ${BEARER}`);
    expect(seen[0]?.body).toMatchObject({
      onboardingSessionId: SESSION_ID,
      journeyType: "investor",
      utterance: "I'm an angel investor.",
      channel: "text",
      recentTurns: [{ role: "q", text: "How do you invest?" }],
    });
    expect(sayCalls.count).toBe(0);
  });

  it("closes rather than falling back to the template conversation when no interviewer is composed", async () => {
    const { runtime, sayCalls } = fakeRuntime();
    const app = buildApp({ runtime, qApiUrl: undefined });
    const response = await app.inject({
      ...SAY,
      payload: { text: "I'm an angel investor.", expectedSessionVersion: 3 },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(sayCalls.count).toBe(0);
  });

  it("closes rather than falling back when the interviewer is unreachable", async () => {
    globalThis.fetch = () => Promise.reject(new Error("connect ECONNREFUSED"));
    const { runtime, sayCalls } = fakeRuntime();
    const app = buildApp({ runtime, qApiUrl: "http://q.test" });
    const response = await app.inject({
      ...SAY,
      payload: { text: "I'm an angel investor.", expectedSessionVersion: 3 },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    // No host, status or provider detail reaches the caller.
    expect(JSON.stringify(response.json())).not.toContain("q.test");
    expect(sayCalls.count).toBe(0);
  });

  it("refuses a stale session version before anything is said to Q", async () => {
    let called = 0;
    globalThis.fetch = () => {
      called += 1;
      return Promise.resolve(Response.json({}));
    };
    const { runtime } = fakeRuntime();
    const app = buildApp({ runtime, qApiUrl: "http://q.test" });
    const response = await app.inject({
      ...SAY,
      payload: { text: "I'm an angel investor.", expectedSessionVersion: 2 },
    });
    expect(response.statusCode).toBe(409);
    expect(called).toBe(0);
  });

  it("still requires an Idempotency-Key", async () => {
    const { runtime } = fakeRuntime();
    const app = buildApp({ runtime, qApiUrl: "http://q.test" });
    const response = await app.inject({
      method: "POST",
      url: SAY.url,
      headers: { authorization: `Bearer ${BEARER}` },
      payload: { text: "I'm an angel investor.", expectedSessionVersion: 3 },
    });
    // 422: the header is missing, not malformed input in the body.
    expect(response.statusCode).toBe(422);
  });
});
