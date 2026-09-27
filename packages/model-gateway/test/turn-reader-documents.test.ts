import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import { createQTurnReader } from "../src/q/index.js";

/**
 * TURN_READER v9 (founder live 2026-09-27, failures 6 and 7): every
 * document asked for in one message is read, and the person's own company
 * is left to code. Deterministic: the rule reaches the prompt and the
 * reading's shape is validated; how a model reads paraphrases is a live
 * eval's job, not this test's.
 */

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

function document(documentType: string, subjectName: string | null) {
  return {
    kind: "PREPARE_DOCUMENT",
    destination: null,
    visibility: null,
    documentType,
    subjectName,
  };
}

function reader(value: unknown) {
  const prompts: string[] = [];
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      prompts.push(request.messages.map((m) => m.content).join("\n"));
      return Promise.resolve({ output: { kind: "STRUCTURED", value } });
    },
  } as unknown as ModelGateway;
  return { reader: createQTurnReader({ gateway, logger }), prompts };
}

const INPUT = {
  utterance: "a PDF of my mandate and a PPTX pitch deck for my company",
  recentTurns: [],
  modality: "VOICE" as const,
  attribution: {
    tenantId: "c0000000-0000-4000-8000-000000000001",
    userId: "b0000000-0000-4000-8000-000000000001",
    correlationId: "cor_test",
  },
};

const BASE = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
};

describe("the turn reader reads several documents in one message (v9)", () => {
  it("tells the model to list every document and to leave their own company to code", async () => {
    const { reader: read, prompts } = reader({ ...BASE, tool: null });
    await read.read(INPUT);
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("moreDocuments holds each other one");
    expect(prompt).toContain("null when they mean their own company");
  });

  it("returns the first document as the tool and the others in order", async () => {
    const { reader: read } = reader({
      ...BASE,
      tool: document("OWN_MANDATE", null),
      moreDocuments: [document("PITCH_DECK", null)],
    });
    const reading = await read.read(INPUT);
    expect(reading?.tool?.documentType).toBe("OWN_MANDATE");
    expect(reading?.moreDocuments?.map((tool) => tool.documentType)).toEqual([
      "PITCH_DECK",
    ]);
  });

  it("defaults to none, and refuses a reading that smuggles a non-document into moreDocuments", async () => {
    const none = await reader({ ...BASE, tool: null }).reader.read(INPUT);
    expect(none?.moreDocuments).toEqual([]);
    const smuggled = await reader({
      ...BASE,
      tool: document("PITCH_DECK", null),
      moreDocuments: [
        {
          kind: "NAVIGATE",
          destination: "HOME",
          visibility: null,
          documentType: null,
          subjectName: null,
        },
      ],
    }).reader.read(INPUT);
    expect(smuggled).toBeNull();
  });
});
