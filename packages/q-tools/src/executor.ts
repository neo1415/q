import {
  MODEL_TOOL_RESULT_MAX_CHARS,
  sensitivityWithin,
} from "@capital-q/contracts";
import { getMeter, getTracer, type Logger } from "@capital-q/observability";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";

import {
  NOT_AVAILABLE_MESSAGE,
  QToolArgumentError,
  type QToolFailureCode,
} from "./definition.js";
import {
  toOfferedTool,
  type QToolRecord,
  type QToolRegistry,
} from "./registry.js";

/**
 * The tool execution pipeline (doc 12 §29; doc 15 §50-52):
 *
 *   model proposes → offered for THIS run? → schema validation of the
 *   arguments (exactly like external input) → actor/tenant against the
 *   plan → cancellation → the tool's own authorize (capability,
 *   disclosure, plan scope) → sensitivity within the plan's ceiling →
 *   deterministic execute through the owning domain's port → output
 *   validation → bounded, sanitised result → back to the model as data
 *
 * Nothing skips a step because the model asked nicely; nothing that goes
 * wrong reaches the model as anything but a stable code and one safe
 * sentence. What is logged: tool, version, status, code, latency, run.
 * What is never logged or returned: arguments, results, thrown messages.
 */

export type QToolExecutorDependencies = {
  readonly registry: QToolRegistry;
  readonly logger?: Logger | undefined;
  readonly clock?: (() => number) | undefined;
};

function failed(
  proposal: QToolProposal,
  record: QToolRecord | undefined,
  status: "DENIED" | "FAILED",
  code: QToolFailureCode,
  safeMessage: string,
  latencyMs: number,
): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName: record?.definition.id ?? null,
    toolVersion: record?.definition.version ?? null,
    classification: record?.definition.classification ?? null,
    status,
    failureCode: code,
    sensitivity: null,
    result: { ok: false, error: { code, safeMessage } },
    latencyMs,
  };
}

/** Read fresh each time: control-flow narrowing must not cache an earlier answer. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/** Issue paths only: a model-generated value never travels back as text. */
function argumentIssues(issues: readonly { path: PropertyKey[] }[]): string {
  const paths = [
    ...new Set(
      issues.map((issue) =>
        issue.path.length === 0
          ? "(root)"
          : issue.path.map((p) => String(p)).join("."),
      ),
    ),
  ].slice(0, 8);
  return `Arguments are invalid at: ${paths.join(", ")}.`;
}

