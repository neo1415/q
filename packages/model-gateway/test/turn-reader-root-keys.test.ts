import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import { createQTurnReader } from "../src/q/index.js";

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

/**
 * Live 2026-10-13: a turn reading that wrote a tool's own fields
 * (visibility, documentType, subjectName) at the root was refused and asked
 * again before the answer could start. The reader asks the gateway to drop
 * root keys its schema does not define rather than refuse the reading.
 */
describe("the turn reader's root keys", () => {
  it("asks for unknown root keys to be dropped, not the reading refused", async () => {
    const options: unknown[] = [];
    const gateway = {
      execute: (_request: unknown, opts: unknown) => {
        options.push(opts);
        return Promise.resolve({ output: { kind: "TEXT", text: "" } });
      },
    } as unknown as ModelGateway;
    await createQTurnReader({ gateway, logger }).read({
      utterance: "What are the main risks here?",
      recentTurns: [],
      modality: "TEXT",
      attribution: {
        tenantId: "c0000000-0000-4000-8000-000000000001",
        userId: "b0000000-0000-4000-8000-000000000001",
        correlationId: "cor_test",
      },
    });
    expect(options[0]).toMatchObject({ unknownRootKeys: "DROP" });
  });
});
