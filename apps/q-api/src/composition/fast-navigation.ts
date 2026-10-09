import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  QRunIdSchema,
  QClientActionToolResultSchema,
  type PermittedContextPlan,
  type QFastNavigationResponse,
} from "@capital-q/contracts";
import { ownInvestorOrganisationIn } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import type { ContextFirewallPort, QToolPort } from "@capital-q/q-runtime";
import {
  namedRecordRequestOf,
  resolveFastNavigation,
  type OpenRecordIntent,
} from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

/**
 * RECOVERY-2026-10 (C, founder 2026-10-09: "stupid fast"): the fast path's
 * server side. No model, no run: a page by its name is code alone; a
 * record by its name gets the Context Firewall's own plan for this person
 * (nothing broader than their own conversation) and goes through
 * open_page's own authorize step, exactly as the answer's resolver does.
 * So the screen can move in tens of milliseconds, and never to anything
 * the person could not open by hand.
 */
export type FastNavigationResolver = (
  actor: ActorContext,
  text: string,
) => Promise<QFastNavigationResponse>;

export function createFastNavigation(dependencies: {
  readonly firewall: ContextFirewallPort;
  readonly tools: QToolPort;
  readonly ownRelationships:
    | ((actor: ActorContext) => Promise<{
        readonly items: readonly {
          readonly counterpart: { readonly name: string };
        }[];
      } | null>)
    | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
}): FastNavigationResolver {
  const now = dependencies.now ?? (() => performance.now());
  return async (actor, text) => {
    const started = now();
    const ms = () => Math.max(0, Math.round(now() - started));
    const runId = QRunIdSchema.parse(randomUUID());
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    // The plan only when a record is named: a page by name needs none.
    let plan: Promise<PermittedContextPlan | null> | null = null;
    const planOf = () => {
      plan ??= dependencies.firewall
        .plan({
          actor,
          runId,
          correlationId,
          capability: "ANSWER",
          subjects: [],
        })
        .then((decision) =>
          decision.outcome === "AUTHORISED" ? decision.plan : null,
        )
        .catch(() => null);
      return plan;
    };
    const asksForRecord = namedRecordRequestOf(text) !== null;
    // A record: their relationships and the plan are read at once, not one
    // after the other (the open waits on both).
    const own = asksForRecord
      ? (dependencies.ownRelationships?.(actor) ?? Promise.resolve(null)).catch(
          () => null,
        )
      : Promise.resolve(null);
    if (asksForRecord) void planOf();
    const side =
      asksForRecord &&
      ownInvestorOrganisationIn((await planOf()) ?? { scopes: [] }) !== null
        ? "INVESTOR"
        : "FOUNDER";
    const decided = await resolveFastNavigation({
      text,
      side,
      counterpartNames: async () =>
        ((await own)?.items ?? []).map((item) => item.counterpart.name),
      open: async (page, name): Promise<OpenRecordIntent | null> => {
        const granted = await planOf();
        if (granted === null) return null;
        const outcome = await dependencies.tools.execute(
          {
            callId: `q-fast-open-${page.toLowerCase()}`,
            name: "open_page",
            arguments: { page, name },
          },
          {
            actor,
            runId,
            correlationId,
            capability: "ANSWER",
            plan: granted,
            focus: { areas: [], tools: ["open_page"] },
          },
        );
        if (!outcome.result.ok) return null;
        const read = QClientActionToolResultSchema.safeParse(
          outcome.result.data,
        );
        return read.success &&
          read.data.clientAction.kind === "OPEN_RECORD_PAGE"
          ? read.data.clientAction
          : null;
      },
    });
    dependencies.logger?.info(
      { outcome: decided.kind, record: asksForRecord, ms: ms() },
      "q fast navigation resolved",
    );
    return decided.kind === "NAVIGATE"
      ? { kind: "NAVIGATE", intent: decided.intent, ms: ms() }
      : { kind: "LEAVE_TO_Q", ms: ms() };
  };
}
