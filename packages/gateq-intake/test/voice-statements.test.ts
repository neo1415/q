import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createGateqVoiceInterview,
  GATEQ_VOICE_DEFAULTS,
  type GateqVoiceSessionRow,
  type GateqVoiceSessionStore,
} from "../src/voice/voice-interview.js";
import { JOURNEY } from "./fixtures/long-journey.js";
import { reading, statementWorld } from "./support/statement-world.js";

/**
 * Owner directive 2026-11-14 (GateQ voice reuses the existing voice
 * providers): a line spoken to Q's ElevenLabs voice is the SAME canonical
 * turn as a typed one. Statements (slice 2 write path, 1f9e33016), turn
 * readings and the transcript come out identical whichever way the
 * founder answered, and typing afterwards carries on in the same interview.
 */

function memoryStore(): GateqVoiceSessionStore {
  const rows: GateqVoiceSessionRow[] = [];
  return {
    reserve: (input) => {
      const row: GateqVoiceSessionRow = {
        id: input.id,
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        status: "LIVE",
        endedReason: null,
        guestCredentialSealed: input.guestCredentialSealed,
        bridgeTokenHash: input.bridgeTokenHash,
        maxSeconds: input.maxSeconds,
        createdAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + input.maxSeconds * 1000).toISOString(),
      };
      rows.push(row);
      return Promise.resolve({ kind: "CREATED" as const, row });
    },
    end: (input) => {
      const i = rows.findIndex((r) => r.id === input.id);
      const row = rows[i];
      if (row === undefined) return Promise.resolve(null);
      rows[i] = { ...row, status: "ENDED", endedReason: input.reason };
      return Promise.resolve(rows[i] ?? null);
    },
    openForApplication: () =>
      Promise.resolve(rows.find((r) => r.status === "LIVE") ?? null),
    countForApplication: () => Promise.resolve(rows.length),
    byBridgeTokenHash: (hash) =>
      Promise.resolve(rows.find((r) => r.bridgeTokenHash === hash) ?? null),
    expired: () => Promise.resolve([]),
  };
}

const TURNS = JOURNEY.slice(0, 3);

async function journey(by: "TEXT" | "VOICE") {
  const world = statementWorld();
  const { intake, conversation } = world.services();
  const { token } = await intake.start({
    gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
  });
  world.scripts.push(() =>
    reading({ reply: "Hello, I'm Q. What are you building?" }),
  );
  await conversation.openingFor({ token, correlationId: randomUUID() });
  const voice = createGateqVoiceInterview({
    config: { ...GATEQ_VOICE_DEFAULTS, enabled: true },
    provider: {
      kind: "DIAL_BACK",
      name: "elevenlabs",
      issueLine: () =>
        Promise.resolve({
          providerConversationId: "conv_journey",
          token: "webrtc-token",
        }),
    },
    lineSecret: "x".repeat(43),
    sealer: { seal: (p) => `sealed:${p}`, open: (s) => s.slice(7) },
    intake,
    conversation,
    bridgePath: "/v1/gateq/voice/bridge",
    store: memoryStore(),
  });
  if (by === "VOICE") {
    // Q's opening is the server's, already in the transcript: the voice
    // line opens on the question Q last asked, with no new model call.
    const opened = await voice.start({ token, correlationId: randomUUID() });
    expect(opened.line.provider).toBe("elevenlabs");
  }
  const replies: string[] = [];
  let index = 0;
  for (const turn of TURNS) {
    world.advance(60_000);
    if (turn.script === "FAIL") throw new Error("fixture");
    world.scripts.push(turn.script);
    index += 1;
    if (by === "TEXT") {
      const result = await conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });
      replies.push(result.reply);
    } else {
      const result = await voice.dialBackTurn({
        providerConversationId: "conv_journey",
        utterance: turn.say,
        utteranceIndex: index,
        correlationId: randomUUID(),
      });
      replies.push(result.kind === "REPLY" ? result.reply : result.kind);
    }
  }
  return { world, token, voice, conversation, replies };
}

const shape = (world: ReturnType<typeof statementWorld>) =>
  world.store().statementRows.map((s) => ({
    dimension: s.dimension,
    words: s.words,
    origin: s.origin,
    value: JSON.stringify(s.value),
  }));

describe("a spoken line is the same canonical turn as a typed one (ElevenLabs dial-back)", () => {
  it("records the same statements, readings and replies as typing", async () => {
    const typed = await journey("TEXT");
    const spoken = await journey("VOICE");
    expect(spoken.replies).toEqual(typed.replies);
    expect(shape(spoken.world)).toEqual(shape(typed.world));
    expect(shape(spoken.world).length).toBeGreaterThan(0);
    expect(spoken.world.store().readingRows).toHaveLength(
      typed.world.store().readingRows.length,
    );
    // Every recorded statement names the voice turn that said it.
    const voiceTurnIds = new Set(
      spoken.world
        .store()
        .turnRows.filter(
          (t) => t.role === "PERSON" && t.clientTurnId.startsWith("voice-"),
        )
        .map((t) => t.id),
    );
    expect(voiceTurnIds.size).toBe(TURNS.length);
    for (const statement of spoken.world.store().statementRows)
      expect(voiceTurnIds.has(statement.sourceTurnId ?? "")).toBe(true);
  });

  it("ending the line and typing keeps every spoken turn in the one interview", async () => {
    const spoken = await journey("VOICE");
    await spoken.voice.end({ token: spoken.token, continueByTyping: true });
    spoken.world.scripts.push(() => reading({ reply: "Noted." }));
    await spoken.conversation.turn({
      token: spoken.token,
      message: "And we are hiring.",
      clientTurnId: "turn-typed-after",
      correlationId: randomUUID(),
    });
    const transcript = await spoken.conversation.transcript(spoken.token);
    expect(
      transcript.filter((t) => t.role === "PERSON").map((t) => t.text),
    ).toEqual([...TURNS.map((t) => t.say), "And we are hiring."]);
    // The ended line takes nothing more.
    expect(
      await spoken.voice.dialBackTurn({
        providerConversationId: "conv_journey",
        utterance: "One more thing.",
        utteranceIndex: 9,
        correlationId: randomUUID(),
      }),
    ).toEqual({ kind: "CLOSED" });
  });
});
