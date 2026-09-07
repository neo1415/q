import {
  Q_SENSITIVITY_RANK,
  type PermittedContextPlan,
  type QAuthorisedKnowledgeScope,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import type { RetrievalScopeConstraint } from "../retrieval/contracts.js";
import type { ContradictionSet } from "../infrastructure/postgres-contradiction-repository.js";
import type { KnowledgeRepository } from "../infrastructure/postgres-knowledge-repository.js";
import { toKnowledgeObject } from "../infrastructure/postgres-knowledge-repository.js";
import type { AuthorisedKnowledge, KnowledgeSubjectRef } from "./contracts.js";
import { assessFreshness } from "./freshness.js";

/**
 * Permission-aware knowledge reads (CQ-KNW-002 §21-§23, §35;
 * CQ-KNW-003 §9-§10, §55-§56).
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
 *
 * Since CQ-KNW-003 "current" is derived rather than stored. A metric has a
 * history, and the current reading is the latest one THIS viewer may see —
 * never the latest that exists. The distinction is the Context Firewall
 * again: if a founder-private August figure suppressed an investor-visible
 * June figure, private information would have silently altered what an
 * investor is shown, which is the invariant this whole layer exists to hold.
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

/**
 * A recorded disagreement, with every side the viewer may see.
 *
 * Both readings travel together or neither does (§55). Returning one alone
 * would be Capital Q silently picking a number, which is the single thing
 * contradiction handling exists to prevent.
 */
export type AuthorisedDispute = {
  readonly set: ContradictionSet;
  readonly members: readonly AuthorisedKnowledge[];
};

export type KnowledgeQueryService = {
  /**
   * The current understanding of one key: the latest effective reading this
   * actor may see, not the latest that exists.
   */
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
  /**
   * What was understood at an instant (§9). Answers "what was ARR in June"
   * from valid time, not from whatever was learned most recently — and
   * includes superseded readings, because a superseded reading is what the
   * period looked like then and "as of" is a question about then.
   */
  readonly asOfForKey: (
    scope: KnowledgeQueryScope,
    subject: KnowledgeSubjectRef,
    knowledgeKey: string,
    asOf: Date,
    /**
     * Which series to answer from. Omitted means the unqualified actual —
     * a defined thing, not a preferred one: a caller asking about a
     * definition or a projection names it, and nothing here silently picks
     * the reading that answers best.
     */
    slot?: {
      readonly definitionQualifier?: string | null | undefined;
      readonly measurementBasis?: string | undefined;
    },
  ) => Promise<AuthorisedKnowledge | null>;
  /**
   * The whole authorised series for one key, newest effective date first
   * (§10). Historical is not false: nothing is dropped for being old, and
   * superseded readings are returned with their status intact.
   */
  readonly historyForKey: (
    scope: KnowledgeQueryScope,
    subject: KnowledgeSubjectRef,
    knowledgeKey: string,
    options?: { readonly limit?: number | undefined },
  ) => Promise<readonly AuthorisedKnowledge[]>;
  /** Open disagreements about a subject, with both sides (§55). */
  readonly disputesForSubject: (
    scope: KnowledgeQueryScope,
    subject: KnowledgeSubjectRef,
    options?: { readonly limit?: number | undefined },
  ) => Promise<readonly AuthorisedDispute[]>;
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
    return {
      object,
      evidence,
      sourceIds,
      // Age qualifies an answer; it never widens who may hear it (§23).
      freshness: assessFreshness({
        knowledgeKey: object.knowledgeKey,
        validFrom: object.validFrom,
        recordedAt: object.recordedAt,
        lastVerifiedAt: object.lastVerifiedAt,
      }),
      disputed: object.status === "DISPUTED",
    };
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
               o.sensitivity_class, o.definition_qualifier, o.measurement_basis,
               o.last_verified_at, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
         where o.tenant_id = ${scope.tenantId}
           and o.subject_type = ${subject.subjectType}
           and o.subject_id = ${subject.subjectId}
           and o.knowledge_key = ${knowledgeKey}
           -- A settled understanding, or one under dispute. A candidate is a
           -- proposal awaiting a person and is not Capital Q's position; a
           -- disputed reading still is, and says so.
           and o.status in ('ACTIVE', 'DISPUTED')
           and exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or o.subject_id = any(g.subject_ids))
                    and o.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(o.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
         order by coalesce(o.valid_from, o.recorded_at) desc, o.recorded_at desc
         limit 1`;
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
               o.sensitivity_class, o.definition_qualifier, o.measurement_basis,
               o.last_verified_at, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
         where o.tenant_id = ${scope.tenantId}
           and o.subject_type = ${subject.subjectType}
           and o.subject_id = ${subject.subjectId}
           and o.status in ('ACTIVE', 'DISPUTED')
           and exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or o.subject_id = any(g.subject_ids))
                    and o.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(o.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
           -- The current reading of each series is the latest one this viewer
           -- may see. The subquery repeats the envelope on purpose: an
           -- unauthorised later figure must not suppress an authorised
           -- earlier one, or private information would have altered what an
           -- investor is shown without ever being shown to them.
           and not exists (
                 select 1
                   from q_knowledge.objects later
                  where later.tenant_id = o.tenant_id
                    and later.subject_type = o.subject_type
                    and later.subject_id = o.subject_id
                    and later.knowledge_key = o.knowledge_key
                    and coalesce(later.definition_qualifier, '')
                        = coalesce(o.definition_qualifier, '')
                    and later.measurement_basis = o.measurement_basis
                    and later.status in ('ACTIVE', 'DISPUTED')
                    and (coalesce(later.valid_from, later.recorded_at), later.recorded_at)
                        > (coalesce(o.valid_from, o.recorded_at), o.recorded_at)
                    and exists (
                          select 1
                            from jsonb_to_recordset(${authorised}::text::jsonb)
                              as g2(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                           where (g2.subject_ids is null or later.subject_id = any(g2.subject_ids))
                             and later.visibility_scope = any(g2.visibility_scopes)
                             and q_knowledge.sensitivity_rank(later.sensitivity_class)
                                 <= q_knowledge.sensitivity_rank(g2.sensitivity_ceiling)))
         order by o.knowledge_key, coalesce(o.definition_qualifier, ''), o.measurement_basis
         limit ${limit}`;
      return Promise.all(rows.map((row) => hydrate(scope.tenantId, row)));
    },

    asOfForKey: async (scope, subject, knowledgeKey, asOf, slot) => {
      if (scope.constraints.length === 0) {
        return null;
      }
      const authorised = authorisedJson(scope.constraints);
      const at = asOf.toISOString();
      const definition = slot?.definitionQualifier ?? null;
      const basis = slot?.measurementBasis ?? "ACTUAL";
      const [row] = await sql`
        select o.id, o.tenant_id, o.subject_type, o.subject_id, o.knowledge_type,
               o.knowledge_key, o.statement, o.structured_value, o.truth_class,
               o.evidence_status, o.confidence_class, o.reliability_class, o.valid_from,
               o.valid_to, o.recorded_at, o.source_environment, o.visibility_scope,
               o.sensitivity_class, o.definition_qualifier, o.measurement_basis,
               o.last_verified_at, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
         where o.tenant_id = ${scope.tenantId}
           and o.subject_type = ${subject.subjectType}
           and o.subject_id = ${subject.subjectId}
           and o.knowledge_key = ${knowledgeKey}
           and coalesce(o.definition_qualifier, '') = ${definition ?? ""}
           and o.measurement_basis = ${basis}
           and o.status in ('ACTIVE', 'DISPUTED', 'SUPERSEDED', 'STALE')
           -- Validity, never record time: a reading recorded last week about
           -- August is not an answer to "what was it in June".
           and coalesce(o.valid_from, o.recorded_at) <= ${at}::timestamptz
           and (o.valid_to is null or o.valid_to > ${at}::timestamptz)
           and exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or o.subject_id = any(g.subject_ids))
                    and o.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(o.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
         -- Ties on effective date break on the correction that was actually
         -- recorded: a reading marked superseded was explicitly replaced,
         -- and record time settles the rest.
         order by coalesce(o.valid_from, o.recorded_at) desc,
                  (o.status <> 'SUPERSEDED') desc, o.recorded_at desc
         limit 1`;
      return row === undefined ? null : hydrate(scope.tenantId, row);
    },

    historyForKey: async (scope, subject, knowledgeKey, options) => {
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
               o.sensitivity_class, o.definition_qualifier, o.measurement_basis,
               o.last_verified_at, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
         where o.tenant_id = ${scope.tenantId}
           and o.subject_type = ${subject.subjectType}
           and o.subject_id = ${subject.subjectId}
           and o.knowledge_key = ${knowledgeKey}
           and o.status in ('ACTIVE', 'DISPUTED', 'SUPERSEDED', 'STALE')
           and exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or o.subject_id = any(g.subject_ids))
                    and o.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(o.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
         order by coalesce(o.valid_from, o.recorded_at) desc, o.recorded_at desc
         limit ${limit}`;
      return Promise.all(rows.map((row) => hydrate(scope.tenantId, row)));
    },

    disputesForSubject: async (scope, subject, options) => {
      if (scope.constraints.length === 0) {
        return [];
      }
      const limit = Math.min(
        Math.max(options?.limit ?? KNOWLEDGE_QUERY_MAX, 1),
        KNOWLEDGE_QUERY_MAX,
      );
      const authorised = authorisedJson(scope.constraints);
      // A set inherits its members' classification, so a set that passes the
      // envelope is never more open than what it is about (§51). Members are
      // filtered again below rather than trusted to follow.
      const sets = await sql`
        select c.id, c.tenant_id, c.subject_type, c.subject_id, c.knowledge_key,
               c.definition_qualifier, c.measurement_basis, c.contested_from,
               c.conflict_kind, c.materiality, c.status, c.visibility_scope,
               c.sensitivity_class, c.resolution_reason, c.resolved_at, c.created_at
          from q_knowledge.contradiction_sets c
         where c.tenant_id = ${scope.tenantId}
           and c.subject_type = ${subject.subjectType}
           and c.subject_id = ${subject.subjectId}
           and c.status = 'OPEN'
           and exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or c.subject_id = any(g.subject_ids))
                    and c.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(c.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
         order by c.created_at desc
         limit ${limit}`;

      const disputes: AuthorisedDispute[] = [];
      for (const setRow of sets) {
        const setId = setRow["id"] as string;
        const memberRows = await sql`
          select o.id, o.tenant_id, o.subject_type, o.subject_id, o.knowledge_type,
                 o.knowledge_key, o.statement, o.structured_value, o.truth_class,
                 o.evidence_status, o.confidence_class, o.reliability_class, o.valid_from,
                 o.valid_to, o.recorded_at, o.source_environment, o.visibility_scope,
                 o.sensitivity_class, o.definition_qualifier, o.measurement_basis,
                 o.last_verified_at, o.status, o.hold_reason, o.reassessment_required_at,
                 o.reassessment_reason, o.current_revision_number, o.created_at
            from q_knowledge.contradiction_members m
            join q_knowledge.objects o
              on o.id = m.knowledge_object_id and o.tenant_id = m.tenant_id
           where m.tenant_id = ${scope.tenantId}
             and m.contradiction_set_id = ${setId}
             and exists (
                   select 1
                     from jsonb_to_recordset(${authorised}::text::jsonb)
                       as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                    where (g.subject_ids is null or o.subject_id = any(g.subject_ids))
                      and o.visibility_scope = any(g.visibility_scopes)
                      and q_knowledge.sensitivity_rank(o.sensitivity_class)
                          <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
           order by m.role desc, o.recorded_at`;
        // One side alone is Capital Q picking a number. If the envelope
        // reaches only one member the disagreement is withheld entirely.
        if (memberRows.length < 2) {
          continue;
        }
        disputes.push({
          set: toContradictionSet(setRow),
          members: await Promise.all(
            memberRows.map((row) => hydrate(scope.tenantId, row)),
          ),
        });
      }
      return disputes;
    },
  };
}

/**
 * Reads a set row without re-parsing it through the repository, which owns
 * writes. Codes and references only; no statement and no value live here.
 */
function toContradictionSet(row: Record<string, unknown>): ContradictionSet {
  const instant = (value: unknown): string | null =>
    value === null || value === undefined
      ? null
      : new Date(value as string).toISOString();
  return {
    id: row["id"] as string,
    tenantId: row["tenant_id"] as ContradictionSet["tenantId"],
    subject: {
      subjectType: row["subject_type"] as "COMPANY",
      subjectId: row["subject_id"] as string,
    },
    knowledgeKey: row["knowledge_key"] as string,
    definitionQualifier: row["definition_qualifier"] as string | null,
    measurementBasis: row["measurement_basis"] as string,
    contestedFrom: instant(row["contested_from"]),
    conflictKind: row["conflict_kind"] as ContradictionSet["conflictKind"],
    materiality: row["materiality"] as ContradictionSet["materiality"],
    status: row["status"] as ContradictionSet["status"],
    visibilityScope: row[
      "visibility_scope"
    ] as ContradictionSet["visibilityScope"],
    sensitivityClass: row[
      "sensitivity_class"
    ] as ContradictionSet["sensitivityClass"],
    resolutionReason: row["resolution_reason"] as string | null,
    resolvedAt: instant(row["resolved_at"]),
    createdAt: instant(row["created_at"]) as ContradictionSet["createdAt"],
  };
}
