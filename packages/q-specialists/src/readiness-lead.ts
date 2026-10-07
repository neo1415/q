import { readinessLeadLines } from "@capital-q/model-gateway/q";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * Their readiness gaps, read through read_my_record under the run's own
 * plan, as the opening lines of "what should I do next?" (lead
 * 2026-10-03). Null when not a founder, ready, or the read is refused.
 *
 * Q.04 (2026-10-07): once investors can find the company, the next steps
 * come from their own action plan instead (read_my "plan": the readiness
 * rules' open steps, most urgent first), so the answer is never empty
 * advice once Discover activation is done. Composed by code, never by the
 * model, and only from steps the plan lists as still to do.
 */

type PlanItem = {
  readonly title?: unknown;
  readonly status?: unknown;
  readonly facts?: { readonly next?: unknown };
};

export function planLeadLines(read: unknown): string | null {
  if (typeof read !== "object" || read === null) return null;
  const items = (read as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const open = (items as PlanItem[])
    .filter(
      (item) =>
        typeof item.title === "string" &&
        typeof item.status === "string" &&
        item.status.startsWith("to do"),
    )
    .slice(0, 3)
    .map((item, index) => {
      const next =
        typeof item.facts?.next === "string"
          ? ` ${item.facts.next.replace(/\s+/gu, " ").trim().slice(0, 160)}`
          : "";
      return `${String(index + 1)}. ${String(item.title)}.${next}`;
    });
  if (open.length === 0) return null;
  return [
    "What to do next for your raise, most important first:",
    ...open,
  ].join("\n");
}

export function createToolReadinessLead(dependencies: {
  readonly tools: QToolPort;
}): (request: QAnswerRequest) => Promise<string | null> {
  return async (request) => {
    const context = {
      actor: request.actor,
      runId: request.runId,
      correlationId: request.correlationId,
      capability: request.capability,
      plan: request.plan,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };
    const outcome = await dependencies.tools.execute(
      {
        callId: "q-readiness-lead",
        name: "read_my_record",
        arguments: { record: "MARKETPLACE_READINESS" },
      },
      context,
    );
    const activation = outcome.result.ok
      ? readinessLeadLines(outcome.result.data)
      : null;
    if (activation !== null) return activation;
    const plan = await dependencies.tools
      .execute(
        {
          callId: "q-plan-lead",
          name: "read_my",
          arguments: { kind: "plan" },
        },
        context,
      )
      .catch(() => null);
    return plan !== null && plan.result.ok
      ? planLeadLines(plan.result.data)
      : null;
  };
}
