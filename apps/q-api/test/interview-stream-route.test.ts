import { afterEach, describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";

import { parseQApiConfig } from "@capital-q/config/q-api";
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
import { createVoiceSessionBindings } from "../src/voice/bindings.js";
import type { InterviewAgent } from "../src/voice/interview-agent.js";
import type { RealtimeVoiceProvider } from "../src/voice/provider.js";

/**
 * L9 (onboarding speed 2026-10-20): the typed interview turn, streamed.
 * Q's sentences go out as the interviewer writes them, then the settled
 * turn and the session; the journey is the session's own, read under the
 * caller's bearer, never the browser's say-so.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
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

const provider: RealtimeVoiceProvider = {
  name: "fake",
  voices: ["FEMALE", "MALE"],
  createSession: () =>
    Promise.resolve({ token: "t", providerConversationId: "c" }),
  attach: () => Promise.resolve({ close: () => Promise.resolve() }),
};

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
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
  currentStep: null,
  progress: {
    currentStepKey: "I0.investor_type",
    currentPhaseKey: "mandate",
    eligibleSteps: [],
    eligibleStepCount: 0,
    completedEligibleStepCount: 0,
    canGoBack: false,
    canSkipCurrentStep: false,
    canComplete: false,
  },
  pendingSuggestions: [],
  responses: [],
};

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

function build(fail?: Error) {
  const seen: { journeyType: string; channel: string; streamed: boolean }[] =
    [];
  const interviewAgent = {
    turn: (input: {
      journeyType: string;
      channel: string;
      onSentence?: (sentence: string) => void;
    }) => {
      seen.push({
        journeyType: input.journeyType,
        channel: input.channel,
        streamed: input.onSentence !== undefined,
      });
      if (fail !== undefined) return Promise.reject(fail);
      input.onSentence?.("Seed, noted.");
      input.onSentence?.("How much are you raising?");
      return Promise.resolve({
        reply: "Seed, noted. How much are you raising?",
        intent: "ANSWER",
        asking: null,
        recorded: ["F1.stage"],
        skipped: [],
        questionForQ: null,
        researching: null,
        navigate: null,
        handoff: null,
        degraded: false,
        view: VIEW,
      });
    },
    researchEnded: () => undefined,
  } as unknown as InterviewAgent;
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identity: {
      lookup: () => Promise.resolve({ userId: CONTEXT.userId }) as never,
    },
  };
  // The onboarding API, as the route reads the session under the bearer.
  globalThis.fetch = (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    return Promise.resolve(
      url.endsWith(`/v1/onboarding/sessions/${SESSION_ID}`)
        ? Response.json(VIEW)
        : new Response(null, { status: 404 }),
    );
  };
  const app = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    voice: {
      provider,
      bindings: createVoiceSessionBindings(),
      interviewAgent,
      apiBaseUrl: "http://api.test",
    },
  }).app;
  return { app, seen };
}

const STREAM = {
  method: "POST" as const,
  url: "/v1/q/interview/turn/stream",
  headers: {
    authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.c2ln",
  },
};

function events(body: string): { type: string; [key: string]: unknown }[] {
  return body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string });
}

describe("POST /v1/q/interview/turn/stream", () => {
  it("streams Q's sentences, then the settled turn and the session", async () => {
    const { app, seen } = build();
    const response = await app.inject({
      ...STREAM,
      payload: { onboardingSessionId: SESSION_ID, utterance: "We're at seed" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    const said = events(response.body);
    expect(said.map((e) => e.type)).toEqual(["sentence", "sentence", "done"]);
    expect(said[0]).toEqual({ type: "sentence", text: "Seed, noted." });
    expect(said[2]).toMatchObject({
      turn: { reply: "Seed, noted. How much are you raising?" },
      view: { session: { id: SESSION_ID } },
    });
    // The session's own journey, typed channel, streamed.
    expect(seen).toEqual([
      { journeyType: "investor", channel: "text", streamed: true },
    ]);
    await app.close();
  });

  it("ends with a plain failure, never a half-reply, when the turn fails", async () => {
    const { app } = build(new Error("provider down"));
    const response = await app.inject({
      ...STREAM,
      payload: { onboardingSessionId: SESSION_ID, utterance: "We're at seed" },
    });
    const said = events(response.body);
    expect(said).toEqual([
      {
        type: "error",
        code: "UNAVAILABLE",
        message: "Q couldn't answer that just now. Try again.",
      },
    ]);
    await app.close();
  });

  it("refuses an empty utterance: an opening uses the whole-turn route", async () => {
    const { app, seen } = build();
    const response = await app.inject({
      ...STREAM,
      payload: { onboardingSessionId: SESSION_ID, utterance: "   " },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(seen).toEqual([]);
    await app.close();
  });
});
