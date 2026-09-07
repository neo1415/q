import { describe, expect, it } from "vitest";

import {
  MODEL_TOOLS_MAX,
  ModelGatewayRequestSchema,
  ModelMessageSchema,
  ModelToolCallSchema,
  ModelToolDefinitionSchema,
  ModelToolNameSchema,
} from "../src/model/index.js";

/**
 * Tool shapes on the Model Gateway contract (CQ-Q-007 §57-§59). What a
 * request may offer, what a model may propose, and the conversation
 * turns a tool loop produces — bounded and closed.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";

function baseRequest(extra: Record<string, unknown> = {}) {
  return {
    taskClass: "NORMAL_DIALOGUE",
    sensitivity: "PUBLIC",
    messages: [{ role: "USER", content: "hello" }],
    output: { kind: "TEXT" },
    budget: {
      maxAttempts: 1,
      maxEstimatedCostUsd: 0.1,
      maxOutputTokens: 100,
      attemptTimeoutMs: 5_000,
    },
    attribution: { tenantId: TENANT, correlationId: "cor_x" },
    ...extra,
  };
}

const TOOL = {
  name: "get_company",
  description: "Returns a company profile.",
  inputJsonSchema: { type: "object", properties: {} },
};

describe("model tool contracts", () => {
  it("accepts flat lower_snake_case provider names only", () => {
    expect(ModelToolNameSchema.safeParse("get_company").success).toBe(true);
    for (const bad of ["GetCompany", "company.get", "run sql", "x", ""]) {
      expect(ModelToolNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("is strict about definitions and calls", () => {
    expect(ModelToolDefinitionSchema.safeParse(TOOL).success).toBe(true);
    expect(
      ModelToolDefinitionSchema.safeParse({ ...TOOL, handler: "x" }).success,
    ).toBe(false);
    expect(
      ModelToolCallSchema.safeParse({
        callId: "c1",
        name: "get_company",
        arguments: { companyId: "x" },
      }).success,
    ).toBe(true);
    expect(
      ModelToolCallSchema.safeParse({
        callId: "c1",
        name: "get_company",
        arguments: "not an object",
      }).success,
    ).toBe(false);
  });

  it("models assistant tool-call turns and tool-result turns", () => {
    expect(
      ModelMessageSchema.safeParse({
        role: "ASSISTANT",
        content: "",
        toolCalls: [{ callId: "c1", name: "get_company", arguments: {} }],
      }).success,
    ).toBe(true);
    // An assistant turn with neither text nor calls says nothing.
    expect(
      ModelMessageSchema.safeParse({ role: "ASSISTANT", content: "" }).success,
    ).toBe(false);
    expect(
      ModelMessageSchema.safeParse({
        role: "TOOL",
        callId: "c1",
        name: "get_company",
        content: '{"ok":true}',
      }).success,
    ).toBe(true);
    // A tool result always answers a named call.
    expect(
      ModelMessageSchema.safeParse({ role: "TOOL", content: "{}" }).success,
    ).toBe(false);
    // SYSTEM and USER carry text only.
    expect(
      ModelMessageSchema.safeParse({
        role: "USER",
        content: "x",
        toolCalls: [],
      }).success,
    ).toBe(false);
  });

  it("offers tools with TEXT output only, uniquely named and bounded", () => {
    expect(
      ModelGatewayRequestSchema.safeParse(baseRequest({ tools: [TOOL] }))
        .success,
    ).toBe(true);
    expect(
      ModelGatewayRequestSchema.safeParse(
        baseRequest({
          tools: [TOOL],
          output: { kind: "STRUCTURED", schemaName: "X", jsonSchema: {} },
        }),
      ).success,
    ).toBe(false);
    expect(
      ModelGatewayRequestSchema.safeParse(baseRequest({ tools: [TOOL, TOOL] }))
        .success,
    ).toBe(false);
    expect(
      ModelGatewayRequestSchema.safeParse(
        baseRequest({
          tools: Array.from({ length: MODEL_TOOLS_MAX + 1 }, (_v, i) => ({
            ...TOOL,
            name: `tool_${String(i)}`,
          })),
        }),
      ).success,
    ).toBe(false);
    const parsed = ModelGatewayRequestSchema.parse(baseRequest());
    expect(parsed.tools).toEqual([]);
  });
});
