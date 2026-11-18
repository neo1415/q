import { describe, expect, it } from "vitest";

import type {
  ModelMessage,
  ModelToolDefinition,
  ModelGatewayRequestInput,
} from "@capital-q/contracts";
import type { QOfferedTool } from "@capital-q/q-runtime";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  isModelGatewayError,
} from "../src/index.js";
import { promptCacheKeyOf } from "../src/gateway.js";
import { createOpenAIModelProvider, toInput } from "../src/providers/openai.js";
import { notOfferedThisTurn, toolBlockFor } from "../src/q/tool-order.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * Model spend, 18 Nov 2026 (ai_ops.model_usage, 7 days): 73% of first
 * answer calls read nothing from the provider's prompt cache. The cache key
 * carried the turn's tool list and the person, and the per-person charter
 * tail sat ahead of the tools. Now: the fixed instructions (marked shared),
 * then the plan class's whole catalogue in one order, then the person's
 * private instructions, then the turn. What a turn may call is enforced in
 * code, never by changing the list.
 */

const tool = (name: string): ModelToolDefinition => ({
  name,
  description: `The ${name} tool.`,
  inputJsonSchema: { type: "object", properties: {} },
});
const offered = (name: string): QOfferedTool => ({
  toolName: `t.${name}`,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: tool(name),
  visibleStage: null,
});

const CATALOGUE = ["get_company", "fit_profile", "use_capability", "search"];
const CHARTER_HEAD = "You are Q. Fixed charter text, the same for everyone.";
const RULES = "TASK: fixed rules, the same for everyone.";
/** A person's own words and context: must never sit in the shared part. */
const PRIVATE_MARK = "Ada Example prefers short answers; mandate 7f3e9";

function messagesFor(person: string, turn: string): ModelMessage[] {
  return [
    { role: "SYSTEM", content: CHARTER_HEAD, shared: true },
    { role: "SYSTEM", content: RULES, shared: true },
    { role: "SYSTEM", content: `ENVIRONMENT\n${person}` },
    { role: "USER", content: turn },
  ];
}

describe("the analyst's tool block", () => {
  it("is byte-identical across turns that allow different tools", () => {
    const catalogue = CATALOGUE.map(offered);
    const first = toolBlockFor(
      catalogue,
      ["get_company", "use_capability"].map(offered),
      128,
    );
    const second = toolBlockFor(
      catalogue,
      ["search", "fit_profile", "get_company"].map(offered),
      128,
    );
    expect(JSON.stringify(first.tools)).toBe(JSON.stringify(second.tools));
    expect(first.tools.map((t) => t.name)).toEqual([
      "fit_profile",
      "get_company",
      "search",
      "use_capability",
    ]);
    expect(first.allowedTools).toEqual(["get_company", "use_capability"]);
    expect(second.allowedTools).toEqual([
      "fit_profile",
      "get_company",
      "search",
    ]);
  });

  it("sends a focused offer (under half the catalogue) alone, where padding it would cost more", () => {
    const block = toolBlockFor(
      CATALOGUE.map(offered),
      ["search"].map(offered),
      128,
    );
    expect(block.tools.map((t) => t.name)).toEqual(["search"]);
    expect(block.allowedTools).toBeUndefined();
  });

  it("keeps the catalogue's prefix when a turn loads a tool outside it", () => {
    const catalogue = CATALOGUE.map(offered);
    const block = toolBlockFor(
      catalogue,
      ["search", "propose_reminder"].map(offered),
      128,
    );
    expect(block.tools.map((t) => t.name)).toEqual([
      "fit_profile",
      "get_company",
      "search",
      "use_capability",
      "propose_reminder",
    ]);
    expect(block.allowedTools).toEqual(["propose_reminder", "search"]);
  });

  it("over the bound, drops catalogue tools this turn does not allow first", () => {
    const block = toolBlockFor(
      CATALOGUE.map(offered),
      ["search", "extra_one"].map(offered),
      4,
    );
    expect(block.tools).toHaveLength(4);
    expect(block.tools.map((t) => t.name)).toContain("search");
    expect(block.tools.map((t) => t.name)).toContain("extra_one");
  });

  it("sends the offer alone without a catalogue or on a turn that offers nothing", () => {
    expect(
      toolBlockFor(null, ["search"].map(offered), 128).allowedTools,
    ).toBeUndefined();
    expect(toolBlockFor(CATALOGUE.map(offered), [], 128).tools).toEqual([]);
  });

  it("refuses a catalogue tool this turn does not offer, without running it", () => {
    const outcome = notOfferedThisTurn({
      callId: "c1",
      name: "fit_profile",
      arguments: {},
    });
    expect(outcome.status).toBe("DENIED");
    expect(outcome.toolName).toBeNull();
    expect(outcome.result.ok).toBe(false);
  });
});

