import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  QRunIdSchema,
  QClientActionToolResultSchema,
  type CorrelationId,
  type PermittedContextPlan,
  type QFastNavigationResponse,
  type QRunId,
} from "@capital-q/contracts";
import {
  createRoundTripCounter,
  withRoundTripCounter,
} from "@capital-q/database";
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

type OwnRelationships = {
  readonly items: readonly {
    readonly counterpart: { readonly name: string };
  }[];
} | null;

/** How long one person's prepared reading context is reused. */
export const FAST_NAVIGATION_PREPARED_MS = 20_000;
const PREPARED_PEOPLE_MAX = 500;
const OPENED_MAX = 32;

/**
 * R3 (coordinator, hosted: /navigation/resolve took ~2 s with no model
 * call): one person's reading context, prepared once and shared. The voice
 * line reads the same sentence as it streams (partials, then the final,
 * then the delegation's own words) -- each read used to plan the firewall,
 * list their relationships and run open_page again. Now the first read
 * prepares them (concurrent reads share the same promises) and the later
 * ones, including the final words, answer from it.
 *
 * Bounded in time, and never past the plan's own revalidateAfter, so a
 * revoked grant is honoured within seconds; the page Q opens still
 * authorises the person itself.
 */
type Prepared = {
  readonly at: number;
  readonly runId: QRunId;
  readonly correlationId: CorrelationId;
  readonly plan: Promise<PermittedContextPlan | null>;
  readonly own: Promise<OwnRelationships>;
  readonly opened: Map<string, Promise<OpenRecordIntent | null>>;
};

export function createFastNavigation(dependencies: {
  readonly firewall: ContextFirewallPort;
  readonly tools: QToolPort;
  readonly ownRelationships:
    ((actor: ActorContext) => Promise<OwnRelationships>) | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
  /** Wall clock for the prepared context's freshness (tests). */
  readonly clock?: (() => number) | undefined;
}): FastNavigationResolver {
  const now = dependencies.now ?? (() => performance.now());
  const clock = dependencies.clock ?? Date.now;
  const prepared = new Map<string, Prepared>();
  // Everything that shapes the plan: a different membership is a
  // different person for this purpose.
  const keyOf = (actor: ActorContext) =>
    [
      actor.tenantId,
      actor.userId,
      actor.organisationId ?? "",
      actor.membershipId ?? "",
    ].join(":");
  const fresh = (one: Prepared) =>
    clock() - one.at < FAST_NAVIGATION_PREPARED_MS;

  const preparedFor = (actor: ActorContext): Prepared => {
    const key = keyOf(actor);
    const known = prepared.get(key);
    if (known !== undefined && fresh(known)) return known;
    const runId = QRunIdSchema.parse(randomUUID());
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const plan = dependencies.firewall
      .plan({ actor, runId, correlationId, capability: "ANSWER", subjects: [] })
      .then((decision) =>
        decision.outcome === "AUTHORISED" ? decision.plan : null,
      )
      .catch(() => null);
    const own = (
      dependencies.ownRelationships?.(actor) ?? Promise.resolve(null)
    ).catch(() => null);
    const next: Prepared = {
      at: clock(),
      runId,
      correlationId,
      plan,
      own,
      opened: new Map(),
    };
    prepared.delete(key);
    prepared.set(key, next);
    while (prepared.size > PREPARED_PEOPLE_MAX) {
      const oldest = prepared.keys().next().value;
      if (oldest === undefined) break;
      prepared.delete(oldest);
    }
    return next;
  };

  /** The plan, unless its own revalidation time has passed. */
  const planNow = async (
    context: Prepared,
  ): Promise<PermittedContextPlan | null> => {
    const plan = await context.plan;
    if (plan === null) return null;
    const until = Date.parse(plan.revalidateAfter);
    return Number.isFinite(until) && until <= clock() ? null : plan;
  };

  return async (actor, text) => {
    const started = now();
    const ms = () => Math.max(0, Math.round(now() - started));
    const counter = createRoundTripCounter();
    return withRoundTripCounter(counter, async () => {
      const asksForRecord = namedRecordRequestOf(text) !== null;
      // A page by name needs no plan and no reads at all.
      const known = prepared.get(keyOf(actor));
      const reused = known !== undefined && fresh(known);
      const context = asksForRecord ? preparedFor(actor) : null;
      const side =
        context !== null &&
        ownInvestorOrganisationIn(
          (await planNow(context)) ?? { scopes: [] },
        ) !== null
          ? "INVESTOR"
          : "FOUNDER";
      const decided = await resolveFastNavigation({
        text,
        side,
        counterpartNames: async () =>
          ((context === null ? null : await context.own)?.items ?? []).map(
            (item) => item.counterpart.name,
          ),
        open: (page, name): Promise<OpenRecordIntent | null> => {
          if (context === null) return Promise.resolve(null);
          const key = `${page}:${name.trim().toLowerCase()}`;
          const opened = context.opened.get(key);
          if (opened !== undefined) return opened;
          const opening = (async (): Promise<OpenRecordIntent | null> => {
            const granted = await planNow(context);
            if (granted === null) return null;
            const outcome = await dependencies.tools.execute(
              {
                callId: `q-fast-open-${page.toLowerCase()}`,
                name: "open_page",
                arguments: { page, name },
              },
              {
                actor,
                runId: context.runId,
                correlationId: context.correlationId,
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
          })().catch(() => null);
          context.opened.set(key, opening);
          while (context.opened.size > OPENED_MAX) {
            const oldest = context.opened.keys().next().value;
            if (oldest === undefined) break;
            context.opened.delete(oldest);
          }
          return opening;
        },
      });
      // R3: how many of their own names the record was matched against
      // (a LEAVE_TO_Q on hosted could not be told apart from an empty set).
      const candidates =
        context === null ? null : ((await context.own)?.items.length ?? 0);
      dependencies.logger?.info(
        {
          outcome: decided.kind,
          record: asksForRecord,
          candidates,
          prepared: asksForRecord && reused,
          dbRoundTrips: counter.count,
          ms: ms(),
        },
        "q fast navigation resolved",
      );
      return decided.kind === "NAVIGATE"
        ? { kind: "NAVIGATE", intent: decided.intent, ms: ms() }
        : { kind: "LEAVE_TO_Q", ms: ms() };
    });
  };
}
