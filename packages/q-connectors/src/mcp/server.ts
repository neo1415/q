import { randomUUID } from "node:crypto";

import type { IncomingMessage, ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Logger } from "@capital-q/observability";
import type { QToolExecutionContext, QToolPort } from "@capital-q/q-runtime";
import type { QToolRegistry } from "@capital-q/q-tools";

/**
 * Q as an MCP server (doc 12 §34.2): a constrained façade.
 *
 * A compatible host that has authenticated as a person sees exactly the
 * tools the Tool Registry would offer that person's plan, under the names
 * a model sees, and nothing else: no internal tool, no catalogue, no
 * write. Every call goes through the same execution pipeline a Q run's
 * proposal does (validate → actor → authorize → sensitivity → execute →
 * validate output), because this IS a proposal, from a different modality.
 * Modality is not authority.
 *
 * One server per authenticated request, built over that request's
 * firewall plan, so nothing here remembers a person between calls.
 */

export const Q_MCP_SERVER_NAME = "capital-q";
export const Q_MCP_SERVER_VERSION = "1";

export type QMcpServerOptions = {
  readonly registry: QToolRegistry;
  readonly tools: QToolPort;
  /** The authenticated person's plan-bearing context for this request. */
  readonly context: QToolExecutionContext;
  readonly logger?: Logger | undefined;
};

function asResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    ...(data !== null && typeof data === "object" && !Array.isArray(data)
      ? { structuredContent: data as Record<string, unknown> }
      : {}),
  };
}

function asError(code: string, safeMessage: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${safeMessage}` }],
  };
}

/**
 * Serve one HTTP request to the façade: stateless, answering in JSON.
 *
 * There is no session to keep because there is no server to keep; the
 * person is re-authenticated and re-planned on every request, which is
 * the point. The app that mounts this hands over the raw request and
 * response (and the body it already parsed) and depends on nothing of
 * the SDK itself.
 */
export async function handleQMcpRequest(
  options: QMcpServerOptions & {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
    /** The JSON body the web framework already parsed, if it did. */
    readonly body?: unknown;
  },
): Promise<void> {
  const { request, response, body, ...server } = options;
  const mcp = createQMcpServer(server);
  // No session id generator is what the SDK calls stateless mode. The
  // SDK's own transport satisfies its own Transport interface; the
  // assertion reconciles an optional field with this repository's
  // exact-optional setting.
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  response.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport as Transport);
  await transport.handleRequest(request, response, body);
}

export function createQMcpServer(options: QMcpServerOptions): McpServer {
  const { registry, tools, context, logger } = options;
  const server = new McpServer(
    { name: Q_MCP_SERVER_NAME, version: Q_MCP_SERVER_VERSION },
    // Declared even when the plan admits nothing: a host asking for the
    // tool list is told "none", not "no such method".
    { capabilities: { tools: {} } },
  );
  const eligible = registry.eligible(context);
  if (eligible.length === 0) {
    // The SDK wires its list handler when the first tool is registered;
    // a plan that admits none must still be told "none" rather than "no
    // such method".
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [],
    }));
  }
  for (const record of eligible) {
    const { definition } = record;
    server.registerTool(
      definition.providerName,
      {
        description: definition.description,
        // Loose at the protocol edge on purpose: the executor validates
        // the arguments against the tool's own schema and answers a bad
        // one with INVALID_ARGUMENTS, exactly as it answers a model.
        inputSchema: z.object({}).passthrough(),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (args, extra) => {
        const outcome = await tools.execute(
          {
            callId: randomUUID(),
            name: definition.providerName,
            arguments: args,
          },
          { ...context, signal: extra.signal },
        );
        logger?.info(
          {
            qRunId: context.runId,
            tool: outcome.toolName,
            status: outcome.status,
            failureCode: outcome.failureCode,
            modality: "MCP",
          },
          "mcp tool call finished",
        );
        return outcome.result.ok
          ? asResult(outcome.result.data)
          : asError(
              outcome.result.error.code,
              outcome.result.error.safeMessage,
            );
      },
    );
  }
  return server;
}
