import type { PermittedContextPlan } from "@capital-q/contracts";
import type { AuthorisedFact } from "@capital-q/q-core";
import type {
  AuthorisedDispute,
  AuthorisedKnowledge,
  RetrievalHit,
} from "@capital-q/q-knowledge";
import type { QToolExecutionContext } from "@capital-q/q-runtime";

/**
 * What Company Intelligence may reach (CQ-Q-020 §46, §50, §71, §72).
 *
 * Three narrow ports, each owned by the context that owns the data. There
 * is no executor, no connection string, no credential and no HTTP client
 * anywhere in this package — a specialist calls named operations another
 * context authorises, and that is the whole of its reach.
 *
 * What is deliberately absent and must stay absent: SQL, web search,
 * Gmail, Drive, a CRM, an accounting API, MCP, a calendar, or any write.
 * External research is a later governed source layer; a connector is a
 * later packet. A specialist that could fetch would be a specialist whose
 * permitted context was decided by itself rather than by the firewall.
 */

/** Canonical structured state, read through the Safe Read tools (§15). */
export type CompanyCanonicalPort = {
  readonly read: (
    context: QToolExecutionContext,
    companyId: string,
  ) => Promise<{
    readonly facts: readonly AuthorisedFact[];
    readonly toolCalls: number;
    /** Present when the actor may not see this company at all. */
    readonly available: boolean;
    readonly canonicalName: string | null;
  }>;
};

/** Authorised Q Knowledge reads (§16). Every call carries the plan's envelope. */
export type CompanyKnowledgePort = {
  readonly current: (
    plan: PermittedContextPlan,
    companyId: string,
  ) => Promise<readonly AuthorisedKnowledge[]>;
  readonly disputes: (
    plan: PermittedContextPlan,
    companyId: string,
  ) => Promise<readonly AuthorisedDispute[]>;
  /**
   * The authorised series for one key, newest effective first. Used for
   * "what changed", which is a comparison between recorded readings and
   * never between two model answers (§67).
   */
  readonly series: (
    plan: PermittedContextPlan,
    companyId: string,
    knowledgeKey: string,
  ) => Promise<readonly AuthorisedKnowledge[]>;
  /**
   * What was understood at an instant, from valid time (§65, §81). Nothing
   * recorded about a later period may reach a historical answer.
   */
  readonly asOf: (
    plan: PermittedContextPlan,
    companyId: string,
    knowledgeKey: string,
    asOf: Date,
  ) => Promise<AuthorisedKnowledge | null>;
};

/** Authorised hybrid retrieval (§17). One search per investigation (§99, §100). */
export type CompanyEvidencePort = {
  readonly search: (
    plan: PermittedContextPlan,
    query: string,
    signal?: AbortSignal,
  ) => Promise<readonly RetrievalHit[]>;
};
