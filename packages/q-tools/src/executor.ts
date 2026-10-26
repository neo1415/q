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
  Q_TURN_TOOLS_MAX,
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

/**
 * What is wrong with the arguments as a whole (path "(root)"), said in the
 * schema's own words: live d3a197b4 (2026-10-26) got only "invalid at:
 * (root)" and an instruction to look an id up, and spent three rounds (~12
 * s) before the card. A refinement's message is written in code; an
 * unknown field is named by kind, never by what the model wrote.
 */
function rootIssue(issue: {
  readonly code?: string;
  readonly message?: string;
}): string | null {
  if (issue.code === "custom" && typeof issue.message === "string")
    return issue.message;
  if (issue.code === "unrecognized_keys")
    return "a field this tool does not take: leave out any field not in its schema";
  if (issue.code === "invalid_type")
    return "the arguments must be one JSON object";
  return null;
}

/** Issue kinds, for the log line: which check refused, never a value. */
export function argumentIssueCodes(
  issues: readonly { readonly code?: string }[],
): readonly string[] {
  return [...new Set(issues.map((issue) => issue.code ?? "unknown"))].slice(
    0,
    8,
  );
}

/** Issue paths only: a model-generated value never travels back as text. */
function argumentIssues(
  issues: readonly {
    path: PropertyKey[];
    readonly code?: string;
    readonly message?: string;
  }[],
): string {
  const root = [
    ...new Set(
      issues
        .filter((issue) => issue.path.length === 0)
        .map(rootIssue)
        .filter((said): said is string => said !== null),
    ),
  ].slice(0, 3);
  const paths = [
    ...new Set(
      issues.map((issue) =>
        issue.path.length === 0
          ? "(root)"
          : issue.path.map((p) => String(p)).join("."),
      ),
    ),
  ].slice(0, 8);
  // A field path the model can fix in place; only the arguments as a whole
  // being wrong says what to fix there, in the schema's words.
  const fixes =
    root.length === 0
      ? ""
      : ` ${root.map((said) => `At (root): ${said}.`).join(" ")} Call the tool again with that corrected.`;
  // Said to the model, which speaks to the person: never ask them for an
  // id or relay this (live 2026-10-02: "I need Tallyloom's company record
  // ID"). Ids come from the run's own tools.
  return `Arguments are invalid at: ${paths.join(", ")}.${fixes} Do not ask the person for an id or mention this error: find the id with list_my_relationships or a search tool and try again, or tell them plainly what you could not do and the next step you can take.`;
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
    /** Which checks refused the arguments (issue kinds only). */
    invalidCodes?: readonly string[],
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
        // Which argument fields a reader got wrong (paths only, never
        // values): voiceq-63, a reader's propose_meeting arguments failed
        // and cost a second model call before the card, with no trace of why.
        ...(outcome.failureCode === "INVALID_ARGUMENTS" &&
        outcome.result.ok === false
          ? {
              invalidAt:
                /invalid at: ([^.]*)\./u.exec(
                  outcome.result.error.safeMessage,
                )?.[1] ?? null,
              ...(invalidCodes === undefined ? {} : { invalidCodes }),
            }
          : {}),
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
              argumentIssueCodes(parsed.error.issues),
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
          // An authorize step that throws (its port down, a timeout) is
          // closed, as a typed failure for this one call: it used to
          // escape the executor and end the whole turn (harden harness,
          // 2026-10-01: get_company, get_capital_objective,
          // propose_handle_claim). Nothing is granted on a failure.
          let authorization: Awaited<ReturnType<typeof definition.authorize>>;
          try {
            authorization = await definition.authorize(parsed.data, context);
          } catch (error: unknown) {
            logger?.error(
              { err: error, qRunId: context.runId, tool: definition.id },
              "q tool authorization threw",
            );
            return finish(
              context,
              failed(
                proposal,
                record,
                "FAILED",
                isAborted(context.signal) ? "CANCELLED" : "TOOL_INTERNAL_ERROR",
                isAborted(context.signal)
                  ? "The request was cancelled."
                  : "The tool could not complete.",
                elapsed(),
              ),
            );
          }
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
              {
                qRunId: context.runId,
                tool: definition.id,
                // Which fields and why, as paths and Zod's own codes, never
                // a value (F-135: the refusal said only "the tool", and a
                // field drift hid for days).
                refusals: output.error.issues
                  .slice(0, 8)
                  .map(
                    (issue) =>
                      `${issue.path.map(String).join(".")}:${issue.code}`,
                  ),
              },
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
    offer: (context) => {
      const ranked = registry.ranked(context);
      // The bound is applied by the registry (core first, then priority);
      // what it cut is logged so a crowded purpose is seen, not silent.
      if (ranked.length > Q_TURN_TOOLS_MAX) {
        logger?.warn(
          {
            qRunId: context.runId,
            purpose: context.plan.purpose.taskClass,
            eligible: ranked.length,
            dropped: ranked
              .slice(Q_TURN_TOOLS_MAX)
              .map((record) => record.definition.providerName),
          },
          "more tools relevant than one model request carries",
        );
      }
      return Promise.resolve(registry.eligible(context).map(toOfferedTool));
    },
    // The reader's list: every tool this purpose and plan allow, unfocused,
    // up to what one request can carry, exactly as the offer was before.
    // Declared app actions follow on any purpose: the reader may name one,
    // and a named one executes (lead 2026-10-03).
    available: async (context) => {
      const listed = registry.available(context);
      const applies = await Promise.all(
        listed.map((record) =>
          record.definition.applies === undefined
            ? Promise.resolve(true)
            : record.definition.applies(context).catch(() => true),
        ),
      );
      return listed
        .filter((_record, index) => applies[index] !== false)
        .map(toOfferedTool);
    },
    execute,
  };
}
