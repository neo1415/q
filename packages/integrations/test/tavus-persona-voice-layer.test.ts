import { describe, expect, it } from "vitest";

import { createTavusClient } from "../src/index.js";

/**
 * REHEARSE (CQ_REHEARSAL_VIDEO_PERSONA_VOICE): the persona's ElevenLabs
 * voice reaches Tavus as the PAL's `layers.tts`, verified at the request
 * body with a fake fetch -- no paid room is opened. Only a public voice id
 * travels; the ElevenLabs key never does.
 */
describe("the face's persona voice on the wire", () => {
  it("sends layers.tts with the public ElevenLabs voice and no key", async () => {
    const bodies: unknown[] = [];
    const client = createTavusClient({
      apiKey: "disabled-locally-000000000000",
      fetch: (_url, init) => {
        bodies.push(
          JSON.parse(typeof init?.body === "string" ? init.body : "null"),
        );
        return Promise.resolve(
          new Response(JSON.stringify({ pal_id: "p0000001" }), {
            status: 200,
          }),
        );
      },
    });
    const tts = {
      tts_engine: "elevenlabs" as const,
      external_voice_id: "JBFqnCBsd6RMkjVDRZzb",
      tts_model_name: "eleven_flash_v2_5",
      voice_settings: { stability: 0.65, similarity_boost: 0.85, speed: 1 },
    };
    const { palId } = await client.createPal({
      name: "Harbourline Cargo (Q rehearsal)",
      systemPrompt: "Speak exactly the lines you are given.",
      faceId: "rdd4c86e5e1a",
      layers: {
        llm: {
          model: "capital-q-rehearsal",
          base_url: "https://q-api.example/bridge",
          api_key: "bridge-token",
        },
        tts,
      },
    });
    expect(palId).toBe("p0000001");
    const body = bodies[0] as { layers: { tts: unknown } };
    expect(body.layers.tts).toEqual(tts);
    expect(JSON.stringify(body.layers.tts)).not.toMatch(/api_key|xi-api/u);
  });

  it("sends no tts layer when the flag composed none", async () => {
    const bodies: unknown[] = [];
    const client = createTavusClient({
      apiKey: "disabled-locally-000000000000",
      fetch: (_url, init) => {
        bodies.push(
          JSON.parse(typeof init?.body === "string" ? init.body : "null"),
        );
        return Promise.resolve(
          new Response(JSON.stringify({ pal_id: "p0000002" }), {
            status: 200,
          }),
        );
      },
    });
    await client.createPal({
      name: "Q",
      systemPrompt: "x",
      faceId: "rdd4c86e5e1a",
      layers: {
        llm: { model: "m", base_url: "https://q-api.example/b", api_key: "t" },
      },
    });
    const body = bodies[0] as { layers: Record<string, unknown> };
    expect("tts" in body.layers).toBe(false);
  });
});
