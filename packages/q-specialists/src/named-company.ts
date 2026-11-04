import type { Logger } from "@capital-q/observability";
import type { ContextFirewallPort, QAnswerRequest } from "@capital-q/q-runtime";

import type { QOpenRecordPort } from "./references.js";

/**
 * A company named in a turn, as the Capital Q record the person may open,
 * with the plan the Context Firewall gives for reading it.
 */
export type NamedCompanyRecord = {
  readonly subject: { readonly kind: "COMPANY"; readonly companyId: string };
  readonly plan: QAnswerRequest["plan"];
};

export type QNamedCompanyPort = (
  request: QAnswerRequest,
  name: string,
) => Promise<NamedCompanyRecord | null>;

/**
 * Acceptance 2026-11-04 (J3): "Write me a one-page memo on Ledgerline"
 * with nothing open researched Ledgerline on the public web as if Capital
 * Q held nothing ("identity unresolved ... three businesses"), while the
 * person may open Ledgerline's own record. The name is resolved first
 * through open_page's own authorize step (their records and what the
 * network shows them, exact name first); the record is then planned by
 * the Context Firewall as a subject, exactly as a profile read would be.
 * Nothing is widened: not found, or not authorised, is null and the
 * caller keeps to public sources.
 */
export function createNamedCompanyPort(dependencies: {
  readonly open: QOpenRecordPort["open"];
  readonly firewall: ContextFirewallPort;
  readonly logger?: Logger | undefined;
}): QNamedCompanyPort {
  return async (request, name) => {
    const intent = await dependencies
      .open(request, { page: "COMPANY", name })
      .catch(() => null);
    if (intent === null) return null;
    const subject = { kind: "COMPANY" as const, companyId: intent.id };
    const bound = request.plan.subjects.some(
      (entry) => entry.kind === "COMPANY" && entry.companyId === intent.id,
    );
    if (bound) return { subject, plan: request.plan };
    try {
      const decision = await dependencies.firewall.plan({
        actor: request.actor,
        runId: request.runId,
        correlationId: request.correlationId,
        capability: request.capability,
        subjects: [subject],
      });
      return decision.outcome === "AUTHORISED"
        ? { subject, plan: decision.plan }
        : null;
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      dependencies.logger?.warn(
        { err: error, qRunId: request.runId },
        "a named company's record was not planned",
      );
      return null;
    }
  };
}
