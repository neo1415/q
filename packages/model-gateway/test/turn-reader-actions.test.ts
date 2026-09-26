import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import { createQTurnReader } from "../src/q/index.js";

/**
 * The turn reader is told the run's own actions (founder live 2026-09-26:
 * "Make a Q card for Zino Aviation with the handle zino-aviation" filed an
 * investment brief). Deterministic: the actions reach the reading prompt as
 * trusted input with the rule that such a request is never a document; how
 * a model reads paraphrases is the live eval's (turn-reader-actions.live).
 */

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

function recording() {
  const prompts: string[] = [];
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      prompts.push(request.messages.map((m) => m.content).join("\n"));
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: {
            kind: "TOOL_REQUEST",
            confidence: "HIGH",
            transcript: "CLEAR",
            question: null,
            aboutNamedOther: false,
            tool: null,
          },
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, prompts };
}

const ATTRIBUTION = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  correlationId: "cor_test",
};

describe("the turn reader knows the run's own actions", () => {
  it("renders every offered action, trusted, with the never-a-document rule", async () => {
    const { gateway, prompts } = recording();
    const reader = createQTurnReader({ gateway, logger });
    const read = await reader.read({
      utterance:
        "Make a Q card for Zino Aviation with the handle zino-aviation",
      recentTurns: [],
      modality: "TEXT",
      attribution: ATTRIBUTION,
      actions: [
        {
          name: "propose_handle_claim",
          does: "Proposes a Capital Q handle and Q card for their own organisation.",
        },
      ],
    });
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("OTHER ACTIONS CAPITAL Q TAKES");
    expect(prompt).toContain("propose_handle_claim");
    expect(prompt).toContain("never for something one of these actions does");
    // A request for an action comes back as TOOL_REQUEST with no tool of the
    // reader's own: the answer's model, which holds the action, takes it.
    expect(read?.kind).toBe("TOOL_REQUEST");
    expect(read?.tool).toBeNull();
  });

  it("with no actions, the section says so rather than inventing any", async () => {
    const { gateway, prompts } = recording();
    await createQTurnReader({ gateway, logger }).read({
      utterance: "write me a brief on Zino",
      recentTurns: [],
      modality: "TEXT",
      attribution: ATTRIBUTION,
    });
    expect(prompts[0]).toContain("OTHER ACTIONS CAPITAL Q TAKES");
    expect(prompts[0]).not.toContain("propose_handle_claim");
  });
});
