import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  QStandingDtoSchema,
  type QLanguagePreference,
  type QPersonality,
} from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { registerStandingRoutes } from "../src/http/standing.js";
import { INITIAL_CONDUCT } from "../src/voice/conduct.js";
import { duplexInstructions } from "../src/voice/duplex/instructions.js";
import { livePrompt, styleFor } from "../src/voice/live/prompt.js";
import {
  arabicRecogniserLanguage,
  createDeepgramVoiceProvider,
} from "../src/voice/providers/deepgram.js";
import { createElevenLabsSpeechRelay } from "../src/voice/providers/elevenlabs-speak.js";
import type { StandingStore } from "../src/voice/standing.js";

/**
 * Multilingual Q, Arabic first (2026-10-16). The person's language is
 * their own row, set and read only as them; a chosen Arabic changes how
 * every voice line listens and speaks; English lines are unchanged.
 */

const actorFor = (n: number): ActorContext => ({
  userId: UserIdSchema.parse(`b0000000-0000-4000-8000-00000000000${n}`),
  tenantId: TenantIdSchema.parse(`c0000000-0000-4000-8000-00000000000${n}`),
  organisationId: OrganisationIdSchema.parse(
    `d0000000-0000-4000-8000-00000000000${n}`,
  ),
  membershipId: MembershipIdSchema.parse(
    `e0000000-0000-4000-8000-00000000000${n}`,
  ),
  actorType: "HUMAN",
});

function memoryStandingStore(): StandingStore & {
  readonly rows: Map<string, QLanguagePreference>;
} {
  const rows = new Map<string, QLanguagePreference>();
  const personality = new Map<string, QPersonality>();
  return {
    rows,
    read: (userId) =>
      Promise.resolve({
        personality: personality.get(userId) ?? "AUTO",
        language: rows.get(userId) ?? "AUTO",
        conduct: INITIAL_CONDUCT,
      }),
    saveConduct: () => Promise.resolve(),
    setPersonality: (userId, _tenant, value) => {
      personality.set(userId, value);
      return Promise.resolve();
    },
    setLanguage: (userId, _tenant, value) => {
      rows.set(userId, value);
      return Promise.resolve();
    },
    suspend: () => Promise.resolve(false),
  };
}

function appAs(actor: ActorContext, standing: StandingStore) {
  const app = Fastify();
  registerStandingRoutes(app, {
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
        Promise.resolve({ status: "RESOLVED", context: actor }),
    },
    standing,
  });
  return app;
}

