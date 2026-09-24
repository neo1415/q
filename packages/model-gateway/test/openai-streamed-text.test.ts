import type OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { createOpenAIModelProvider } from "../src/providers/openai.js";

/**
 * A streamed answer's text comes from the completed response's own output
 * items (CQ-ACCEPT-001). The SDK only adds `output_text` to a response it
 * returns from a non-streaming call; the one carried by a stream's
 * `response.completed` event has no such property, and reading it made
 * every streamed Q answer `undefined` the first time OpenAI served.
 */

const completed = {
  id: "resp_1",
  model: "gpt-5.6-luna",
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [
        { type: "output_text", text: '{"answer":', annotations: [] },
        { type: "output_text", text: '"yes"}', annotations: [] },
      ],
    },
  ],
  usage: {
    input_tokens: 10,
    output_tokens: 4,
    input_tokens_details: { cached_tokens: 0 },
  },
};

function streamingClient(): OpenAI {
  return {
    responses: {
      create: () =>
        Promise.resolve(
          (async function* () {
            await Promise.resolve();
            yield { type: "response.output_text.delta", delta: '{"answer":' };
            yield { type: "response.output_text.delta", delta: '"yes"}' };
            yield { type: "response.completed", response: completed };
          })(),
        ),
    },
  } as unknown as OpenAI;
}

describe("the OpenAI adapter's streamed text", () => {
  it("is read from the completed response's output items", async () => {
    const provider = createOpenAIModelProvider({
      apiKey: "unused",
      client: streamingClient(),
    });
    const deltas: string[] = [];
    const result = await provider.generate(
      {
        modelCode: "gpt-5.6-luna",
        messages: [{ role: "USER", content: "Is it?" }],
        tools: [],
        maxOutputTokens: 100,
        reasoning: "NONE",
        output: { kind: "TEXT" },
      } as unknown as Parameters<typeof provider.generate>[0],
      {
        signal: new AbortController().signal,
        attemptTimeoutMs: 1000,
        onTextDelta: (delta: string) => deltas.push(delta),
      } as unknown as Parameters<typeof provider.generate>[1],
    );
    expect(result.text).toBe('{"answer":"yes"}');
    expect(deltas.join("")).toBe('{"answer":"yes"}');
  });
});
