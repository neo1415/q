import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { QVoiceTurnStateSchema } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";

import type {
  VoiceSessionBinding,
  VoiceSessionBindings,
} from "../src/voice/bindings.js";
import { registerVoiceThinkRoute } from "../src/voice/think.js";
import { createVoiceTurnBoard } from "../src/voice/turn-board.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * RECOVERY A4 on the standard line: every think ends in one disposition,
 * noted on the turn board the browser already polls. Before, a turn Q
 * chose not to answer streamed nothing and the screen sat on "Thinking"
 * for 14 s, then went quiet.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const TOKEN = "secret-think-token";

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: "f0000000-0000-4000-8000-000000000002",
    providerConversationId: "dg_f0000000-0000-4000-8000-000000000002",
    actor: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
    } as never,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: Number.MAX_SAFE_INTEGER,
    connectedAt: undefined,
    thinkToken: TOKEN,
  };
}

function bindings(bound: VoiceSessionBinding): VoiceSessionBindings {
  return {
    issue: () => true,
    connect: () => bound,
    get: () => bound,
    byVoiceSessionId: () => bound,
    byThinkToken: (token) => (token === TOKEN ? bound : null),
    restore: () => Promise.resolve(bound),
    seal: () => "sealed",
    fingerprints: () => [],
    releaseFor: () => undefined,
    release: () => undefined,
    countFor: () => 1,
    size: () => 1,
  };
}

async function think(turn: VoiceTurnHandler, words: string) {
  const bound = binding();
  const board = createVoiceTurnBoard();
  const server = Fastify();
  registerVoiceThinkRoute(server, {
    path: "/v1/q/voice/think",
    bindings: bindings(bound),
    turn,
    logger,
    board,
  });
  await server.ready();
  await server.inject({
    method: "POST",
    url: "/v1/q/voice/think/chat/completions",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      model: "capital-q",
      stream: true,
      messages: [{ role: "user", content: words }],
    },
  });
  await server.close();
  return board.read(bound.voiceSessionId);
}

describe("the standard line's turn dispositions", () => {
  it("IGNORED when Q chose to say nothing, noted for the screen", async () => {
    const state = await think(
      () => Promise.resolve({ kind: "NOTHING" }),
      "Sam, close the door.",
    );
    expect(state.outcome).toEqual({ seq: 1, disposition: "IGNORED" });
    expect(QVoiceTurnStateSchema.safeParse(state).success).toBe(true);
    // The turn's own sequence (cards, navigation) does not move.
    expect(state.sequence).toBe(0);
  });

  it("ANSWERED when Q spoke", async () => {
    const state = await think(async (_b, _t, _s, speaker) => {
      await speaker.speak("Three investors fit.");
      return { kind: "SPOKEN", path: "Q" };
    }, "Who fits?");
    expect(state.outcome?.disposition).toBe("ANSWERED");
  });

  it("FAILED/TOOL_FAILED when the turn threw (and Q said so)", async () => {
    const state = await think(
      () => Promise.reject(new Error("boom")),
      "Who fits?",
    );
    expect(state.outcome).toMatchObject({
      disposition: "FAILED",
      failure: "TOOL_FAILED",
    });
  });
});
