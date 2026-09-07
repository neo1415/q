import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  defineQTool,
  GET_CAPITAL_OBJECTIVE,
  GET_COMPANY,
  GET_INVESTOR_MANDATE,
  SEARCH_COMPANIES,
  type AnyQToolDefinition,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  confidentialTool,
  contextFor,
  explodingTool,
  fakePorts,
  INVESTOR_B,
  malformedOutputTool,
  MARKERS,
  planFor,
} from "./support.js";

/**
 * The registry and the execution pipeline (packet §93-§96) with fake ports.
 * Every step of doc 12 §29 has a test that reaches it and a test that it
 * refuses; nothing internal ever reaches the returned result.
 */

function readTool(
  overrides: Partial<AnyQToolDefinition> = {},
): AnyQToolDefinition {
  return {
    ...defineQTool<{ readonly q: string }, { readonly echo: string }, null>({
      id: "test.read",
      version: 1,
      status: "ACTIVE",
      providerName: "test_read",
      description: "Echoes.",
      classification: "READ_ONLY",
      riskClass: "SAFE_READ",
      requiredCapabilities: [],
      supportedPurposes: ["GENERAL_QUESTION"],
      requiredScopeKinds: [],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "test",
      visibleStage: null,
      input: z.object({ q: z.string().max(10) }).strict(),
      output: z.object({ echo: z.string() }).strict(),
      authorize: () =>
        Promise.resolve({
          outcome: "ALLOW",
          sensitivity: "PUBLIC",
          grant: null,
        }),
      execute: (input) => Promise.resolve({ echo: (input as { q: string }).q }),
    }),
    ...overrides,
  };
}

