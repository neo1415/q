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
 * What is deliberately absent and must stay absent: SQL, arbitrary HTTP,
 * Gmail, Drive, a CRM, an accounting API, MCP, a calendar, or any write.
 * The one outward-facing read — bounded public-web research
 * (CQ-Q-RESEARCH-001) — is a fourth port over the Tool Registry: the
 * registry authorises it under the run's plan, the research capability
 * composes what may leave, and the specialist decides deterministically
 * from the person's own words whether to ask for it at all. A connector is
 * still a later packet. A specialist that could fetch on its own would be a
 * specialist whose permitted context was decided by itself rather than by
 * the firewall.
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

/** One public source, as the research tool returned it. UNTRUSTED text. */
export type PublicWebSource = {
  readonly index: number;
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly temporal: string;
  /** Quoted as data in the prompt; it may contain instructions and they are ignored. */
  readonly excerpt: string;
  readonly isSubjectWebsite: boolean;
  readonly mentionedCountries: readonly string[];
  readonly instructionRiskSignals: number;
  readonly recordedAsEvidence: boolean;
};

/** Capital Q's own deterministic reading of a source against its records. Trusted. */
export type PublicWebComparisonNote = {
  readonly sourceIndex: number;
  readonly basis: string;
  readonly relationship: string;
  readonly note: string;
};

export type CompanyResearchRead = {
  readonly status:
    "OK" | "NO_PUBLIC_IDENTITY" | "PROVIDER_UNAVAILABLE" | "NOT_OFFERED";
  /** Plain sentence for the person when the status is not OK. */
  readonly message: string | null;
  readonly sources: readonly PublicWebSource[];
  readonly comparison: readonly PublicWebComparisonNote[];
  readonly toolCalls: number;
};

/**
 * Bounded public-web research through the Tool Registry (CQ-Q-RESEARCH-001
 * §24-§29). One call per investigation, and only when the person asked for
 * public, current or external information. The query that leaves Capital Q
 * is composed by the research capability from the person's own words and
 * the company's authorised public identity; nothing here chooses it.
 */
export type CompanyResearchPort = {
  readonly research: (
    context: QToolExecutionContext,
    input: { readonly companyId: string; readonly question: string },
  ) => Promise<CompanyResearchRead>;
};

/** Authorised hybrid retrieval (§17). One search per investigation (§99, §100). */
export type CompanyEvidencePort = {
  readonly search: (
    plan: PermittedContextPlan,
    query: string,
    signal?: AbortSignal,
  ) => Promise<readonly RetrievalHit[]>;
};
