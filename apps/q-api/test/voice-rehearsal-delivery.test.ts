import { describe, expect, it } from "vitest";

import {
  createElevenLabsSpeechRelay,
  PERSONA_VOICE_IDS,
  personaVoiceId,
} from "../src/voice/providers/elevenlabs-speak.js";
import {
  renderSpeech,
  SPEECH_MARKUP,
} from "../src/voice/providers/speech-markup.js";
import {
  createSpeechPerformanceBoard,
  deliverLine,
} from "../src/voice/speech-performance.js";
import { performRehearsalLine, toneOf } from "../src/voice/rehearsal-turn.js";

/**
 * REHEARSE audit: the played person's mood is performed by the voice. On
 * Eleven v3 it becomes audio tags at the start of each sentence; on a voice
 * that would read tags aloud it is dropped, never approximated. The person
 * Q plays speaks in a voice of their own, never one taken from a request.
 */

const AUDIO = new Uint8Array([1, 2, 3]);
const recording = () => {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    urls.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    bodies.push(
      JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >,
    );
    return Promise.resolve(
      new Response(new Blob([AUDIO]), {
        status: 200,
        headers: { "content-type": "audio/pcm" },
      }),
    );
  };
  return { fetchFake, urls, bodies };
};

describe("a played line's delivery", () => {
  it("renders mood, loudness and a reaction as v3 audio tags", () => {
    const cues = deliverLine(["That is not good enough.", "Try again."], {
      tone: "ANGRY",
      intensity: "RAISED",
      reaction: "SIGH",
    });
    const first = renderSpeech(
      "That is not good enough.",
      cues,
      SPEECH_MARKUP.eleven_v3_conversational,
    );
    // A raised voice: shouting, ending on "!", at Creative stability.
    expect(first.text).toBe(
      "[angry] [shouting] [sighs] That is not good enough!",
    );
    expect(first.stability).toBe(0);
    expect(first.rendered).toContain("tone");
    const second = renderSpeech(
      "Try again.",
      cues,
      SPEECH_MARKUP.eleven_v3_conversational,
    );
    expect(second.text).toBe("[angry] [shouting] Try again!");
  });

  it("drops the mood on a voice that would read tags aloud", () => {
    const cues = deliverLine(["Fine."], {
      tone: "COLD",
      intensity: "SOFT",
      reaction: null,
    });
    expect(
      renderSpeech("Fine.", cues, SPEECH_MARKUP.eleven_turbo_v2_5).text,
    ).toBe("Fine.");
  });

  it("speaks a neutral line plainly", () => {
    expect(toneOf("NEUTRAL")).toBeNull();
    expect(
      deliverLine(["Okay."], {
        tone: null,
        intensity: "NORMAL",
        reaction: null,
      }),
    ).toEqual([]);
  });

  it("reaches the relay through the board, keyed by the voice line", async () => {
    const board = createSpeechPerformanceBoard();
    performRehearsalLine(board, "line-1", {
      text: "Look. I need numbers.",
      mood: "IMPATIENT",
      intensity: "NORMAL",
      reaction: null,
    });
    const { fetchFake, bodies } = recording();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "test-key-000000",
      fetch: fetchFake,
      performance: board,
    });
    await relay.stream({
      voice: "MALE",
      text: "I need numbers.",
      session: "line-1",
    });
    expect(bodies[0]?.["text"]).toBe("[frustrated] I need numbers.");
  });
});

describe("the played person's own voice", () => {
  it("is steady per counterpart and never Q's", () => {
    const a = personaVoiceId("MALE", "INVESTOR_ORGANISATION:abc");
    expect(personaVoiceId("MALE", "INVESTOR_ORGANISATION:abc")).toBe(a);
    expect(PERSONA_VOICE_IDS.MALE).toContain(a);
    expect(PERSONA_VOICE_IDS.FEMALE).toContain(
      personaVoiceId("FEMALE", "COMPANY:xyz"),
    );
  });

  it("is used only when it is one of the relay's own voices", async () => {
    const { fetchFake, urls } = recording();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "test-key-000000",
      fetch: fetchFake,
    });
    const persona = PERSONA_VOICE_IDS.FEMALE[0] ?? "";
    await relay.stream({ voice: "FEMALE", text: "Hi.", voiceId: persona });
    await relay.stream({
      voice: "FEMALE",
      text: "Hi.",
      voiceId: "someone-else",
    });
    expect(urls[0]).toContain(persona);
    expect(urls[1]).not.toContain("someone-else");
  });
});

describe("tears and smiles", () => {
  it("renders crying at Creative stability and a smile as warmth", async () => {
    const { renderSpeech, SPEECH_MARKUP } =
      await import("../src/voice/providers/speech-markup.js");
    const { deliverLine } = await import("../src/voice/speech-performance.js");
    const v3 = SPEECH_MARKUP.eleven_v3_conversational;
    const crying = renderSpeech(
      "I really thought this was it.",
      deliverLine(["I really thought this was it."], {
        tone: "SAD",
        intensity: "SOFT",
        reaction: "CRY",
      }),
      v3,
    );
    expect(crying.text).toBe(
      "[sad] [quietly] [crying] I really thought this was it.",
    );
    expect(crying.stability).toBe(0);
    const warm = renderSpeech(
      "That's great to hear.",
      deliverLine(["That's great to hear."], {
        tone: "HAPPY",
        intensity: "NORMAL",
        reaction: "CHUCKLE",
      }),
      v3,
    );
    expect(warm.text).toBe("[happy] [chuckles] That's great to hear.");
    expect(warm.stability).toBeUndefined();
  });
});
