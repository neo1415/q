import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { createVoiceSessionBindings } from "../src/voice/bindings.js";
import { createDeepgramVoiceProvider } from "../src/voice/providers/deepgram.js";

/**
 * Any language, honestly (owner 2026-10-16): a voice line opens in the
 * person's chosen language with the model the providers document for it,
 * and a chosen language no speech provider hears is refused in plain words
 * (type instead) rather than opened as a line that cannot listen.
 */

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

function app(language: string) {
  const security: QApiSecurityDependencies = {
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
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  const deepgram = createDeepgramVoiceProvider({
    apiKey: "disabled-locally-000000000000",
    publicUrl: "https://public.example",
    thinkPath: "/v1/q/voice/think",
    fetch: () =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: "browser-jwt" }), {
          status: 200,
        }),
      ),
  });
  return createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    voice: {
      deepgram,
      bindings: createVoiceSessionBindings(),
      languageOf: () => Promise.resolve(language),
    },
  }).app;
}

const open = (instance: ReturnType<typeof app>, locale?: string) =>
  instance.inject({
    method: "POST",
    url: "/v1/q/voice/sessions",
    headers: { authorization: "Bearer eyTEST.not-a-real.bearer" },
    payload: { voice: "FEMALE", ...(locale === undefined ? {} : { locale }) },
  });

type Opened = {
  deepgram: { agent: { listen: { provider: Record<string, unknown> } } };
};

describe("a voice line in the chosen language", () => {
  it("listens in French with Flux Multilingual and in Korean with Nova-3", async () => {
    const french = await open(app("fr"), "en-GB");
    expect(french.statusCode).toBe(201);
    expect(french.json<Opened>().deepgram.agent.listen.provider).toMatchObject({
      model: "flux-general-multi",
    });
    const korean = await open(app("ko"));
    expect(korean.statusCode).toBe(201);
    expect(korean.json<Opened>().deepgram.agent.listen.provider).toMatchObject({
      model: "nova-3",
      language: "ko",
    });
  });

  it("refuses a chosen language no speech provider hears, and says to type instead", async () => {
    const response = await open(app("sw"));
    expect(response.statusCode).toBe(422);
    expect(response.json<{ status: number }>().status).toBe(422);
    expect(response.json<{ detail: string }>().detail).toMatch(
      /^Q can't hold a voice conversation in Swahili yet.*Type to Q instead and Q answers in Swahili/u,
    );
  });

  it("only hints with a device language nobody chose: the line still opens", async () => {
    const response = await open(app("AUTO"), "sw-KE");
    expect(response.statusCode).toBe(201);
  });
});
