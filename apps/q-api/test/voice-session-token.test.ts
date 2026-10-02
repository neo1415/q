import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import { createVoiceSessionBindings } from "../src/voice/bindings.js";
import {
  createVoiceSessionSealer,
  VOICE_SESSION_TOKEN_TTL_MS,
  type VoiceSessionClaims,
} from "../src/voice/session-token.js";
import { registerVoiceThinkRoute } from "../src/voice/think.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * HARDEN P0 (live 2026-10-02): "voice speak relay refused
 * NO_BINDING_FOR_TOKEN boundCount=0" the moment a deploy's new container
 * took over -- bindings lived only in process memory. A line's binding is
 * now sealed into its token: a new process holding the same server secret
 * restores it, and a token that is tampered, foreign, expired or released
 * is refused.
 */

const SECRET = "sb_secret_test_only_not_a_real_key_000000";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const ACTOR = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

const CLAIMS: VoiceSessionClaims = {
  voiceSessionId: "f0000000-0000-4000-8000-000000000001",
  providerConversationId: "dg_f0000000-0000-4000-8000-000000000001",
  actor: ACTOR,
  accessToken: "eyPRIVATE.bearer",
  voice: "FEMALE",
  thread: {
    conversationId: undefined,
    subjects: undefined,
    onboarding: undefined,
    welcome: false,
    opening: "Good morning. Two things today.",
  },
  issuedAt: 1_000,
  thinkBearer: true,
};

const REHEARSAL: VoiceSessionClaims = {
  ...CLAIMS,
  voiceSessionId: "f0000000-0000-4000-8000-000000000002",
  providerConversationId: "dg_f0000000-0000-4000-8000-000000000002",
  thread: {
    conversationId: undefined,
    subjects: undefined,
    onboarding: undefined,
    welcome: false,
    rehearsal: { rehearsalId: "e0000000-0000-4000-8000-000000000001" },
  },
  speakerVoiceId: "persona-voice-1",
};

const at = (time: number) => () => time;

/** One process: its own memory, the shared secret. */
const processWith = (time = 2_000, secret = SECRET) =>
  createVoiceSessionBindings({
    now: at(time),
    sealer: createVoiceSessionSealer({ secret, now: at(time) }),
  });

