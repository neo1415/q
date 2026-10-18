import type { z } from "zod";

import type {
  ModelToolName,
  QKnowledgeScopeKind,
  QSensitivityClass,
  QTaskClass,
  QToolName,
  QVisibleStage,
} from "@capital-q/contracts";
import type { QToolExecutionContext } from "@capital-q/q-runtime";
import {
  allow,
  defineQTool,
  deny,
  planScopeKinds,
  type AnyQToolDefinition,
  type QToolAuthorization,
  type QToolStatus,
} from "@capital-q/q-tools";
import type { Capability } from "@capital-q/security";

import type { McpToolReply, McpToolSource } from "./source.js";

/**
 * One approved remote MCP tool, as a Capital Q tool.
 *
 * The remote server advertises its own schema; Capital Q does not take
 * it. Each approved tool is written down here with Zod input and output
 * of Capital Q's choosing, a purpose list, the scope kinds a plan must
 * hold, and the sensitivity of what comes back. That is what the Tool
 * Registry requires of every tool (doc 12 §33), and it is what keeps a
 * server's `tools/list` from becoming a catalogue Q can call at will: a
 * tool the server adds tomorrow does not exist to Q until somebody defines
 * it here, in a reviewed change.
 *
 * Only SAFE_READ. A remote write is a consequential action and belongs
 * behind the Approval Engine, which has no MCP executor yet; the registry
 * refuses anything else at composition.
 */
export type McpToolOptions<I extends Record<string, unknown>, O> = {
  readonly id: QToolName;
  readonly version: number;
  readonly status?: QToolStatus | undefined;
  readonly providerName: ModelToolName;
  readonly description: string;
  /** The approved server's registration id. */
  readonly server: string;
  /** The tool's name on that server. */
  readonly remoteTool: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly supportedPurposes: readonly QTaskClass[];
  /** The plan must hold at least one of these for the tool to be offered or served. */
  readonly requiredScopeKinds: readonly QKnowledgeScopeKind[];
  /** The sensitivity class of what the remote returns. */
  readonly sensitivity: QSensitivityClass;
  readonly requiredCapabilities?: readonly Capability[] | undefined;
  readonly owner: string;
  readonly visibleStage?: QVisibleStage | null | undefined;
  /**
   * Further authorisation beyond the plan check, when the remote data
   * belongs to somebody in particular (a CRM record, a file). Runs after
   * the plan check; an ALLOW here still cannot exceed the plan's ceiling.
   */
  readonly authorize?:
    | ((
        input: I,
        context: QToolExecutionContext,
      ) => Promise<QToolAuthorization<null>>)
    | undefined;
  /**
   * How a reply becomes the output value. The default takes the structured
   * result when the server sent one, otherwise the first text block parsed
   * as JSON, otherwise the text itself. The output schema still decides.
   */
  readonly read?: ((reply: McpToolReply) => unknown) | undefined;
};

function defaultRead(reply: McpToolReply): unknown {
  if (reply.structured !== undefined) return reply.structured;
  const first = reply.text[0];
  if (first === undefined) return undefined;
  try {
    return JSON.parse(first);
  } catch {
    return first;
  }
}

export function defineMcpTool<I extends Record<string, unknown>, O>(
  source: McpToolSource,
  options: McpToolOptions<I, O>,
): AnyQToolDefinition {
  const read = options.read ?? defaultRead;
  return defineQTool<I, O, null>({
    id: options.id,
    version: options.version,
    status: options.status ?? "ACTIVE",
    providerName: options.providerName,
    description: options.description,
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: options.requiredCapabilities ?? [],
    supportedPurposes: options.supportedPurposes,
    requiredScopeKinds: options.requiredScopeKinds,
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: options.owner,
    visibleStage: options.visibleStage ?? null,
    input: options.input,
    output: options.output,
    authorize: async (input, context) => {
      if (context.actor.actorType !== "HUMAN") {
        return deny("NOT_AVAILABLE");
      }
      const held = planScopeKinds(context.plan);
      if (
        options.requiredScopeKinds.length > 0 &&
        !options.requiredScopeKinds.some((kind) => held.has(kind))
      ) {
        return deny("NOT_AVAILABLE");
      }
      if (options.authorize !== undefined) {
        const further = await options.authorize(input, context);
        if (further.outcome === "DENY") return further;
      }
      return allow(options.sensitivity, null);
    },
    // Only the validated input leaves: the executor parsed it against
    // `input` before this runs, so a model's raw argument never travels.
    execute: async (input, context) => {
      const reply = await source.call({
        server: options.server,
        tool: options.remoteTool,
        arguments: input,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      if (reply.isError) {
        // The remote's own text is not for the model. The executor turns
        // this into TOOL_INTERNAL_ERROR with one safe sentence.
        throw new Error("remote tool reported an error");
      }
      return read(reply) as O;
    },
  });
}
