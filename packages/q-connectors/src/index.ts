/**
 * @capital-q/q-connectors
 *
 * Owns: where Q's typed tools meet the outside protocols (doc 12 §34-§35).
 *
 *   - Q as MCP client: an approved server declared in source, and each
 *     approved remote tool written down as a Capital Q tool with its own
 *     Zod input and output, purpose list, scope requirement and
 *     sensitivity, registered in the Tool Registry like any other.
 *   - Q as MCP server: a constrained façade over the registry's eligible
 *     tools for an authenticated person, executed through the same
 *     pipeline a Q run uses.
 *   - The LangChain projection of the registry, for graph nodes.
 *
 * Does not own: which servers are approved (a composition root's
 * decision, reviewed), credentials (read from the environment at
 * composition, never held), authorisation (the Tool Registry and the
 * Context Firewall), or any write. MCP authorization does not replace
 * Capital Q authorization; a remote tool's answer is data, never
 * instruction.
 *
 * Server-side only.
 */

export {
  createMcpToolSource,
  McpConnectorError,
  type McpServerRegistration,
  type McpToolCall,
  type McpToolReply,
  type McpToolSource,
  type McpToolSourceOptions,
} from "./mcp/source.js";
export { defineMcpTool, type McpToolOptions } from "./mcp/remote-tool.js";
export {
  createQMcpServer,
  handleQMcpRequest,
  Q_MCP_SERVER_NAME,
  Q_MCP_SERVER_VERSION,
  type QMcpServerOptions,
} from "./mcp/server.js";
export {
  toLangChainTools,
  type LangChainToolsOptions,
} from "./langchain/tools.js";

export const PACKAGE_NAME = "@capital-q/q-connectors" as const;
