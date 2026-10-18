import { describe, expect, it } from "vitest";

import { createQToolExecutor, createQToolRegistry } from "@capital-q/q-tools";

import { toLangChainTools } from "../src/index.js";
import { contextWith, fakeLookupTool, planWith } from "./support.js";

/**
 * The registry as LangChain tools: the same offer, the same pipeline,
 * the pipeline's outcome as the tool's string result.
 */
describe("the LangChain projection of the registry", () => {
  it("projects the eligible tools and executes through the pipeline", async () => {
    const registry = createQToolRegistry([fakeLookupTool()]);
    const tools = createQToolExecutor({ registry });
    const projected = toLangChainTools({
      registry,
      tools,
      context: contextWith(planWith(["NETWORK_VISIBLE_DATA"])),
    });
    expect(projected.map((t) => t.name)).toEqual(["lookup_company"]);
    const only = projected[0];
    if (only === undefined) throw new Error("no tool");
    const result: unknown = await only.invoke({ companyId: "c-7" });
    expect(JSON.parse(String(result))).toEqual({
      ok: true,
      data: { name: "Company c-7" },
    });
  });

  it("projects nothing for a plan the registry offers nothing to", () => {
    const registry = createQToolRegistry([fakeLookupTool()]);
    const tools = createQToolExecutor({ registry });
    expect(
      toLangChainTools({
        registry,
        tools,
        context: contextWith(planWith(["COMPANY_PROFILE"])),
      }),
    ).toEqual([]);
  });
});
