import { readinessLeadLines } from "@capital-q/model-gateway/q";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * Their readiness gaps, read through read_my_record under the run's own
 * plan, as the opening lines of "what should I do next?" (lead
 * 2026-10-03). Null when not a founder, ready, or the read is refused.
 */
export function createToolReadinessLead(dependencies: {
  readonly tools: QToolPort;
}): (request: QAnswerRequest) => Promise<string | null> {
  return async (request) => {
    const outcome = await dependencies.tools.execute(
      {
        callId: "q-readiness-lead",
        name: "read_my_record",
        arguments: { record: "MARKETPLACE_READINESS" },
      },
      {
        actor: request.actor,
        runId: request.runId,
        correlationId: request.correlationId,
        capability: request.capability,
        plan: request.plan,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    return outcome.result.ok ? readinessLeadLines(outcome.result.data) : null;
  };
}