function build(restrictsTools: boolean, script: "TEXT" | "OFF_TURN_CALL") {
  const catalog = testCatalog((s) => ({
    ...s,
    models: s.models.map((m) => ({
      ...m,
      supportsTools: true,
      supportsPromptCache: true,
    })),
  }));
  const alpha = createFakeModelProvider({
    code: "alpha",
    capabilities: { restrictsTools },
    script: Array.from({ length: 8 }, () =>
      script === "TEXT"
        ? { kind: "TEXT" as const, text: "ok" }
        : {
            kind: "TOOL_CALLS" as const,
            calls: [{ callId: "c1", name: "fit_profile", arguments: {} }],
          },
    ),
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  return { gateway, alpha };
}

function turnRequest(
  overrides: Partial<ModelGatewayRequestInput>,
): ModelGatewayRequestInput {
  return request({
    tools: CATALOGUE.map(tool),
    allowedTools: ["get_company", "search"],
    messages: messagesFor(PRIVATE_MARK, "What does Halyard do?"),
    ...overrides,
  });
}

describe("the gateway with a stable catalogue", () => {
  it("sends the whole catalogue and the allowance to an adapter that can restrict", async () => {
    const { gateway, alpha } = build(true, "TEXT");
    await gateway.execute(turnRequest({}));
    const sent = alpha.calls[0]?.request;
    expect(sent?.tools.map((t) => t.name)).toEqual(CATALOGUE);
    expect(sent?.allowedTools).toEqual(["get_company", "search"]);
  });

  it("sends only the allowed tools to any other adapter", async () => {
    const { gateway, alpha } = build(false, "TEXT");
    await gateway.execute(turnRequest({}));
    const sent = alpha.calls[0]?.request;
    expect(sent?.tools.map((t) => t.name)).toEqual(["get_company", "search"]);
    expect(sent?.allowedTools).toBeUndefined();
  });

  it("refuses a proposal for a catalogue tool this turn does not allow", async () => {
    const { gateway } = build(true, "OFF_TURN_CALL");
    const error: unknown = await gateway.execute(turnRequest({})).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isModelGatewayError(error)).toBe(true);
    expect(isModelGatewayError(error) && error.failureClass).toBe(
      "INVALID_MODEL_OUTPUT",
    );
  });

  it("refuses an allowance naming a tool it was not sent", async () => {
    const { gateway } = build(true, "TEXT");
    await expect(
      gateway.execute(turnRequest({ allowedTools: ["not_sent"] })),
    ).rejects.toThrow();
  });
});

describe("the shared prompt-cache key", () => {
  const OTHER_USER = "55555555-5555-4555-8555-555555555555";
  const OTHER_TENANT = "66666666-6666-4666-8666-666666666666";

  async function keyOf(input: ModelGatewayRequestInput): Promise<string> {
    const { gateway, alpha } = build(true, "TEXT");
    await gateway.execute(input);
    const key = alpha.calls[0]?.request.cacheKey;
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    return key ?? "";
  }

  it("is one key for every person, turn and allowance of a task's shared prefix", async () => {
    const base = await keyOf(turnRequest({}));
    const other = request();
    const otherPerson = await keyOf(
      turnRequest({
        allowedTools: ["use_capability"],
        messages: messagesFor("Someone else entirely", "Another turn."),
        attribution: {
          ...other.attribution,
          tenantId: OTHER_TENANT,
          userId: OTHER_USER,
        },
      }),
    );
    expect(otherPerson).toBe(base);
  });

  it("changes with the shared instructions, never with the tools", async () => {
    const base = await keyOf(turnRequest({}));
    const rules = messagesFor(PRIVATE_MARK, "Q");
    rules[1] = { role: "SYSTEM", content: `${RULES} v2`, shared: true };
    expect(await keyOf(turnRequest({ messages: rules }))).not.toBe(base);
    expect(
      await keyOf(turnRequest({ tools: [tool("search")], allowedTools: [] })),
    ).toBe(base);
  });

  it("keeps the per-person key, also given to the adapter, for a request with no shared instructions", async () => {
    const { gateway, alpha } = build(true, "TEXT");
    await gateway.execute(request({ tools: [tool("search")] }));
    const sent = alpha.calls[0]?.request;
    expect(sent?.cacheKey).toBe(sent?.personCacheKey);
    expect(sent?.cacheKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it("holds no private value: the key is a function of shared text, task class and tool names only", () => {
    const at = (person: string) =>
      promptCacheKeyOf({
        ...(request() as Parameters<typeof promptCacheKeyOf>[0]),
        tools: CATALOGUE.map(tool),
        allowedTools: undefined,
        requiredCapabilities: [],
        reasoning: "NONE",
        dataPosture: "REAL_CUSTOMER",
        messages: messagesFor(person, "turn"),
      });
    expect(at(PRIVATE_MARK)).toBe(at("someone else"));
  });
});

describe("the OpenAI adapter's order", () => {
  it("sends only the shared instructions as instructions; the private tail follows the tools", () => {
    const { instructions, input } = toInput(
      messagesFor(PRIVATE_MARK, "What does Halyard do?"),
    );
    expect(instructions).toBe(`${CHARTER_HEAD}\n\n${RULES}`);
    expect(instructions).not.toContain(PRIVATE_MARK);
    expect(input[0]).toEqual({
      role: "developer",
      content: [{ type: "input_text", text: `ENVIRONMENT\n${PRIVATE_MARK}` }],
    });
    expect(JSON.stringify(input[1])).toContain("What does Halyard do?");
  });

  it("is unchanged for messages with nothing marked shared", () => {
    const { instructions, input } = toInput([
      { role: "SYSTEM", content: "Charter." },
      { role: "SYSTEM", content: "Tail." },
      { role: "USER", content: "Hi" },
    ]);
    expect(instructions).toBe("Charter.\n\nTail.");
    expect(input).toHaveLength(1);
  });

  type AdapterClient = NonNullable<
    Parameters<typeof createOpenAIModelProvider>[0]["client"]
  >;

  async function bodyFor(allowedTools: readonly string[] | undefined) {
    const bodies: Record<string, unknown>[] = [];
    const client = {
      responses: {
        create: (body: Record<string, unknown>) => {
          bodies.push(body);
          return Promise.resolve({
            id: "resp_1",
            model: "gpt-5.6-luna",
            status: "completed",
            output_text: "ok",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "ok", annotations: [] }],
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
            },
          });
        },
      },
    } as unknown as AdapterClient;
    const provider = createOpenAIModelProvider({ apiKey: "unused", client });
    expect(provider.capabilities().restrictsTools).toBe(true);
    await provider.generate(
      {
        modelCode: "gpt-5.6-luna",
        messages: messagesFor(PRIVATE_MARK, "Is it?"),
        tools: CATALOGUE.map(tool),
        ...(allowedTools === undefined ? {} : { allowedTools }),
        maxOutputTokens: 100,
        temperature: undefined,
        reasoning: "NONE",
        output: { kind: "TEXT" },
      },
      {
        signal: new AbortController().signal,
        attemptTimeoutMs: 1000,
        attempt: 1,
        correlationId: "cor_test",
      },
    );
    return bodies[0];
  }

  it("sends the same instructions and tools whatever the turn allows, and the allowance as tool_choice", async () => {
    const one = await bodyFor(["search"]);
    const two = await bodyFor(["get_company", "use_capability"]);
    expect(JSON.stringify(one?.["instructions"])).toBe(
      JSON.stringify(two?.["instructions"]),
    );
    expect(JSON.stringify(one?.["tools"])).toBe(JSON.stringify(two?.["tools"]));
    expect(one?.["tool_choice"]).toEqual({
      type: "allowed_tools",
      mode: "auto",
      tools: [{ type: "function", name: "search" }],
    });
    expect(JSON.stringify(one?.["instructions"])).not.toContain(PRIVATE_MARK);
    expect(JSON.stringify(one?.["tools"])).not.toContain(PRIVATE_MARK);
  });

  it("allows no call when the turn allows none, and sets no tool_choice without an allowance", async () => {
    expect((await bodyFor([]))?.["tool_choice"]).toBe("none");
    expect(await bodyFor(undefined)).not.toHaveProperty("tool_choice");
  });
});
