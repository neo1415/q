import type { QLanguageCode } from "@capital-q/contracts";
import { readinessLeadLines } from "@capital-q/model-gateway/q";
import { hasReadinessLeadCopy, readinessLeadCopy } from "@capital-q/q-core";
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

export function planLeadLines(
  read: unknown,
  language: QLanguageCode | null = null,
): string | null {
  if (!hasReadinessLeadCopy(language)) return null;
  const copy = readinessLeadCopy(language);
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
          ? ` ${copy.step(item.facts.next.replace(/\s+/gu, " ").trim()).slice(0, 160)}`
          : "";
      return `${String(index + 1)}. ${copy.step(String(item.title))}.${next}`;
    });
  if (open.length === 0) return null;
  return [copy.planHeading, ...open].join("\n");
}

export function createToolReadinessLead(dependencies: {
  readonly tools: QToolPort;
  /**
   * Lane ml: the language this person chose for Q (Settings), so the list
   * code writes is in it; null or absent is English. A failed read is
   * English, never a lost lead.
   */
  readonly languageOf?:
    | ((actor: QAnswerRequest["actor"]) => Promise<QLanguageCode | null>)
    | undefined;
}): (request: QAnswerRequest) => Promise<string | null> {
  return async (request) => {
    const language =
      dependencies.languageOf === undefined
        ? null
        : await dependencies.languageOf(request.actor).catch(() => null);
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
      ? readinessLeadLines(outcome.result.data, language)
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
      ? planLeadLines(plan.result.data, language)
      : null;
  };
}

/**
 * Owner 2026-10-30 ("What should I do today?"): the line that closes the
 * answer to what to do now, offering a full reviewed plan as the next
 * step rather than starting one. In the person's chosen language; null
 * when no hand-written copy exists (Q's own answer is in their language,
 * and an English line is never appended to it).
 */
export function createPlanOfferLine(dependencies: {
  readonly languageOf?:
    | ((actor: QAnswerRequest["actor"]) => Promise<QLanguageCode | null>)
    | undefined;
}): (request: QAnswerRequest) => Promise<string | null> {
  return async (request) => {
    const language =
      dependencies.languageOf === undefined
        ? null
        : await dependencies.languageOf(request.actor).catch(() => null);
    return hasReadinessLeadCopy(language)
      ? readinessLeadCopy(language).planOffer
      : null;
  };
}
