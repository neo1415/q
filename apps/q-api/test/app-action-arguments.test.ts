import { describe, expect, it } from "vitest";

import { APP_ACTIONS } from "@capital-q/app-actions";
import { ModelGatewayRequestSchema } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  QAnswerRequest,
  QOfferedTool,
  QToolPort,
} from "@capital-q/q-runtime";
import { inputJsonSchemaOf } from "@capital-q/q-tools";

import { createAppActionArgumentReader } from "../src/composition/app-action-arguments.js";

/**
 * Parity eval 2026-10-02: one cheap read of an app action's inputs against
 * the tool's own schema, only for a tool this run offers.
 */
const PASS: QOfferedTool = {
  toolName: "app.pass_company",
  toolVersion: 1,
  classification: "SIDE_EFFECT",
  definition: {
    name: "pass_company",
    description: "Passes on a company in their Discover feed.",
    inputJsonSchema: {
      type: "object",
      properties: { company: { type: "string" } },
      required: ["company"],
    },
  },
  visibleStage: null,
};

const request = {
  runId: "11111111-1111-4111-8111-111111111111",
  actor: {
    userId: "b0000000-0000-4000-8000-000000000001",
    tenantId: "c0000000-0000-4000-8000-000000000001",
    actorType: "HUMAN",
  },
  // Live runs carry the turn's signal (parity eval 2026-10-02).
  signal: new AbortController().signal,
  correlationId: "cor_t",
  capability: "ANSWER",
  plan: { maxSensitivity: "CONFIDENTIAL" },
} as unknown as QAnswerRequest;

function world(offered: readonly QOfferedTool[]) {
  const prompts: string[] = [];
  const gateway = {
    execute: (input: {
      readonly taskClass: string;
      readonly messages: readonly { readonly content: string }[];
    }) => {
      // The gateway's own contract, as gateway.execute applies it first
      // (live: "model gateway request is invalid", before any provider).
      ModelGatewayRequestSchema.parse(input);
      prompts.push(
        `${input.taskClass}\n${input.messages.map((m) => m.content).join("\n")}`,
      );
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: { arguments: { company: "Ajopot" } },
        },
      });
    },
  } as unknown as ModelGateway;
  const tools: QToolPort = {
    offer: () => Promise.resolve(offered),
    execute: () => Promise.reject(new Error("not used")),
  };
  return {
    read: createAppActionArgumentReader({ gateway, tools }),
    prompts,
  };
}

describe("the app action argument reader", () => {
  it("reads the offered tool's inputs from their words, with the tool's own schema, on a FAST call", async () => {
    const { read, prompts } = world([PASS]);
    expect(
      await read(request, {
        tool: "pass_company",
        utterance: "Pass on Ajopot.",
      }),
    ).toEqual({ company: "Ajopot" });
    expect(prompts[0]).toMatch(/^FAST_CLASSIFICATION/);
    expect(prompts[0]).toContain('"required":["company"]');
    expect(prompts[0]).toContain("Pass on Ajopot.");
  });

  it("a tool this run does not offer is never read for", async () => {
    const { read, prompts } = world([]);
    expect(
      await read(request, {
        tool: "pass_company",
        utterance: "Pass on Ajopot.",
      }),
    ).toBe(null);
    expect(prompts).toEqual([]);
  });
});

describe("every declared app action's argument request fits the gateway's contract", () => {
  it.each(
    APP_ACTIONS.flatMap((action) =>
      action.tool === undefined ? [] : [[action.tool.name, action] as const],
    ),
  )("%s", async (name, action) => {
    const tool = action.tool;
    if (tool === undefined) throw new Error("no tool");
    const offered: QOfferedTool = {
      toolName: `app.${action.name}`,
      toolVersion: 1,
      classification: "SIDE_EFFECT",
      definition: {
        name,
        description: tool.description,
        inputJsonSchema: inputJsonSchemaOf(tool.input),
      },
      visibleStage: null,
    };
    const { read, prompts } = world([offered]);
    // The fake gateway parses the request with ModelGatewayRequestSchema
    // and throws if it does not fit; the reader would then return null.
    expect(
      await read(request, { tool: name, utterance: "We're a team of 14 now." }),
    ).toEqual({ company: "Ajopot" });
    expect(prompts).toHaveLength(1);
  });
});
