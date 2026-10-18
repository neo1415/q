import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import type { OnboardingNudgeView } from "@capital-q/contracts";
import type {
  OnboardingNudgeChoice,
  OnboardingService,
} from "@capital-q/onboarding";
import {
  AuthUserIdSchema,
  UserIdSchema,
  type AuthenticatedPrincipal,
  type UserId,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * The setup-reminder routes: the person's own reminders, keyed by the
 * authenticated principal and never by anything in the request.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const USER_ID = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");

const NUDGE: OnboardingNudgeView = {
  policyVersion: "onboarding-nudge/test",
  journeyType: "investor",
  emphasis: "STRONG",
  requiredCount: 9,
  doneCount: 4,
  minutesLeft: 2,
  remainingTopics: ["Cheque size"],
  day: "2026-09-27",
};

function build(principal: AuthenticatedPrincipal | null) {
  const calls: { method: string; userId: UserId; choice?: string }[] = [];
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "CONTEXT_REQUIRED" as const }),
    },
    identities: {
      lookup: () => Promise.resolve({ userId: USER_ID, displayName: "Ada" }),
    },
  };
  // The runtime is not exercised here; only the reminder routes are.
  const runtime = {} as OnboardingService["runtime"];
  const app = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    onboarding: runtime,
    onboardingNudges: {
      peek: (userId: UserId, request: { surface: string }) => {
        calls.push({ method: `peek:${request.surface}`, userId });
        return Promise.resolve(NUDGE);
      },
      claimBriefing: (userId: UserId) => {
        calls.push({ method: "claimBriefing", userId });
        return Promise.resolve(NUDGE);
      },
      choose: (userId: UserId, choice: OnboardingNudgeChoice) => {
        calls.push({ method: "choose", userId, choice });
        return Promise.resolve();
      },
    },
  }).app;
  return { app, calls };
}

describe("/v1/onboarding/nudge", () => {
  it("requires authentication", async () => {
    const { app, calls } = build(null);
    const response = await app.inject({
      method: "POST",
      url: "/v1/onboarding/nudge/briefing",
    });
    expect(response.statusCode).toBe(401);
    expect(calls).toEqual([]);
  });

  it("claims today's card for the authenticated person only", async () => {
    const { app, calls } = build(PRINCIPAL);
    const response = await app.inject({
      method: "POST",
      url: "/v1/onboarding/nudge/briefing",
      payload: { userId: "b0000000-0000-4000-8000-00000000ffff" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ nudge: NUDGE });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(calls).toEqual([{ method: "claimBriefing", userId: USER_ID }]);
  });

  it("reads whether today's reminder is due without claiming it", async () => {
    const { app, calls } = build(PRINCIPAL);
    const response = await app.inject({
      method: "GET",
      url: "/v1/onboarding/nudge/briefing",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ nudge: NUDGE });
    expect(calls).toEqual([{ method: "peek:BRIEFING", userId: USER_ID }]);
  });

  it("records 'later' and 'stop', and refuses anything else", async () => {
    const { app, calls } = build(PRINCIPAL);
    for (const choice of ["LATER", "STOP"]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/nudge/choice",
        payload: { choice },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ recorded: choice });
    }
    const bad = await app.inject({
      method: "POST",
      url: "/v1/onboarding/nudge/choice",
      payload: { choice: "FOREVER" },
    });
    expect(bad.statusCode).toBe(422);
    expect(calls).toEqual([
      { method: "choose", userId: USER_ID, choice: "LATER" },
      { method: "choose", userId: USER_ID, choice: "STOP" },
    ]);
  });
});
