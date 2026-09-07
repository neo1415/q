import {
  Q_SENSITIVITY_RANK,
  type PermittedContextPlan,
  type QAuthorisedKnowledgeScope,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import type { RetrievalScopeConstraint } from "../retrieval/contracts.js";
import type { KnowledgeRepository } from "../infrastructure/postgres-knowledge-repository.js";
import { toKnowledgeObject } from "../infrastructure/postgres-knowledge-repository.js";
import type { AuthorisedKnowledge, KnowledgeSubjectRef } from "./contracts.js";

/**
 * Permission-aware knowledge reads (CQ-KNW-002 §21-§23, §35).
 *
 * Q knowing something is not the current user being allowed to know it, so
 * there is no `getAllKnowledge`, no tenant-wide list and no method that
 * takes a subject without an envelope. Every read is constrained by the
 * Context Firewall's plan, projected into the same disjunction of
 * constraints CQ-RAG-004 already uses — one envelope shape for the whole
 * knowledge context, not two.
 *
 * The constraint is applied IN the query, above any ordering, so an
 * unauthorised understanding is never a row: it cannot be counted, timed or
 * one bug away from being returned.
 */

/**
 * Which plan scopes authorise reading derived knowledge.
 *
 * A knowledge object inherits its scope from the evidence beneath it, so the
 * scopes that authorise the evidence authorise the knowledge. Structured
 * scopes are included because an owner permitted their company's private
 * financials is permitted an understanding derived from them — but §23 still
 * stands: canonical state remains the authority for what it owns, and this
 * governs reading, not precedence.
 */
const KNOWLEDGE_BACKED_SCOPE_KINDS = new Set([
  "EVIDENCE_DOCUMENTS",
  "COMPANY_PRIVATE_FINANCIALS",
  "COMPANY_PROFILE",
  "NETWORK_VISIBLE_DATA",
  "PUBLIC_EXTERNAL_DATA",
]);

function subjectsFor(
  scope: QAuthorisedKnowledgeScope,
): readonly string[] | null {
  if (scope.filter.companyId !== undefined) {
    return [scope.filter.companyId];
  }
  return scope.subject?.kind === "COMPANY" ? [scope.subject.companyId] : null;
}

/**
 * Projects the plan into the constraints knowledge reads obey.
 *
 * A projection, never a second policy: it cannot add a scope, widen a label
 * set, raise a ceiling or reach a subject the plan did not name.
 */
export function knowledgeConstraintsFor(
  plan: PermittedContextPlan,
): readonly RetrievalScopeConstraint[] {
  const constraints: RetrievalScopeConstraint[] = [];
  for (const scope of plan.scopes) {
    if (!KNOWLEDGE_BACKED_SCOPE_KINDS.has(scope.kind)) {
      continue;
    }
    if (scope.projection !== "FULL") {
      continue;
    }
    const labels =
      scope.filter.contextLabels !== undefined &&
      scope.filter.contextLabels.length > 0
        ? scope.filter.contextLabels
        : [scope.contextLabel];
    constraints.push({
      scopeKind: scope.kind,
      layer: "KNOWLEDGE_OBJECTS",
      subjectIds: subjectsFor(scope),
      visibilityScopes: labels,
      sensitivityCeiling:
        Q_SENSITIVITY_RANK[scope.sensitivity] <=
        Q_SENSITIVITY_RANK[plan.maxSensitivity]
          ? scope.sensitivity
          : plan.maxSensitivity,
      canDiscloseExistence: scope.rights.canDiscloseExistence,
      canQuote: scope.rights.canQuote,
      canProvideLink: scope.rights.canProvideLink,
    });
  }
  return constraints;
}

export type KnowledgeQueryScope = {
  readonly tenantId: string;
  /** A disjunction. Empty authorises nothing and must return nothing. */
  readonly constraints: readonly RetrievalScopeConstraint[];
};

export type KnowledgeQueryService = {
  /** The current understanding of one key, if this actor may have it. */
  readonly currentForKey: (
    scope: KnowledgeQueryScope,
    subject: KnowledgeSubjectRef,
    knowledgeKey: string,
  ) => Promise<AuthorisedKnowledge | null>;
  /** Everything currently understood about a subject, bounded and authorised. */
  readonly currentForSubject: (
    scope: KnowledgeQueryScope,
    subject: KnowledgeSubjectRef,
    options?: { readonly limit?: number | undefined },
  ) => Promise<readonly AuthorisedKnowledge[]>;
};

export const KNOWLEDGE_QUERY_MAX = 50;

function authorisedJson(
  constraints: readonly RetrievalScopeConstraint[],
): string {
  return JSON.stringify(
    constraints.map((constraint) => ({
      subject_ids: constraint.subjectIds,
      visibility_scopes: constraint.visibilityScopes,
      sensitivity_ceiling: constraint.sensitivityCeiling,
    })),
  );
}

export function createKnowledgeQueryService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly knowledge: KnowledgeRepository;
  readonly logger?: Logger | undefined;
}): KnowledgeQueryService {
  const { sql, knowledge } = dependencies;

  const hydrate = async (
    tenantId: string,
    row: unknown,
  ): Promise<AuthorisedKnowledge> => {
    const object = toKnowledgeObject(row);
    const [evidence, sourceIds] = await Promise.all([
      knowledge.listEvidenceLinks(sql, tenantId as never, object.id),
      knowledge.listSourceIds(sql, tenantId as never, object.id),
    ]);
    return { object, evidence, sourceIds };
  };

  return {
    currentForKey: async (scope, subject, knowledgeKey) => {
      if (scope.constraints.length === 0) {
        // Not "searched and filtered to nothing": never searched at all.
        return null;
      }
      const authorised = authorisedJson(scope.constraints);
      const [row] = await sql`
        select o.id, o.tenant_id, o.subject_type, o.subject_id, o.knowledge_type,
               o.knowledge_key, o.statement, o.structured_value, o.truth_class,
               o.evidence_status, o.confidence_class, o.reliability_class, o.valid_from,
               o.valid_to, o.recorded_at, o.source_environment, o.visibility_scope,
               o.sensitivity_class, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
         where o.tenant_id = ${scope.tenantId}
           and o.subject_type = ${subject.subjectType}
           and o.subject_id = ${subject.subjectId}
           and o.knowledge_key = ${knowledgeKey}
           -- Only a settled understanding is an answer. A candidate is a
           -- proposal awaiting a person and is not Capital Q's position.
           and o.status = 'ACTIVE'
           and exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or o.subject_id = any(g.subject_ids))
                    and o.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(o.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))`;
      return row === undefined ? null : hydrate(scope.tenantId, row);
    },

    currentForSubject: async (scope, subject, options) => {
      if (scope.constraints.length === 0) {
        return [];
      }
      const limit = Math.min(
        Math.max(options?.limit ?? KNOWLEDGE_QUERY_MAX, 1),
        KNOWLEDGE_QUERY_MAX,
      );
      const authorised = authorisedJson(scope.constraints);
      const rows = await sql`
        select o.id, o.tenant_id, o.subject_type, o.subject_id, o.knowledge_type,
               o.knowledge_key, o.statement, o.structured_value, o.truth_class,
               o.evidence_status, o.confidence_class, o.reliability_class, o.valid_from,
               o.valid_to, o.recorded_at, o.source_environment, o.visibility_scope,
               o.sensitivity_class, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
         where o.tenant_id = ${scope.tenantId}
           and o.subject_type = ${subject.subjectType}
           and o.subject_id = ${subject.subjectId}
           and o.status = 'ACTIVE'
           and exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or o.subject_id = any(g.subject_ids))
                    and o.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(o.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
         order by o.knowledge_key
         limit ${limit}`;
      return Promise.all(rows.map((row) => hydrate(scope.tenantId, row)));
    },
  };
}
