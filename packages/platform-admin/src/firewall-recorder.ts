import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";

/**
 * Records every Context Firewall decision -- codes only -- so the admin
 * console can show, per Q run, what Q was allowed to consider and what it
 * was refused (spec §4, Q monitor). A decorator around the firewall port:
 * the decision is returned exactly as the firewall made it, recording runs
 * after it and never delays, alters or fails it.
 *
 * Structural types keep this package free of the Q runtime: anything with
 * `plan(request)` returning AUTHORISED/DENIED decisions fits.
 */

type ScopeLike = { readonly kind: string };
type DeniedLike = { readonly kind: string; readonly reason: string };

type RequestLike = {
  readonly actor: {
    readonly tenantId?: string | undefined;
    readonly userId?: string | undefined;
  };
  readonly runId: string;
  readonly correlationId: string;
  readonly capability: string;
};

type DecisionLike =
  | {
      readonly outcome: "AUTHORISED";
      readonly plan: {
        readonly scopes: readonly ScopeLike[];
        readonly denied: readonly DeniedLike[];
      };
    }
  | {
      readonly outcome: "DENIED";
      readonly reason: string;
      readonly denied: readonly DeniedLike[];
    };

type PortLike<Req extends RequestLike, Dec extends DecisionLike> = {
  readonly plan: (request: Req) => Promise<Dec>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z_]{0,63}$/;

export function firewallDecisionRow(
  request: RequestLike,
  decision: DecisionLike,
) {
  const denied = (
    decision.outcome === "AUTHORISED" ? decision.plan.denied : decision.denied
  )
    .slice(0, 64)
    .map((scope) => ({ label: scope.kind, reason: scope.reason }));
  const allowed =
    decision.outcome === "AUTHORISED"
      ? [...new Set(decision.plan.scopes.map((scope) => scope.kind))].slice(
          0,
          64,
        )
      : [];
  const id = (value: string | undefined) =>
    value !== undefined && UUID.test(value) ? value : null;
  return {
    tenantId: id(request.actor.tenantId),
    userId: id(request.actor.userId),
    runId: id(request.runId),
    correlationId: request.correlationId.slice(0, 128) || null,
    capability: CODE.test(request.capability) ? request.capability : "UNKNOWN",
    outcome: decision.outcome,
    reason:
      decision.outcome === "DENIED" && CODE.test(decision.reason)
        ? decision.reason
        : null,
    allowed,
    denied,
  };
}

export function recordingFirewall<
  Req extends RequestLike,
  Dec extends DecisionLike,
>(
  firewall: PortLike<Req, Dec>,
  options: {
    readonly sql: DatabaseExecutor;
    readonly onRecordError?: ((error: unknown) => void) | undefined;
  },
): PortLike<Req, Dec> {
  return {
    plan: async (request) => {
      const decision = await firewall.plan(request);
      const row = firewallDecisionRow(request, decision);
      void options.sql`
        insert into platform_ops.q_firewall_decisions
          (tenant_id, user_id, run_id, correlation_id, capability, outcome,
           reason, allowed_labels, denied)
        values (${row.tenantId}, ${row.userId}, ${row.runId}, ${row.correlationId},
                ${row.capability}, ${row.outcome}, ${row.reason},
                ${row.allowed}::text[], ${jsonbParam(options.sql, row.denied)})`.then(
        () => undefined,
        (error: unknown) => options.onRecordError?.(error),
      );
      return decision;
    },
  };
}
