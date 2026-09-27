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
import { ownRecordTerms } from "../src/voice/vocabulary.js";

/**
 * The recogniser is told the names on the person's own records before it
 * hears them (founder live 2026-09-27, #6: "Zino Aviation" was heard as
 * "Zener Aviation"). The names come from the resolved actor's records,
 * never from anything the person said; remembered names reach it too.
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

function app(options: {
  readonly namesFor: (actor: ActorContext) => Promise<readonly string[]>;
  readonly termsFor?: (actor: ActorContext) => Promise<readonly string[]>;
}) {
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
      ownNames: { namesFor: options.namesFor },
      ...(options.termsFor === undefined
        ? {}
        : { memory: { termsFor: options.termsFor } }),
    },
  }).app;
}

async function keytermsOf(
  instance: ReturnType<typeof app>,
): Promise<readonly string[]> {
  const response = await instance.inject({
    method: "POST",
    url: "/v1/q/voice/sessions",
    headers: { authorization: "Bearer eyTEST.not-a-real.bearer" },
    payload: { voice: "FEMALE" },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    deepgram: {
      agent: { listen: { provider: { keyterms: readonly string[] } } };
    };
  }>();
  return body.deepgram.agent.listen.provider.keyterms;
}

describe("the recogniser hears the person's own names (founder live #6)", () => {
  it("passes their company, legal, firm and own names as keyterms, first, read for the resolved actor", async () => {
    const asked: ActorContext[] = [];
    const instance = app({
      namesFor: (actor) => {
        asked.push(actor);
        return Promise.resolve(
          ownRecordTerms({
            companyNames: ["Zino Aviation", "ZINO AVIATION LTD"],
            firmName: "Harbour Angels",
            personName: "Adaeze Okafor",
          }),
        );
      },
      termsFor: () => Promise.resolve(["Okwuosa"]),
    });
    const keyterms = await keytermsOf(instance);
    expect(keyterms.slice(0, 4)).toEqual([
      "Zino Aviation",
      "ZINO AVIATION LTD",
      "Harbour Angels",
      "Adaeze Okafor",
    ]);
    // Remembered names reach the recogniser as well.
    expect(keyterms).toContain("Okwuosa");
    expect(asked).toEqual([CONTEXT]);
    await instance.close();
  });

  it("issues the session without them when the records cannot be read", async () => {
    const instance = app({
      namesFor: () => Promise.reject(new Error("database unavailable")),
    });
    const keyterms = await keytermsOf(instance);
    expect(keyterms).not.toContain("Zino Aviation");
    expect(keyterms.length).toBeGreaterThan(0);
    await instance.close();
  });

  it("keeps one of each name, however cased, and nothing a recogniser cannot use", () => {
    expect(
      ownRecordTerms({
        companyNames: ["Kivu Freight", "KIVU FREIGHT", null, " "],
        firmName: null,
        personName: "x".repeat(61),
      }),
    ).toEqual(["Kivu Freight"]);
  });
});
