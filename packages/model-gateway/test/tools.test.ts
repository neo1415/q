import { describe, expect, it } from "vitest";

import type { ModelMessage, ModelToolDefinition } from "@capital-q/contracts";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  ModelGatewayError,
  requiredCapabilitiesFor,
} from "../src/index.js";
import {
  GENERATED_CALL_ID_PREFIX,
  toContents,
  toolsForGemini,
} from "../src/providers/google.js";
import { toMessages, toolsForGroq } from "../src/providers/groq.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * Tools through the gateway and the adapters (CQ-Q-007 §60-§62, §101):
 * canonical definitions are projected, proposals are normalised, and a
 * proposal for a tool the request never offered is invalid model output.
 * No SDK call is made; the adapter projection functions are pure.
 */

const TOOL: ModelToolDefinition = {
  name: "get_company",
  description: "Returns a company profile.",
  inputJsonSchema: {
    type: "object",
    properties: { companyId: { type: "string", minLength: 36 } },
    required: ["companyId"],
    additionalProperties: false,
  },
};

const toolCapable = () =>
  testCatalog((s) => ({
    ...s,
    models: s.models.map((m) => ({ ...m, supportsTools: true })),
  }));

function build(
  script: Parameters<typeof createFakeModelProvider>[0]["script"],
  catalog = toolCapable(),
) {
  const alpha = createFakeModelProvider({ code: "alpha", script });
  const beta = createFakeModelProvider({
    code: "beta",
    script: [{ kind: "TEXT", text: "beta fallback" }],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog),
    registry: createModelProviderRegistry([alpha, beta]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  return { gateway, alpha, beta };
}

describe("gateway with tools", () => {
  it("requires TOOL_CALLING from the model when tools are offered", async () => {
    expect(requiredCapabilitiesFor({ kind: "TEXT" }, [], [TOOL])).toContain(
      "TOOL_CALLING",
    );
    const { gateway, alpha } = build(
      [{ kind: "TEXT", text: "x" }],
      testCatalog(),
    );
    await expect(
      gateway.execute(request({ tools: [TOOL] })),
    ).rejects.toMatchObject({ failureClass: "POLICY_INELIGIBLE" });
    expect(alpha.calls).toHaveLength(0);
  });

  it("passes the offered tools to the adapter and returns the model's proposals as TOOL_CALLS", async () => {
    const { gateway, alpha } = build([
      {
        kind: "TOOL_CALLS",
        calls: [
          { callId: "c1", name: "get_company", arguments: { companyId: "x" } },
        ],
        text: "",
      },
    ]);
    const result = await gateway.execute(request({ tools: [TOOL] }));
    expect(result.finish).toBe("TOOL_CALLS");
    expect(result.output).toEqual({
      kind: "TOOL_CALLS",
      calls: [
        { callId: "c1", name: "get_company", arguments: { companyId: "x" } },
      ],
      text: "",
    });
    expect(alpha.calls[0]?.request.tools).toEqual([TOOL]);
    // Without tools, the adapter is told so explicitly.
    await gateway.execute(request());
    expect(alpha.calls[1]?.request.tools).toEqual([]);
  });

  it("treats a proposal for an unoffered tool as invalid output: retried, then the fallback answers", async () => {
    const { gateway, alpha, beta } = build([
      {
        kind: "TOOL_CALLS",
        calls: [{ callId: "c1", name: "run_sql", arguments: { sql: "drop" } }],
      },
      {
        kind: "TOOL_CALLS",
        calls: [{ callId: "c2", name: "run_sql", arguments: { sql: "drop" } }],
      },
    ]);
    const result = await gateway.execute(request({ tools: [TOOL] }));
    expect(alpha.calls).toHaveLength(2);
    expect(beta.calls).toHaveLength(1);
    expect(result.fallbackUsed).toBe(true);
    expect(result.output).toEqual({ kind: "TEXT", text: "beta fallback" });
    expect(result.attempts.map((a) => a.outcome)).toEqual([
      "INVALID_MODEL_OUTPUT",
      "INVALID_MODEL_OUTPUT",
      "SUCCESS",
    ]);
  });

  it("refuses tool calls from a model that was offered none", async () => {
    const { gateway } = build([
      {
        kind: "TOOL_CALLS",
        calls: [{ callId: "c1", name: "get_company", arguments: {} }],
      },
      {
        kind: "TOOL_CALLS",
        calls: [{ callId: "c1", name: "get_company", arguments: {} }],
      },
    ]);
    const result = await gateway.execute(request());
    // alpha's two invalid attempts, then beta's text.
    expect(result.providerCode).toBe("beta");
  });

  it("rejects tools with STRUCTURED output as an invalid request", async () => {
    const { gateway } = build([{ kind: "TEXT", text: "x" }]);
    await expect(
      gateway.execute(
        request({
          tools: [TOOL],
          output: { kind: "STRUCTURED", schemaName: "X", jsonSchema: {} },
        }),
      ),
    ).rejects.toBeInstanceOf(ModelGatewayError);
  });

  it("accepts assistant tool-call turns and tool-result turns in the conversation", async () => {
    const { gateway, alpha } = build([{ kind: "TEXT", text: "final" }]);
    const messages: ModelMessage[] = [
      { role: "SYSTEM", content: "sys" },
      { role: "USER", content: "hi" },
      {
        role: "ASSISTANT",
        content: "",
        toolCalls: [
          { callId: "c1", name: "get_company", arguments: { companyId: "x" } },
        ],
      },
      {
        role: "TOOL",
        callId: "c1",
        name: "get_company",
        content: '{"ok":true}',
      },
    ];
    const result = await gateway.execute(request({ tools: [TOOL], messages }));
    expect(result.output).toEqual({ kind: "TEXT", text: "final" });
    expect(alpha.calls[0]?.request.messages).toHaveLength(4);
  });
});

describe("Gemini projection", () => {
  it("declares only the offered tools, with bounds keywords stripped", () => {
    const declared = toolsForGemini([TOOL]);
    expect(declared).toHaveLength(1);
    expect(declared[0]?.name).toBe("get_company");
    expect(JSON.stringify(declared[0]?.parametersJsonSchema)).not.toContain(
      "minLength",
    );
    expect(toolsForGemini([])).toEqual([]);
  });

  it("maps tool turns to function calls and merged function responses, echoing only real ids", () => {
    const { systemInstruction, contents } = toContents([
      { role: "SYSTEM", content: "sys" },
      { role: "USER", content: "hi" },
      {
        role: "ASSISTANT",
        content: "",
        toolCalls: [
          { callId: "abc", name: "get_company", arguments: { companyId: "x" } },
          {
            callId: `${GENERATED_CALL_ID_PREFIX}1`,
            name: "search_companies",
            arguments: {},
          },
        ],
      },
      {
        role: "TOOL",
        callId: "abc",
        name: "get_company",
        content: '{"ok":true}',
      },
      {
        role: "TOOL",
        callId: `${GENERATED_CALL_ID_PREFIX}1`,
        name: "search_companies",
        content: "not json",
      },
    ]);
    expect(systemInstruction).toBe("sys");
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    const model = contents[1]?.parts ?? [];
    expect(model).toEqual([
      {
        functionCall: {
          name: "get_company",
          args: { companyId: "x" },
          id: "abc",
        },
      },
      { functionCall: { name: "search_companies", args: {} } },
    ]);
    const responses = contents[2]?.parts ?? [];
    expect(responses).toEqual([
      {
        functionResponse: {
          name: "get_company",
          response: { ok: true },
          id: "abc",
        },
      },
      {
        functionResponse: {
          name: "search_companies",
          response: { result: "not json" },
        },
      },
    ]);
  });
});

describe("Groq projection", () => {
  it("declares only the offered tools as function tools", () => {
    expect(toolsForGroq([TOOL])).toEqual([
      {
        type: "function",
        function: {
          name: "get_company",
          description: "Returns a company profile.",
          parameters: TOOL.inputJsonSchema,
        },
      },
    ]);
  });

  it("maps assistant tool calls and tool results to the OpenAI-style shape", () => {
    expect(
      toMessages([
        { role: "SYSTEM", content: "sys" },
        {
          role: "ASSISTANT",
          content: "",
          toolCalls: [
            {
              callId: "c1",
              name: "get_company",
              arguments: { companyId: "x" },
            },
          ],
        },
        { role: "TOOL", callId: "c1", name: "get_company", content: "{}" },
        { role: "ASSISTANT", content: "done" },
      ]),
    ).toEqual([
      { role: "system", content: "sys" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "get_company", arguments: '{"companyId":"x"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "{}" },
      { role: "assistant", content: "done" },
    ]);
  });
});