const general = planFor(actorA, "GENERAL_QUESTION", [
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

describe("tool registry", () => {
  it("registers the four SAFE_READ tools with unique provider names and stable ids", () => {
    const registry = createQToolRegistry(createDefaultQTools(fakePorts()));
    expect(registry.list().map((r) => r.versionId)).toEqual([
      `${GET_CAPITAL_OBJECTIVE}/v1`,
      `${GET_COMPANY}/v1`,
      `${SEARCH_COMPANIES}/v1`,
      `${GET_INVESTOR_MANDATE}/v1`,
    ]);
    for (const record of registry.list()) {
      expect(record.definition.riskClass).toBe("SAFE_READ");
      expect(record.definition.classification).toBe("READ_ONLY");
      expect(record.definition.approval).toBe("NONE");
      const projected = JSON.stringify(record.modelDefinition.inputJsonSchema);
      for (const keyword of ["$schema", "pattern", "format"]) {
        expect(projected, keyword).not.toContain(`"${keyword}"`);
      }
      expect(Object.isFrozen(record)).toBe(true);
    }
    expect(registry.getActive(GET_COMPANY)?.definition.version).toBe(1);
    expect(registry.get(GET_COMPANY, 2)).toBeUndefined();
  });

  it("refuses duplicates, two ACTIVE versions, provider-name clashes and non-SAFE_READ classes", () => {
    const t = readTool();
    expect(() => createQToolRegistry([t, t])).toThrow(/duplicate/);
    expect(() => createQToolRegistry([t, readTool({ version: 2 })])).toThrow(
      /two ACTIVE/,
    );
    expect(() =>
      createQToolRegistry([t, readTool({ id: "test.other" })]),
    ).toThrow(/both project/);
    expect(() =>
      createQToolRegistry([readTool({ riskClass: "CONFIRM_REQUIRED" })]),
    ).toThrow(/SAFE_READ/);
    expect(() =>
      createQToolRegistry([readTool({ classification: "SIDE_EFFECT" })]),
    ).toThrow(/READ_ONLY/);
    expect(() => createQToolRegistry([readTool({ id: "RunSql" })])).toThrow();
  });

  it("offers the minimum set: by purpose, by plan scope kinds, never to a non-human actor, never a DISABLED tool", () => {
    const registry = createQToolRegistry(createDefaultQTools(fakePorts()));
    const names = (plan: ReturnType<typeof planFor>, actor = actorA) =>
      registry
        .eligible(contextFor(actor, plan))
        .map((r) => r.definition.providerName);

    expect(
      names(
        planFor(actorA, "OWN_COMPANY_QUESTION", [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "INTERNAL",
            companyId: COMPANY_A,
          },
          {
            kind: "COMPANY_CAPITAL_OBJECTIVE",
            sensitivity: "CONFIDENTIAL",
            companyId: COMPANY_A,
          },
          { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
        ]),
      ),
    ).toEqual(["get_capital_objective", "get_company", "search_companies"]);
    // No capital scope: no capital tool. No network scope: no search.
    expect(
      names(
        planFor(actorA, "OWN_COMPANY_QUESTION", [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "INTERNAL",
            companyId: COMPANY_A,
          },
        ]),
      ),
    ).toEqual(["get_company"]);
    // Investor question with the mandate scope: the mandate tool, not the capital tool.
    expect(
      names(
        planFor(actorB, "INVESTOR_QUESTION", [
          {
            kind: "INVESTOR_MANDATE",
            sensitivity: "CONFIDENTIAL",
            investorOrganisationId: INVESTOR_B,
          },
        ]),
        actorB,
      ),
    ).toEqual(["get_investor_mandate"]);
    // Action preparation gets nothing from this catalogue.
    expect(names(planFor(actorA, "ACTION_PREPARATION", []))).toEqual([]);
    // Q, system and connected actors are not served.
    expect(names(general, { ...actorA, actorType: "SYSTEM" })).toEqual([]);

    const disabled = createQToolRegistry([readTool({ status: "DISABLED" })]);
    expect(disabled.list()).toHaveLength(1);
    expect(disabled.getActive("test.read")).toBeUndefined();
    expect(disabled.eligible(contextFor(actorA, general))).toEqual([]);
  });
});

describe("tool execution pipeline", () => {
  const build = (tools: readonly AnyQToolDefinition[] = [readTool()]) => {
    const logLines: string[] = [];
    const logger = {
      debug: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
      info: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
      warn: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
      error: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
      child: () => logger,
    };
    const port = createQToolExecutor({
      registry: createQToolRegistry(tools),
      logger,
    });
    return { port, logLines };
  };

  it("runs a valid proposal end to end and reports the sensitivity it returned", async () => {
    const { port, logLines } = build();
    const context = contextFor(actorA, general);
    expect((await port.offer(context)).map((t) => t.definition.name)).toEqual([
      "test_read",
    ]);
    const outcome = await port.execute(
      { callId: "c1", name: "test_read", arguments: { q: "hi" } },
      context,
    );
    expect(outcome).toMatchObject({
      callId: "c1",
      toolName: "test.read",
      toolVersion: 1,
      classification: "READ_ONLY",
      status: "SUCCEEDED",
      failureCode: null,
      sensitivity: "PUBLIC",
      result: { ok: true, data: { echo: "hi" } },
    });
    const log = logLines.join("\n");
    expect(log).toContain('"status":"SUCCEEDED"');
    // Arguments and results are never logged.
    expect(log).not.toContain('"hi"');
  });

  it("refuses a tool that was not offered for this run, before touching its input", async () => {
    const { port } = build();
    const outcome = await port.execute(
      { callId: "c1", name: "run_sql", arguments: { sql: "select 1" } },
      contextFor(actorA, general),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("TOOL_NOT_ELIGIBLE");
    expect(outcome.toolName).toBeNull();
    // Registered but not eligible for this purpose is the same refusal.
    const notForThisPurpose = await port.execute(
      { callId: "c2", name: "test_read", arguments: { q: "x" } },
      contextFor(actorA, planFor(actorA, "ACTION_PREPARATION", [])),
    );
    expect(notForThisPurpose.failureCode).toBe("TOOL_NOT_ELIGIBLE");
  });

  it("validates model-generated arguments like external input and never echoes a value back", async () => {
    const { port } = build();
    const outcome = await port.execute(
      {
        callId: "c1",
        name: "test_read",
        arguments: { q: "MUCH-TOO-LONG-VALUE", extra: true },
      },
      contextFor(actorA, general),
    );
    expect(outcome.status).toBe("FAILED");
    expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
    const text = JSON.stringify(outcome);
    expect(text).toContain("q");
    expect(text).not.toContain("MUCH-TOO-LONG-VALUE");
  });

  it("refuses an actor that does not match the plan it was authorised under", async () => {
    const { port } = build();
    const outcome = await port.execute(
      { callId: "c1", name: "test_read", arguments: { q: "x" } },
      contextFor(actorB, general),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("ACTOR_MISMATCH");
  });

  it("denies data above the plan's sensitivity ceiling, whatever the tool authorised", async () => {
    const { port } = build([confidentialTool()]);
    const capped = planFor(actorA, "GENERAL_QUESTION", [], "INTERNAL");
    const outcome = await port.execute(
      { callId: "c1", name: "confidential", arguments: {} },
      contextFor(actorA, capped),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("SENSITIVITY_NOT_PERMITTED");
    expect(JSON.stringify(outcome)).not.toContain(MARKERS.founder);
    const allowed = await port.execute(
      { callId: "c2", name: "confidential", arguments: {} },
      contextFor(
        actorA,
        planFor(actorA, "GENERAL_QUESTION", [], "CONFIDENTIAL"),
      ),
    );
    expect(allowed.status).toBe("SUCCEEDED");
    expect(allowed.sensitivity).toBe("CONFIDENTIAL");
  });

  it("turns a thrown error into a coded failure whose message stays in the server log", async () => {
    const { port, logLines } = build([explodingTool()]);
    const outcome = await port.execute(
      { callId: "c1", name: "explode", arguments: { x: 1 } },
      contextFor(actorA, general),
    );
    expect(outcome.status).toBe("FAILED");
    expect(outcome.failureCode).toBe("TOOL_INTERNAL_ERROR");
    expect(JSON.stringify(outcome)).not.toContain(MARKERS.internal);
    expect(JSON.stringify(outcome)).not.toContain("boom");
    expect(logLines.join("\n")).toContain("q tool execution threw");
  });

  it("refuses output the tool's own schema rejects", async () => {
    const { port } = build([malformedOutputTool()]);
    const outcome = await port.execute(
      { callId: "c1", name: "malformed", arguments: { x: 1 } },
      contextFor(actorA, general),
    );
    expect(outcome.status).toBe("FAILED");
    expect(outcome.failureCode).toBe("INVALID_TOOL_OUTPUT");
    expect(outcome.result.ok).toBe(false);
  });

  it("honours cancellation before executing", async () => {
    const { port } = build();
    const controller = new AbortController();
    controller.abort();
    const outcome = await port.execute(
      { callId: "c1", name: "test_read", arguments: { q: "x" } },
      contextFor(actorA, general, controller.signal),
    );
    expect(outcome.status).toBe("FAILED");
    expect(outcome.failureCode).toBe("CANCELLED");
  });
});
