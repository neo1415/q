import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpToolSource, McpConnectorError } from "../src/index.js";

/**
 * The MCP client path, end to end against a real MCP server in memory:
 * the protocol handshake, a tool call, the reply's text and structured
 * halves, and the two things that must not happen — reaching a server
 * that was never approved, and holding a credential anywhere but in the
 * transport.
 */

async function remote() {
  const server = new McpServer({ name: "fake-crm", version: "1" });
  server.registerTool(
    "find_contact",
    { description: "test", inputSchema: z.object({ email: z.string() }) },
    (args) => ({
      content: [{ type: "text", text: `found ${args.email}` }],
      structuredContent: { fullName: "Ada Lovelace" },
    }),
  );
  server.registerTool("broken", { description: "test" }, () => ({
    isError: true,
    content: [{ type: "text", text: "boom" }],
  }));
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  return { server, client };
}

describe("the MCP tool source", () => {
  it("connects to an approved server once and returns a reply's text and structure", async () => {
    const { client } = await remote();
    let transports = 0;
    const source = createMcpToolSource({
      servers: [
        { id: "crm", url: "http://crm.local/mcp", credentialEnv: "CRM_TOKEN" },
      ],
      env: { CRM_TOKEN: "secret-token" },
      transportFor: () => {
        transports += 1;
        return client;
      },
    });
    const first = await source.call({
      server: "crm",
      tool: "find_contact",
      arguments: { email: "ada@example.com" },
    });
    expect(first.isError).toBe(false);
    expect(first.text).toEqual(["found ada@example.com"]);
    expect(first.structured).toEqual({ fullName: "Ada Lovelace" });
    const second = await source.call({
      server: "crm",
      tool: "broken",
      arguments: {},
    });
    expect(second.isError).toBe(true);
    expect(transports).toBe(1);
    await source.close();
  });

  it("refuses a server that was never approved", async () => {
    const source = createMcpToolSource({ servers: [], env: {} });
    await expect(
      source.call({ server: "anything", tool: "x", arguments: {} }),
    ).rejects.toBeInstanceOf(McpConnectorError);
  });

  it("hands the credential to the transport and keeps it nowhere else", async () => {
    const { client } = await remote();
    let seen: string | undefined;
    const source = createMcpToolSource({
      servers: [
        { id: "crm", url: "http://crm.local/mcp", credentialEnv: "CRM_TOKEN" },
      ],
      env: { CRM_TOKEN: "secret-token" },
      transportFor: (_server, credential) => {
        seen = credential;
        return client;
      },
    });
    await source.call({ server: "crm", tool: "broken", arguments: {} });
    expect(seen).toBe("secret-token");
    expect(JSON.stringify(source)).not.toContain("secret-token");
    await source.close();
  });
});