describe("sealed voice sessions survive a restart", () => {
  it("a new process with the same secret restores the line, connected", async () => {
    const before = processWith();
    const token = before.seal(CLAIMS);
    // Nothing of the person's session is readable in the token.
    expect(token).not.toContain("eyPRIVATE");
    expect(token).not.toContain(ACTOR.userId);

    const after = processWith();
    expect(after.size()).toBe(0);
    const restored = await after.restore(token);
    expect(restored).not.toBeNull();
    expect(restored?.voiceSessionId).toBe(CLAIMS.voiceSessionId);
    expect(restored?.actor).toEqual(ACTOR);
    expect(restored?.accessToken).toBe("eyPRIVATE.bearer");
    expect(restored?.voice).toBe("FEMALE");
    expect(restored?.thread.opening).toBe("Good morning. Two things today.");
    expect(restored?.thinkToken).toBe(token);
    expect(restored?.connectedAt).toBe(2_000);
    // Held from now on: the same object for the next turn.
    expect(after.byVoiceSessionId(CLAIMS.voiceSessionId)).toBe(restored);
    expect(await after.restore(token)).toBe(restored);
  });

  it("a rehearsal line keeps its rehearsal and the persona's voice", async () => {
    const token = processWith().seal(REHEARSAL);
    const restored = await processWith().restore(token);
    expect(restored?.thread.rehearsal).toEqual({
      rehearsalId: "e0000000-0000-4000-8000-000000000001",
    });
    expect(restored?.speakerVoiceId).toBe("persona-voice-1");
  });

  it("refuses a tampered token, a foreign key, a forged version and an expired token", async () => {
    const token = processWith().seal(CLAIMS);
    const [prefix, version, iv, body = ""] = token.split(".");
    const flipped = `${body.slice(0, 10)}${body[10] === "A" ? "B" : "A"}${body.slice(11)}`;
    const after = processWith();
    expect(await after.restore(`${prefix}.${version}.${iv}.${flipped}`)).toBe(
      null,
    );
    expect(await after.restore(`${prefix}.2.${iv}.${body}`)).toBe(null);
    expect(await after.restore(`${prefix}.0.${iv}.${body}`)).toBe(null);
    expect(await after.restore("qv1.1.garbage.garbage")).toBe(null);
    expect(await after.restore("a-random-bearer")).toBe(null);
    expect(
      await processWith(2_000, "another_server_secret_entirely").restore(token),
    ).toBe(null);
    expect(
      await processWith(1_000 + VOICE_SESSION_TOKEN_TTL_MS).restore(token),
    ).toBe(null);
  });

  it("a rotated key still opens the previous version's tokens, never older ones", () => {
    const v1 = createVoiceSessionSealer({
      secret: SECRET,
      keyVersion: 1,
      now: at(2_000),
    });
    const v2 = createVoiceSessionSealer({
      secret: SECRET,
      keyVersion: 2,
      now: at(2_000),
    });
    const v3 = createVoiceSessionSealer({
      secret: SECRET,
      keyVersion: 3,
      now: at(2_000),
    });
    const old = v1.seal(CLAIMS);
    expect(v2.open(old)?.voiceSessionId).toBe(CLAIMS.voiceSessionId);
    expect(v3.open(old)).toBe(null);
  });

  it("a line ended here is not restored here, and a suspended person gets nothing back", async () => {
    const one = processWith();
    const token = one.seal(CLAIMS);
    const restored = await one.restore(token);
    expect(restored).not.toBeNull();
    one.release(CLAIMS.providerConversationId);
    expect(await one.restore(token)).toBe(null);

    const suspended = createVoiceSessionBindings({
      now: at(2_000),
      sealer: createVoiceSessionSealer({ secret: SECRET, now: at(2_000) }),
      stillAllowed: () => Promise.resolve(false),
    });
    expect(await suspended.restore(token)).toBe(null);
  });
});

describe("the think route after a deploy", () => {
  it("answers a line issued by the old process; refuses a tampered bearer before any turn runs", async () => {
    const token = processWith().seal(CLAIMS);
    let ran = 0;
    const turn: VoiceTurnHandler = async (binding, _t, _s, speaker) => {
      ran += 1;
      expect(binding.actor).toEqual(ACTOR);
      await speaker.speak("Still here.");
      return { kind: "SPOKEN", path: "INTERVIEW" };
    };
    const server = Fastify();
    registerVoiceThinkRoute(server, {
      path: "/v1/q/voice/think",
      // The new container: a fresh store, the same secret.
      bindings: processWith(),
      turn,
      logger,
    });
    await server.ready();
    const ask = (bearer: string) =>
      server.inject({
        method: "POST",
        url: "/v1/q/voice/think/chat/completions",
        headers: { authorization: `Bearer ${bearer}` },
        payload: {
          model: "capital-q",
          stream: true,
          messages: [{ role: "user", content: "Are you still there?" }],
        },
      });
    const answered = await ask(token);
    expect(answered.statusCode).toBe(200);
    expect(answered.body).toContain("Still here.");
    expect(ran).toBe(1);

    const refused = await ask(`${token.slice(0, -4)}AAAA`);
    expect(refused.statusCode).toBe(401);
    expect(ran).toBe(1);
    await server.close();
  });

  it("does not let a session token issued for another transport think", async () => {
    // An ElevenLabs line's token is not a think bearer.
    const token = processWith().seal({ ...CLAIMS, thinkBearer: false });
    const server = Fastify();
    registerVoiceThinkRoute(server, {
      path: "/v1/q/voice/think",
      bindings: processWith(),
      turn: () => Promise.reject(new Error("must not run")),
      logger,
    });
    await server.ready();
    const response = await server.inject({
      method: "POST",
      url: "/v1/q/voice/think/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: { model: "capital-q", stream: true, messages: [] },
    });
    expect(response.statusCode).toBe(401);
    await server.close();
  });
});
