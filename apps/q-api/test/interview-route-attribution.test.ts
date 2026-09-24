import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  PERSONAL_BOOTSTRAP_TENANT_ID,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { createVoiceSessionBindings } from "../src/voice/bindings.js";
import type {
  Interviewer,
  InterviewTurnInput,
} from "../src/voice/interviewer.js";
import type { RealtimeVoiceProvider } from "../src/voice/provider.js";

/**
 * The typed interview is attributed to the person who typed (P1).
 *
 * The route used to hand the interviewer a constant all-zero tenant and
 * user. Every model call it made then failed its usage-ledger write on the
 * tenant foreign key, and — the part a person feels — memory was recalled
 * for nobody, so Q forgot between sessions what they had told it. The
 * attribution is the server-resolved actor now, as on every other Q route,
 * and the personal bootstrap tenant for somebody with no organisation yet.
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
const PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

const provider: RealtimeVoiceProvider = {
  name: "fake",
  voices: ["FEMALE", "MALE"],
  createSession: () =>
    Promise.resolve({ token: "t", providerConversationId: "c" }),
  attach: () => Promise.resolve({ close: () => Promise.resolve() }),
};

function build(context: ActorContext | undefined) {
  const seen: InterviewTurnInput[] = [];
  const interviewer = {
    turn: (input: InterviewTurnInput) => {
      seen.push(input);
      return Promise.resolve({
        reply: "Which stages do you invest at?",
        intent: "ANSWER",
        asking: null,
        recorded: [],
        skipped: [],
        questionForQ: null,
        researching: null,
        navigate: null,
        handoff: null,
        degraded: false,
      });
    },
  } as unknown as Interviewer;
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          context === undefined
            ? { status: "CONTEXT_REQUIRED" }
            : { status: "RESOLVED", context },
        ),
    },
    identity: {
      lookup: () => Promise.resolve({ userId: CONTEXT.userId }) as never,
    },
  };
  const app = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    voice: {
      provider,
      bindings: createVoiceSessionBindings(),
      interviewer,
      apiBaseUrl: "http://api.test",
    },
  }).app;
  return { app, seen };
}

const turn = {
  onboardingSessionId: "f0000000-0000-4000-8000-000000000010",
  journeyType: "investor",
  channel: "text",
  utterance: "We're at seed",
  recentTurns: [],
};

describe("POST /v1/q/interview/turn attribution", () => {
  it("attributes the turn to the resolved actor, never a constant", async () => {
    const { app, seen } = build(CONTEXT);
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/interview/turn",
      headers: { authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.c2ln" },
      payload: turn,
    });
    expect(response.statusCode).toBe(200);
    expect(seen[0]?.attribution.tenantId).toBe(CONTEXT.tenantId);
    expect(seen[0]?.attribution.userId).toBe(CONTEXT.userId);
    expect(seen[0]?.attribution.tenantId).not.toBe(PLACEHOLDER);
    await app.close();
  });

  it("attributes a person with no organisation yet to themselves, under the personal tenant", async () => {
    const { app, seen } = build(undefined);
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/interview/turn",
      headers: { authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.c2ln" },
      payload: turn,
    });
    expect(response.statusCode).toBe(200);
    expect(seen[0]?.attribution.tenantId).toBe(PERSONAL_BOOTSTRAP_TENANT_ID);
    expect(seen[0]?.attribution.userId).toBe(CONTEXT.userId);
    await app.close();
  });

  it("refuses an unauthenticated turn before the interviewer sees it", async () => {
    const { app, seen } = build(CONTEXT);
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/interview/turn",
      payload: turn,
    });
    expect(response.statusCode).toBe(401);
    expect(seen).toHaveLength(0);
    await app.close();
  });
});
