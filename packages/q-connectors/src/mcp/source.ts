import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { Logger } from "@capital-q/observability";

/**
 * Q as an MCP client (doc 12 §34.1): the one place Capital Q speaks the
 * Model Context Protocol outward.
 *
 * An approved server is declared in source, by id, with the environment
 * variable that holds its credential. The value is read at composition and
 * handed to the transport; it is never stored on the registration, never
 * logged and never returned. Which of the server's tools Q may call, and
 * with what shape, is not decided here: each approved remote tool is its
 * own source-controlled Capital Q tool (`defineMcpTool`), registered in
 * the Tool Registry and subject to the same authorize step, purpose and
 * scope policy as every other tool. MCP authorization does not replace
 * Capital Q authorization.
 *
 * What a remote tool answers is data (CLAUDE.md: retrieved content is
 * never instruction authority). It is validated against the Capital Q
 * tool's output schema before a model sees it, and a remote error is a
 * stable code, never the remote's text.
 */

export type McpServerRegistration = {
  /** Stable identifier used by tool definitions: lower_snake_case. */
  readonly id: string;
  /** The server's Streamable HTTP endpoint. https outside local work. */
  readonly url: string;
  /**
   * Name of the environment variable holding the bearer credential, when
   * the server needs one. The variable's VALUE is read once, at
   * composition, and never appears on this object.
   */
  readonly credentialEnv?: string | undefined;
};

export type McpToolReply = {
  readonly isError: boolean;
  /** Text blocks, in order. Other block kinds are dropped: Q reads text. */
  readonly text: readonly string[];
  /** The structured result, when the server sent one. */
  readonly structured: unknown;
};

export type McpToolCall = {
  readonly server: string;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly signal?: AbortSignal | undefined;
};

/** The port a Capital Q tool definition calls. Fakeable; no SDK type escapes. */
export type McpToolSource = {
  readonly call: (call: McpToolCall) => Promise<McpToolReply>;
  readonly close: () => Promise<void>;
};

/**
 * Thrown for anything that is not a tool result: an unknown server, a
 * connection that failed, a reply that was not a reply. The message is
 * one safe sentence; the cause stays server-side.
 */
export class McpConnectorError extends Error {
  readonly code: "UNKNOWN_SERVER" | "UNREACHABLE" | "INVALID_REPLY";

  constructor(
    code: McpConnectorError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? {} : { cause });
    this.name = "McpConnectorError";
    this.code = code;
  }
}

const CLIENT_NAME = "capital-q";
const CLIENT_VERSION = "1";

export type McpToolSourceOptions = {
  readonly servers: readonly McpServerRegistration[];
  /** Where credentials are read from. Defaults to the process environment. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /**
   * How to reach a server. Defaults to Streamable HTTP over the platform
   * fetch; a test hands in an in-memory transport to a real server.
   */
  readonly transportFor?:
    | ((
        server: McpServerRegistration,
        credential: string | undefined,
      ) => Transport)
    | undefined;
  readonly logger?: Logger | undefined;
};

function textBlocks(content: unknown): readonly string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block !== null &&
    typeof block === "object" &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
      ? [(block as { text: string }).text]
      : [],
  );
}

export function createMcpToolSource(
  options: McpToolSourceOptions,
): McpToolSource {
  const env = options.env ?? process.env;
  const logger = options.logger;
  const registrations = new Map(
    options.servers.map((server) => [server.id, server] as const),
  );
  const clients = new Map<string, Promise<Client>>();

  const transportFor =
    options.transportFor ??
    ((server: McpServerRegistration, credential: string | undefined) =>
      // The SDK's own transport satisfies its own Transport interface; the
      // assertion only reconciles its optional `sessionId` with this
      // repository's exact-optional setting.
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit:
          credential === undefined
            ? {}
            : { headers: { authorization: `Bearer ${credential}` } },
      }) as Transport);

  const connect = async (server: McpServerRegistration): Promise<Client> => {
    const credential =
      server.credentialEnv === undefined
        ? undefined
        : env[server.credentialEnv];
    if (server.credentialEnv !== undefined && credential === undefined) {
      logger?.warn(
        { mcpServer: server.id, credentialEnv: server.credentialEnv },
        "mcp server credential is not configured; connecting without one",
      );
    }
    const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
    await client.connect(transportFor(server, credential));
    logger?.info({ mcpServer: server.id }, "mcp server connected");
    return client;
  };

  const clientFor = (server: McpServerRegistration): Promise<Client> => {
    const existing = clients.get(server.id);
    if (existing !== undefined) return existing;
    const created = connect(server).catch((error: unknown) => {
      // A failed connection is not cached; the next call tries again.
      clients.delete(server.id);
      throw new McpConnectorError(
        "UNREACHABLE",
        "The connector could not be reached.",
        error,
      );
    });
    clients.set(server.id, created);
    return created;
  };

  return {
    call: async (call) => {
      const server = registrations.get(call.server);
      if (server === undefined) {
        throw new McpConnectorError(
          "UNKNOWN_SERVER",
          "No such connector is approved.",
        );
      }
      const client = await clientFor(server);
      let raw: unknown;
      try {
        raw = await client.callTool(
          { name: call.tool, arguments: call.arguments },
          undefined,
          call.signal === undefined ? {} : { signal: call.signal },
        );
      } catch (error: unknown) {
        // Whatever failed, the cached client is not trusted afterwards:
        // a dropped session reconnects on the next call.
        clients.delete(server.id);
        throw new McpConnectorError(
          "UNREACHABLE",
          "The connector did not answer.",
          error,
        );
      }
      if (raw === null || typeof raw !== "object") {
        throw new McpConnectorError(
          "INVALID_REPLY",
          "The connector's reply was not a tool result.",
        );
      }
      const reply = raw as {
        readonly isError?: unknown;
        readonly content?: unknown;
        readonly structuredContent?: unknown;
      };
      return {
        isError: reply.isError === true,
        text: textBlocks(reply.content),
        structured: reply.structuredContent,
      };
    },
    close: async () => {
      const open = [...clients.values()];
      clients.clear();
      await Promise.all(
        open.map((pending) =>
          pending.then((client) => client.close()).catch(() => undefined),
        ),
      );
    },
  };
}