describe("the language preference", () => {
  it("is saved for the person who chose it and read back as theirs", async () => {
    const store = memoryStandingStore();
    const first = appAs(actorFor(1), store);
    const second = appAs(actorFor(2), store);

    const before = await first.inject({ method: "GET", url: "/v1/q/standing" });
    expect(QStandingDtoSchema.parse(before.json()).language).toBe("AUTO");

    const put = await first.inject({
      method: "PUT",
      url: "/v1/q/standing/language",
      payload: { language: "ar" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.headers["cache-control"]).toBe("no-store");
    expect(QStandingDtoSchema.parse(put.json()).language).toBe("ar");

    const after = await first.inject({ method: "GET", url: "/v1/q/standing" });
    expect(QStandingDtoSchema.parse(after.json()).language).toBe("ar");
    // Another person's standing is untouched by the choice.
    const other = await second.inject({ method: "GET", url: "/v1/q/standing" });
    expect(QStandingDtoSchema.parse(other.json()).language).toBe("AUTO");
  });

  it("takes only a language Q speaks, and never a user id", async () => {
    const store = memoryStandingStore();
    const app = appAs(actorFor(1), store);
    for (const payload of [
      { language: "Arabic" },
      { language: "fr" },
      { language: "ar", userId: actorFor(2).userId },
      {},
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/q/standing/language",
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(store.rows.size).toBe(0);
  });

  it("can be set back to automatic", async () => {
    const store = memoryStandingStore();
    const app = appAs(actorFor(1), store);
    await app.inject({
      method: "PUT",
      url: "/v1/q/standing/language",
      payload: { language: "ar" },
    });
    const reset = await app.inject({
      method: "PUT",
      url: "/v1/q/standing/language",
      payload: { language: "AUTO" },
    });
    expect(QStandingDtoSchema.parse(reset.json()).language).toBe("AUTO");
  });
});

describe("the standard voice line in Arabic", () => {
  const provider = createDeepgramVoiceProvider({
    apiKey: "disabled-locally-000000000000",
    publicUrl: "https://public.example",
    thinkPath: "/v1/q/voice/think",
    speak: {
      path: "/v1/q/voice/speak",
      relay: createElevenLabsSpeechRelay({
        apiKey: "disabled-locally-000000000000",
      }),
    },
  });

  it("listens with Nova-3 Arabic (Flux Multilingual has no Arabic) and speaks Arabic", () => {
    const settings = provider.settingsFor({
      voice: "FEMALE",
      greeting: undefined,
      thinkToken: "t",
      locale: "ar-AE",
      terms: ["Harbourline Cargo"],
    });
    const listen = (
      settings.agent as { listen: { provider: Record<string, unknown> } }
    ).listen.provider;
    expect(listen).toMatchObject({
      type: "deepgram",
      version: "v1",
      model: "nova-3",
      language: "ar-AE",
    });
    expect(listen["keyterms"]).toContain("Harbourline Cargo");
    // Flux's end-of-turn fields are not Nova settings.
    expect(listen["eot_threshold"]).toBeUndefined();
    expect(settings.agent).toMatchObject({
      speak: { provider: { type: "eleven_labs", language: "ar" } },
    });
  });

  it("keeps the English line exactly as it was", () => {
    const settings = provider.settingsFor({
      voice: "FEMALE",
      greeting: undefined,
      thinkToken: "t",
      locale: "en-GB",
    });
    expect(settings.agent).toMatchObject({
      language: "en",
      listen: {
        provider: {
          model: "flux-general-en",
          version: "v2",
          eot_threshold: 0.85,
        },
      },
      speak: { provider: { language: "en" } },
    });
  });

  it("maps Arabic locales to Nova-3's codes, the Gulf ones kept", () => {
    expect(arabicRecogniserLanguage("ar")).toBe("ar");
    expect(arabicRecogniserLanguage("ar-SA")).toBe("ar-SA");
    expect(arabicRecogniserLanguage("ar-qa")).toBe("ar-QA");
    // A region Nova-3 does not list falls back to general Arabic.
    expect(arabicRecogniserLanguage("ar-OM")).toBe("ar");
    expect(arabicRecogniserLanguage("en-AE")).toBeNull();
    expect(arabicRecogniserLanguage(undefined)).toBeNull();
  });
});

describe("Q's spoken instructions in Arabic", () => {
  it("GPT-Live speaks Arabic, not 'always English', when Arabic is chosen", () => {
    const prompt = livePrompt({ locale: "ar", role: "founder" });
    expect(prompt).toContain("Modern Standard Arabic");
    expect(prompt).not.toContain("always speak natural, standard English");
    expect(prompt).toContain("never convert a currency");
    // Everything else in the style survives the swap.
    expect(styleFor("ar")).toContain("Laughter:");
  });

  it("GPT-Live stays English for English", () => {
    expect(styleFor("en-US")).toContain(
      "always speak natural, standard English",
    );
    expect(styleFor(undefined)).toContain(
      "always speak natural, standard English",
    );
  });

  it("the duplex line is told Arabic from its first word", () => {
    expect(duplexInstructions({ locale: "ar" })).toContain(
      "this person chose Arabic",
    );
    expect(duplexInstructions({ locale: "en" })).not.toContain("Arabic");
    expect(duplexInstructions({ locale: "fr" })).toContain(
      "answer in the language they speak",
    );
  });
});
