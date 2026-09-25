import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  OnboardingSessionNotFoundError,
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
 * CQ-QX-006: the interview thread over HTTP. The route never names an
 * owner: the actor comes from the server-side hook and the runtime checks
 * the session is theirs. A retried exchange answers 200, a new one 201.
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
const OTHER_SESSION_ID = "f0000000-0000-4000-8000-000000000002";
const TURN_REF = "7f1e2d3c-4b5a-4968-8776-655443322110";

type Runtime = OnboardingService["runtime"];
type AppendCall = Parameters<Runtime["appendInterviewTurns"]>[0];
type ListCall = Parameters<Runtime["listInterviewTurns"]>[0];

function fakeRuntime() {
  const appends: AppendCall[] = [];
  const lists: ListCall[] = [];
  const seen = new Set<string>();
  const unused = () => Promise.reject(new Error("not used in these tests"));
  const runtime = {
    startSession: unused,
    getSession: unused,
    getCurrentSession: unused,
    submitResponse: unused,
    skipStep: unused,
    withdrawResponse: unused,
    goBack: unused,
    completeSession: unused,
    resolveSuggestion: unused,
    answerInterviewQuestion: unused,
    dismissInterviewQuestion: unused,
    say: unused,
    appendInterviewTurns: (call: AppendCall) => {
      appends.push(call);
      if (call.sessionId !== SESSION_ID) {
        return Promise.reject(new OnboardingSessionNotFoundError());
      }
      const written = !seen.has(call.turnRef);
      seen.add(call.turnRef);
      return Promise.resolve({ written });
    },
    listInterviewTurns: (call: ListCall) => {
      lists.push(call);
      if (call.sessionId !== SESSION_ID) {
        return Promise.reject(new OnboardingSessionNotFoundError());
      }
      return Promise.resolve([
        {
          role: "PERSON" as const,
          text: "We are raising a seed round.",
          channel: "VOICE" as const,
          createdAt: "2026-09-24T10:00:00.000Z",
        },
        {
          role: "Q" as const,
          text: "How much are you raising?",
          channel: "VOICE" as const,
          createdAt: "2026-09-24T10:00:01.000Z",
        },
      ]);
    },
  } satisfies Runtime;
  return { runtime, appends, lists };
}

function buildApp(runtime: Runtime) {
  const security: ApiSecurityDependencies = {
    authenticator: {
      authenticate: (request) =>
        Promise.resolve(
          request.headers.authorization === undefined ? null : PRINCIPAL,
        ),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT } as const),
    },
    identities: {
      lookup: () => Promise.resolve({ userId: USER_ID, displayName: "Ada" }),
    },
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    onboarding: runtime,
  }).app;
}

const AUTH = { authorization: "Bearer token" };
const EXCHANGE = {
  turnRef: TURN_REF,
  turns: [
    {
      role: "PERSON",
      text: "We are raising a seed round.",
      stepKey: "intent",
      channel: "VOICE",
    },
    { role: "Q", text: "How much are you raising?", channel: "VOICE" },
  ],
};

describe("/v1/onboarding/sessions/:id/turns", () => {
  it("appends an exchange for the hook's actor: 201 when written, 200 on replay", async () => {
    const fake = fakeRuntime();
    const app = buildApp(fake.runtime);
    const url = `/v1/onboarding/sessions/${SESSION_ID}/turns`;

    const first = await app.inject({
      method: "POST",
      url,
      headers: AUTH,
      payload: EXCHANGE,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ written: true });

    const replay = await app.inject({
      method: "POST",
      url,
      headers: AUTH,
      payload: EXCHANGE,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ written: false });

    expect(fake.appends).toHaveLength(2);
    expect(fake.appends[0]?.actor.userId).toBe(USER_ID);
    expect(fake.appends[0]?.sessionId).toBe(SESSION_ID);
    expect(fake.appends[0]?.turns).toEqual(EXCHANGE.turns);
    await app.close();
  });

  it("reads the thread with a bounded limit and no-store", async () => {
    const fake = fakeRuntime();
    const app = buildApp(fake.runtime);
    const response = await app.inject({
      method: "GET",
      url: `/v1/onboarding/sessions/${SESSION_ID}/turns?limit=20`,
      headers: AUTH,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json<{ items: unknown[] }>().items).toHaveLength(2);
    expect(fake.lists[0]?.limit).toBe(20);

    const defaulted = await app.inject({
      method: "GET",
      url: `/v1/onboarding/sessions/${SESSION_ID}/turns`,
      headers: AUTH,
    });
    expect(defaulted.statusCode).toBe(200);
    expect(fake.lists[1]?.limit).toBe(50);
    await app.close();
  });

  it("refuses bad input (422) before the runtime is reached", async () => {
    const fake = fakeRuntime();
    const app = buildApp(fake.runtime);
    const url = `/v1/onboarding/sessions/${SESSION_ID}/turns`;
    for (const payload of [
      { ...EXCHANGE, turns: [] },
      { ...EXCHANGE, turnRef: "not-a-uuid" },
      {
        ...EXCHANGE,
        turns: [{ role: "Q", text: "", channel: "TEXT" }],
      },
      {
        ...EXCHANGE,
        turns: [
          { role: "Q", text: "One.", channel: "TEXT" },
          { role: "Q", text: "Two.", channel: "TEXT" },
        ],
      },
      { ...EXCHANGE, userId: "someone-else" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: AUTH,
        payload,
      });
      expect(response.statusCode).toBe(422);
    }
    const tooMany = await app.inject({
      method: "GET",
      url: `${url}?limit=101`,
      headers: AUTH,
    });
    expect(tooMany.statusCode).toBe(422);
    const badId = await app.inject({
      method: "GET",
      url: "/v1/onboarding/sessions/not-a-session/turns",
      headers: AUTH,
    });
    expect(badId.statusCode).toBe(422);
    expect(fake.appends).toHaveLength(0);
    expect(fake.lists).toHaveLength(0);
    await app.close();
  });

  it("another person's session is a 404 both ways", async () => {
    const fake = fakeRuntime();
    const app = buildApp(fake.runtime);
    const url = `/v1/onboarding/sessions/${OTHER_SESSION_ID}/turns`;
    const read = await app.inject({ method: "GET", url, headers: AUTH });
    expect(read.statusCode).toBe(404);
    const write = await app.inject({
      method: "POST",
      url,
      headers: AUTH,
      payload: EXCHANGE,
    });
    expect(write.statusCode).toBe(404);
    await app.close();
  });

  it("requires an authenticated caller", async () => {
    const fake = fakeRuntime();
    const app = buildApp(fake.runtime);
    const response = await app.inject({
      method: "GET",
      url: `/v1/onboarding/sessions/${SESSION_ID}/turns`,
    });
    expect(response.statusCode).toBe(401);
    expect(fake.lists).toHaveLength(0);
    await app.close();
  });
});
