import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { isQVoiceCardReply } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";

import type {
  VoiceSessionBinding,
  VoiceSessionBindings,
} from "../src/voice/bindings.js";
import {
  createVoiceCardTurns,
  spokenCardOutcome,
} from "../src/voice/card-turns.js";
import { registerVoiceThinkRoute } from "../src/voice/think.js";
import { createVoiceTurnBoard } from "../src/voice/turn-board.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * RECOVERY A, audit E-03: decision cards on the standard voice line. A
 * reply about the card in focus is decided in the browser by the card's
 * own code; the think holds for that verdict and says the outcome instead
 * of running a Q turn on "send it". Anything else goes to Q.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const TOKEN = "secret-think-token";
const ID = "f0000000-0000-4000-8000-000000000003";

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: ID,
    providerConversationId: `dg_${ID}`,
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

async function think(
  cards: ReturnType<typeof createVoiceCardTurns>,
  turn: VoiceTurnHandler,
  words: string,
) {
  const board = createVoiceTurnBoard();
  const server = Fastify();
  registerVoiceThinkRoute(server, {
    path: "/v1/q/voice/think",
    bindings: bindings(binding()),
    turn,
    logger,
    board,
    cards,
  });
  await server.ready();
  const response = await server.inject({
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
  return { body: response.body, outcome: board.read(ID).outcome };
}

const qTurn = vi.fn<VoiceTurnHandler>(async (_b, _t, _s, speaker) => {
  await speaker.speak("Here is Q's answer.");
  return { kind: "SPOKEN", path: "Q" };
});

describe("decision cards on the standard line (E-03)", () => {
  it("says the card's outcome, and runs no Q turn, when the card's code decided it", async () => {
    qTurn.mockClear();
    const cards = createVoiceCardTurns();
    cards.setFocus(ID, true);
    // The browser's verdict lands first here; the think finds it waiting.
    cards.resolve(ID, "Send it.", {
      handled: true,
      outcome: {
        ok: true,
        done: "Sent to Halyard Security",
        nextCard: {
          position: 2,
          of: 3,
          kind: "waiting for their yes",
          to: "Tensorgate",
          draft: "Hi…",
        },
      },
    });
    const { body, outcome } = await think(cards, qTurn, "send it");
    expect(qTurn).not.toHaveBeenCalled();
    expect(body).toContain("Sent to Halyard Security.");
    // Streamed sentence by sentence.
    expect(body).toContain("Next, I've drafted a message to Tensorgate.");
    expect(body).toContain("Send it?");
    expect(outcome?.disposition).toBe("ACTED");
  });

  it("goes to Q when the card's code says it is not about the cards", async () => {
    qTurn.mockClear();
    const cards = createVoiceCardTurns();
    cards.setFocus(ID, true);
    const pending = think(cards, qTurn, "skip the small talk");
    await new Promise((resolve) => setTimeout(resolve, 20));
    cards.resolve(ID, "skip the small talk", { handled: false });
    const { body } = await pending;
    expect(qTurn).toHaveBeenCalledTimes(1);
    expect(body).toContain("Here is Q's answer.");
  });

  it("goes to Q when no card is in focus, or the words are a question", async () => {
    qTurn.mockClear();
    const cards = createVoiceCardTurns();
    await think(cards, qTurn, "send it");
    cards.setFocus(ID, true);
    await think(cards, qTurn, "What does Halyard invest in?");
    expect(qTurn).toHaveBeenCalledTimes(2);
  });

  it("goes to Q when no verdict comes in time", async () => {
    const cards = createVoiceCardTurns();
    const verdict = await cards.verdict(
      ID,
      "send it",
      new AbortController().signal,
      10,
    );
    expect(verdict).toBeNull();
  });

  it("shares one reading of a card reply with the duplex line", () => {
    expect(isQVoiceCardReply("send it")).toBe(true);
    expect(isQVoiceCardReply("find anything that needs my attention")).toBe(
      false,
    );
  });

  it("builds plain lines from the outcome's facts, never reading a model's situation out", () => {
    expect(
      spokenCardOutcome({
        ok: true,
        editedMessageOnScreen: "Hi Sam, warmer now.",
      }),
    ).toBe('Here\'s the changed message: "Hi Sam, warmer now." Send this?');
    expect(
      spokenCardOutcome({
        ok: true,
        situation:
          "That was the last card. Say so briefly and ask what's next.",
      }),
    ).toBe("That was the last one. What's next?");
    const failed = spokenCardOutcome({
      ok: false,
      situation:
        "Their words didn't come through clearly as a decision. Nothing was done; ask them to say it again or tap the button.",
    });
    expect(failed).toBe(
      "That didn't go through. It's still on your screen to decide.",
    );
    expect(spokenCardOutcome(undefined)).toBe("Done.");
  });
});
