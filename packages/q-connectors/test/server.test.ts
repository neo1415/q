import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createQToolExecutor, createQToolRegistry } from "@capital-q/q-tools";

import { createQMcpServer } from "../src/index.js";
import { contextWith, fakeLookupTool, planWith } from "./support.js";

/**
 * Q as an MCP server: a host sees only what the registry offers this
 * person's plan, and a call goes through the execution pipeline.
 */

async function host(kinds: readonly string[]) {
  const registry = createQToolRegistry([fakeLookupTool()]);
  const tools = createQToolExecutor({ registry });
  const server = createQMcpServer({
    registry,
    tools,
    context: contextWith(planWith(kinds)),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "host", version: "1" });
  await client.connect(clientSide);
  return client;
}

describe("Q as an MCP server", () => {
  it("lists exactly the tools the plan admits", async () => {
    const admitted = await host(["NETWORK_VISIBLE_DATA"]);
    expect((await admitted.listTools()).tools.map((t) => t.name)).toEqual([
      "lookup_company",
    ]);
    const bare = await host(["COMPANY_PROFILE"]);
    expect((await bare.listTools()).tools).toEqual([]);
  });

  it("executes through the pipeline and returns the bounded result", async () => {
    const client = await host(["NETWORK_VISIBLE_DATA"]);
    const result = await client.callTool({
      name: "lookup_company",
      arguments: { companyId: "c-1" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ name: "Company c-1" });
  });

  it("answers a bad argument with the pipeline's code, not an exception", async () => {
    const client = await host(["NETWORK_VISIBLE_DATA"]);
    const result = await client.callTool({
      name: "lookup_company",
      arguments: { nope: 1 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("INVALID_ARGUMENTS");
  });
});