export function createQToolExecutor(
  dependencies: QToolExecutorDependencies,
): QToolPort {
  const { registry, logger } = dependencies;
  const now = dependencies.clock ?? (() => Date.now());
  const tracer = getTracer("@capital-q/q-tools");
  const meter = getMeter("@capital-q/q-tools");
  const metrics = {
    calls: meter.createCounter("q.tool.calls"),
    latencyMs: meter.createHistogram("q.tool.latency_ms"),
  };

  const finish = (
    context: QToolExecutionContext,
    outcome: QToolCallOutcome,
  ): QToolCallOutcome => {
    const labels = {
      tool: outcome.toolName ?? "unknown",
      status: outcome.status,
      failure_code: outcome.failureCode ?? "none",
    };
    metrics.calls.add(1, labels);
    metrics.latencyMs.record(outcome.latencyMs, labels);
    logger?.info(
      {
        qRunId: context.runId,
        correlationId: context.correlationId,
        tool: outcome.toolName,
        toolVersion: outcome.toolVersion,
        classification: outcome.classification,
        status: outcome.status,
        failureCode: outcome.failureCode,
        sensitivity: outcome.sensitivity,
        latencyMs: outcome.latencyMs,
      },
      "q tool call finished",
    );
    return outcome;
  };

  async function execute(
    proposal: QToolProposal,
    context: QToolExecutionContext,
  ): Promise<QToolCallOutcome> {
    const started = now();
    const elapsed = () => Math.max(0, now() - started);
    const record = registry.offeredByProviderName(context, proposal.name);
    if (record === undefined) {
      return finish(
        context,
        failed(
          proposal,
          undefined,
          "DENIED",
          "TOOL_NOT_ELIGIBLE",
          "That tool is not available in this conversation.",
          elapsed(),
        ),
      );
    }
    const { definition } = record;
    return tracer.startActiveSpan(
      "q.tool.execute",
      {
        attributes: {
          "q.tool.id": definition.id,
          "q.tool.version": definition.version,
          "q.run_id": context.runId,
        },
      },
      async (span) => {
        try {
          const parsed = definition.input.safeParse(proposal.arguments);
          if (!parsed.success) {
            return finish(
              context,
              failed(
                proposal,
                record,
                "FAILED",
                "INVALID_ARGUMENTS",
                argumentIssues(parsed.error.issues),
                elapsed(),
              ),
            );
          }
          // The actor the run was authorised for is the only actor a tool
          // serves; a context that disagrees with its plan is refused.
          if (
            context.actor.actorType !== "HUMAN" ||
            context.actor.tenantId !== context.plan.tenantId ||
            context.actor.userId !== context.plan.actor.userId ||
            (context.actor.organisationId ?? null) !==
              (context.plan.actor.organisationId ?? null)
          ) {
            return finish(
              context,
              failed(
                proposal,
                record,
                "DENIED",
                "ACTOR_MISMATCH",
                NOT_AVAILABLE_MESSAGE,
                elapsed(),
              ),
            );
          }
          if (isAborted(context.signal)) {
            return finish(
              context,
              failed(
                proposal,
                record,
                "FAILED",
                "CANCELLED",
                "The request was cancelled.",
                elapsed(),
              ),
            );
          }
          const authorization = await definition.authorize(
            parsed.data,
            context,
          );
          if (authorization.outcome === "DENY") {
            return finish(
              context,
              failed(
                proposal,
                record,
                "DENIED",
                authorization.code,
                authorization.safeMessage,
                elapsed(),
              ),
            );
          }
          if (
            !sensitivityWithin(
              authorization.sensitivity,
              context.plan.maxSensitivity,
            )
          ) {
            return finish(
              context,
              failed(
                proposal,
                record,
                "DENIED",
                "SENSITIVITY_NOT_PERMITTED",
                NOT_AVAILABLE_MESSAGE,
                elapsed(),
              ),
            );
          }
          let produced: unknown;
          try {
            produced = await definition.execute(
              parsed.data,
              context,
              authorization.grant,
            );
          } catch (error: unknown) {
            if (error instanceof QToolArgumentError) {
              return finish(
                context,
                failed(
                  proposal,
                  record,
                  "FAILED",
                  "INVALID_ARGUMENTS",
                  error.safeMessage,
                  elapsed(),
                ),
              );
            }
            if (isAborted(context.signal)) {
              return finish(
                context,
                failed(
                  proposal,
                  record,
                  "FAILED",
                  "CANCELLED",
                  "The request was cancelled.",
                  elapsed(),
                ),
              );
            }
            // Server-side diagnostics only; the model learns a code.
            logger?.error(
              { err: error, qRunId: context.runId, tool: definition.id },
              "q tool execution threw",
            );
            return finish(
              context,
              failed(
                proposal,
                record,
                "FAILED",
                "TOOL_INTERNAL_ERROR",
                "The tool could not complete.",
                elapsed(),
              ),
            );
          }
          const output = definition.output.safeParse(produced);
          if (!output.success) {
            logger?.error(
              { qRunId: context.runId, tool: definition.id },
              "q tool produced output its schema refuses",
            );
            return finish(
              context,
              failed(
                proposal,
                record,
                "FAILED",
                "INVALID_TOOL_OUTPUT",
                "The tool could not complete.",
                elapsed(),
              ),
            );
          }
          if (
            JSON.stringify(output.data).length > MODEL_TOOL_RESULT_MAX_CHARS
          ) {
            return finish(
              context,
              failed(
                proposal,
                record,
                "FAILED",
                "RESULT_TOO_LARGE",
                "The result is too large to return; narrow the request.",
                elapsed(),
              ),
            );
          }
          return finish(context, {
            callId: proposal.callId,
            toolName: definition.id,
            toolVersion: definition.version,
            classification: definition.classification,
            status: "SUCCEEDED",
            failureCode: null,
            sensitivity: authorization.sensitivity,
            result: { ok: true, data: output.data },
            latencyMs: elapsed(),
          });
        } finally {
          span.end();
        }
      },
    );
  }

  return {
    offer: (context) =>
      Promise.resolve(registry.eligible(context).map(toOfferedTool)),
    execute,
  };
}
