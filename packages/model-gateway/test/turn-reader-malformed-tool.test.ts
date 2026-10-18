import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import { TurnReaderV52ResultSchema } from "@capital-q/q-core";

import { ModelGatewayError, type ModelGateway } from "../src/index.js";
import { acceptStructuredOutput } from "../src/policy/structured.js";
import {
  createQTurnReader,
  TURN_READER_CORRECTION,
  TURN_READER_LENIENT_FIELDS,
} from "../src/q/turn-reader.js";

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

/**
 * Live 2026-10-16: "Set me a reminder for Friday at 10am…" was refused as
 * "tool:custom" -- a tool written with another kind's parameters failed
 * the tool's own refinement, the whole reading was refused, and the turn
 * went to the general answer, which asked for the city itself.
 */
const READING = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
};

const attribution = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  correlationId: "cor_test",
};

describe("a malformed tool in a turn reading", () => {
  const malformed = JSON.stringify({
    ...READING,
    // NAVIGATE with a visibility: another kind's parameter.
    tool: { kind: "NAVIGATE", destination: null, visibility: "PRIVATE" },
  });

  it("is refused whole without the lenient field (the live failure)", () => {
    const refused = acceptStructuredOutput(
      malformed,
      TurnReaderV52ResultSchema,
    );
    expect(refused.ok).toBe(false);
  });

  it("costs the tool, never the reading: kind and the rest still route it", () => {
    const kept = acceptStructuredOutput(malformed, TurnReaderV52ResultSchema, {
      lenientFields: TURN_READER_LENIENT_FIELDS,
    });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.value).toMatchObject({ kind: "TOOL_REQUEST", tool: null });
  });

  it("the reader asks for the lenient fields", async () => {
    const options: unknown[] = [];
    const gateway = {
      execute: (_request: unknown, opts: unknown) => {
        options.push(opts);
        return Promise.resolve({ output: { kind: "TEXT", text: "" } });
      },
    } as unknown as ModelGateway;
    await createQTurnReader({ gateway, logger }).read({
      utterance: "Set me a reminder for Friday at 10am.",
      recentTurns: [],
      modality: "TEXT",
      attribution,
    });
    expect(options[0]).toMatchObject({
      lenientFields: TURN_READER_LENIENT_FIELDS,
    });
  });

  it("a reading still refused is asked once more, with a correction, before it is answered unread", async () => {
    const requests: { messages: { content: string }[] }[] = [];
    const gateway = {
      execute: (request: { messages: { content: string }[] }) => {
        requests.push(request);
        if (requests.length === 1) {
          return Promise.reject(
            new ModelGatewayError("refused", {
              failureClass: "INVALID_MODEL_OUTPUT",
              attempts: 2,
              candidates: [],
              routingPolicyCode: undefined,
            }),
          );
        }
        return Promise.resolve({
          output: { kind: "STRUCTURED", value: { ...READING, tool: null } },
        });
      },
    } as unknown as ModelGateway;
    const read = await createQTurnReader({ gateway, logger }).read({
      utterance: "Set me a reminder for Friday at 10am.",
      recentTurns: [],
      modality: "TEXT",
      attribution,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)?.content).toBe(TURN_READER_CORRECTION);
    expect(read).toMatchObject({ kind: "TOOL_REQUEST" });
  });

  it("a cancellation is not asked again", async () => {
    let calls = 0;
    const gateway = {
      execute: () => {
        calls += 1;
        return Promise.reject(
          new ModelGatewayError("cancelled", {
            failureClass: "CANCELLED",
            attempts: 1,
            candidates: [],
            routingPolicyCode: undefined,
          }),
        );
      },
    } as unknown as ModelGateway;
    expect(
      await createQTurnReader({ gateway, logger }).read({
        utterance: "Set me a reminder for Friday at 10am.",
        recentTurns: [],
        modality: "TEXT",
        attribution,
      }),
    ).toBeNull();
    expect(calls).toBe(1);
  });
});
