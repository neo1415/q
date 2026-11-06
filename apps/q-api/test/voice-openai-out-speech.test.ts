import { describe, expect, it } from "vitest";

import { createElevenLabsSpeechRelay } from "../src/voice/providers/elevenlabs-speak.js";

/**
 * DECISIONS 68 (lead's decision B): while OpenAI's account is out, Q's
 * voice line is Deepgram listening, Q's own brain answering, and q-api's
 * ElevenLabs relay speaking -- in Q's own Sarah or Daniel, by the person's
 * choice, on eleven_v4_turbo. No live provider call: ElevenLabs is a fake.
 */

const SARAH = "EXAVITQu4vr4xnSDxMaL";
const DANIEL = "onwK4e9ZLuTAKqWW03F9";

type Seen = { voiceId: string; model: string };

function fakeElevenLabs(): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    seen.push({
      voiceId: url.pathname.split("/")[3] ?? "",
      model: typeof body["model_id"] === "string" ? body["model_id"] : "",
    });
    return Promise.resolve(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "audio/pcm" },
      }),
    );
  };
  return { fetch: fetchFake, seen };
}

describe("Q's voice on the relay while OpenAI is out", () => {
  it("speaks eleven_v4_turbo in Q's own voice, by the person's choice", async () => {
    let out = true;
    const fake = fakeElevenLabs();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "disabled-locally-000000000000",
      fetch: fake.fetch,
      model: "eleven_v3_conversational",
      modelNow: () => (out ? "eleven_v4_turbo" : undefined),
    });
    await relay.stream({ voice: "FEMALE", text: "Here's what I found." });
    await relay.stream({ voice: "MALE", text: "Here's what I found." });
    expect(fake.seen[0]).toEqual({ voiceId: SARAH, model: "eleven_v4_turbo" });
    expect(fake.seen[1]).toEqual({ voiceId: DANIEL, model: "eleven_v4_turbo" });
    // OpenAI back: the deployment's own model again.
    out = false;
    await relay.stream({ voice: "FEMALE", text: "Here's what I found." });
    expect(fake.seen[2]).toEqual({
      voiceId: SARAH,
      model: "eleven_v3_conversational",
    });
  });
});
