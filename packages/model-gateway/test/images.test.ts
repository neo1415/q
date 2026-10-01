import { describe, expect, it } from "vitest";

import {
  messagesCarryImages,
  ModelGatewayRequestSchema,
  type ModelMessage,
} from "@capital-q/contracts";

import { toContents } from "../src/providers/google.js";
import { toMessages } from "../src/providers/groq.js";
import { toInput } from "../src/providers/openai.js";
import { estimateInputTokens } from "../src/policy/cost.js";

/**
 * REHEARSE: a USER message may carry a shared-screen frame for a vision
 * model. Inline base64 only; every adapter maps it; carrying one makes the
 * request need VISION.
 */

const FRAME =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";
const messages: ModelMessage[] = [
  { role: "SYSTEM", content: "Play the investor." },
  {
    role: "USER",
    content: "What do you think of this slide?",
    images: [{ mediaType: "image/png", dataBase64: FRAME }],
  },
];

describe("image input", () => {
  it("is detected so the gateway requires VISION", () => {
    expect(messagesCarryImages(messages)).toBe(true);
    expect(messagesCarryImages([{ role: "USER", content: "hi" }])).toBe(false);
  });

  it("maps to OpenAI input_image as an inline data URL", () => {
    const { input } = toInput(messages);
    expect(JSON.stringify(input)).toContain(
      `"type":"input_image","image_url":"data:image/png;base64,${FRAME}"`,
    );
  });

  it("maps to Gemini inlineData", () => {
    const { contents } = toContents(messages);
    expect(contents[0]?.parts).toContainEqual({
      inlineData: { mimeType: "image/png", data: FRAME },
    });
  });

  it("maps to an OpenAI-style image_url part for Groq", () => {
    expect(JSON.stringify(toMessages(messages))).toContain(
      `"image_url":{"url":"data:image/png;base64,${FRAME}"}`,
    );
  });

  it("counts toward the input estimate", () => {
    const plain: ModelMessage[] = [{ role: "USER", content: "x" }];
    expect(estimateInputTokens(messages)).toBeGreaterThan(
      estimateInputTokens(plain) + 900,
    );
  });

  it("refuses a URL or an unbounded payload", () => {
    const base = {
      taskClass: "NORMAL_DIALOGUE",
      sensitivity: "CONFIDENTIAL",
      output: { kind: "TEXT" },
      attribution: {
        tenantId: "11111111-1111-4111-8111-111111111111",
        correlationId: "cor_test",
      },
    };
    for (const dataBase64 of [
      "https://example.com/a.png",
      "A".repeat(800_000),
    ]) {
      expect(
        ModelGatewayRequestSchema.safeParse({
          ...base,
          messages: [
            {
              role: "USER",
              content: "x",
              images: [{ mediaType: "image/png", dataBase64 }],
            },
          ],
        }).success,
      ).toBe(false);
    }
  });
});
