import { describe, expect, it } from "vitest";

import type { ModelMessage } from "@capital-q/contracts";

import { toContents } from "../src/providers/google.js";

/**
 * Gemini 3 signs each function call with a thought signature and rejects
 * the follow-up request that omits it. The adapter carries it on the call
 * as opaque provider state and echoes it back, and only there.
 */
describe("gemini thought signatures", () => {
  it("echoes the signature on the function call it came with, and nowhere else", () => {
    const messages: readonly ModelMessage[] = [
      { role: "SYSTEM", content: "You are Q." },
      { role: "USER", content: "Look at thevaultlyne.com" },
      {
        role: "ASSISTANT",
        content: "",
        toolCalls: [
          {
            callId: "call-1",
            name: "public_web.search",
            arguments: { query: "vaultlyne" },
            providerState: "sig-abc",
          },
          {
            callId: "call-2",
            name: "public_web.extract",
            arguments: { urls: ["https://thevaultlyne.com/"] },
          },
        ],
      },
      {
        role: "TOOL",
        callId: "call-1",
        name: "public_web.search",
        content: JSON.stringify({ hits: [] }),
      },
      {
        role: "TOOL",
        callId: "call-2",
        name: "public_web.extract",
        content: JSON.stringify({ pages: [] }),
      },
    ];
    const { contents } = toContents(messages);
    const model = contents.find((c) => c.role === "model");
    const parts = model?.parts ?? [];
    expect(parts[0]).toMatchObject({
      functionCall: { name: "public_web.search" },
      thoughtSignature: "sig-abc",
    });
    expect(parts[1]).not.toHaveProperty("thoughtSignature");
    // Both tool results answer in one user turn, as the API requires.
    const answers = contents.at(-1);
    expect(answers?.role).toBe("user");
    expect(answers?.parts).toHaveLength(2);
  });
});
