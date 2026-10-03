import { z } from "zod";

import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * A declared app action, done by code from the turn's reading (ADR 0040).
 *
 * The parity eval (2026-10-02) found the answer's model, offered 78 tools,
 * describing a Save or a Pass and not calling it (its words removed, the
 * person told "Understood.") and the reader filing "let investors play my
 * pitch" as company visibility. The reading now names the declared action
 * and the words that name its records (`appAction`); code runs that one
 * generated tool through the same executor -- its own authorize step, the
 * same service, an approval card for a CONSEQUENTIAL one -- and says the
 * tool's own line. Nothing here decides what is allowed.
 *
 * The reading's field arrives with the turn-reader version that carries
 * it; until then `appActionOf` finds none and the answer runs as before.
 */

export const TurnAppActionSchema = z
  .object({
    /** A generated tool's provider name, e.g. save_company. */
    tool: z.string().trim().min(1).max(64),
    /** Its model-facing input: names as the person said them. */
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();
export type TurnAppAction = z.infer<typeof TurnAppActionSchema>;

/** The reading's app action, when the reader version carries one. */
export function appActionOf(read: object | null): TurnAppAction | null {
  if (read === null || !("appAction" in read)) return null;
  const parsed = TurnAppActionSchema.safeParse(read.appAction);
  return parsed.success ? parsed.data : null;
}

export type QAppActionPort = {
  /** Tool names that are declared app actions (the registry's). */
  readonly tools: ReadonlySet<string>;
  readonly run: (
    request: QAnswerRequest,
    action: TurnAppAction,
  ) => Promise<string | null>;
};

/** Runs one generated tool, as this run, and returns its own line. */
export function createToolAppActionPort(dependencies: {
  readonly tools: QToolPort;
  readonly names: readonly string[];
  readonly logger?: Logger | undefined;
}): QAppActionPort {
  const names = new Set(dependencies.names);
  return {
    tools: names,
    run: async (request, action) => {
      if (!names.has(action.tool)) return null;
      try {
        const outcome = await dependencies.tools.execute(
          {
            callId: `q-app-action-${action.tool}`,
            name: action.tool,
            arguments: action.arguments,
          },
          {
            actor: request.actor,
            runId: request.runId,
            correlationId: request.correlationId,
            capability: request.capability,
            plan: request.plan,
            // Named by the turn: eligible wherever its scopes hold.
            focus: { areas: [], tools: [action.tool] },
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        if (!outcome.result.ok) return null;
        const data = outcome.result.data as {
          readonly status?: unknown;
          readonly says?: unknown;
        };
        return typeof data.says === "string" && data.says.trim().length > 0
          ? data.says.trim()
          : null;
      } catch (error: unknown) {
        if (request.signal?.aborted === true) throw error;
        dependencies.logger?.warn(
          { err: error, qRunId: request.runId, tool: action.tool },
          "a declared app action read from the turn was not taken",
        );
        return null;
      }
    },
  };
}
