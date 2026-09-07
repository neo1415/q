import { z } from "zod";

import {
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  UtcTimestampSchema,
  type MarketplaceVisibility,
  type MessageSensitivity,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId } from "@capital-q/security";

import type { KnowledgeSubjectRef } from "../knowledge/contracts.js";
import { toKnowledgeObject } from "./postgres-knowledge-repository.js";
import type { KnowledgeObject } from "../knowledge/contracts.js";

/**
 * Recorded disagreement in Postgres (CQ-KNW-003 §15-§17).
 *
 * A set holds references and codes: which understandings disagree, about
 * which metric, period and definition, and whether anyone has settled it. It
 * holds no statement and no value, because the members already carry those
 * along with the permissions that govern them — and because a set that
 * copied them would become a second place a private figure could leak from.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const NullableTimestamp = z
  .union([z.date(), z.string(), z.null()])
  .transform((value) =>
    value === null
      ? null
      : UtcTimestampSchema.parse(
          value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString(),
        ),
  );

export const CONTRADICTION_STATUSES = [
  "OPEN",
  "RESOLVED",
  "ACCEPTED_DIFFERENCE",
  "SUPERSEDED",
] as const;
export type ContradictionStatus = (typeof CONTRADICTION_STATUSES)[number];

export type ContradictionSet = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly subject: KnowledgeSubjectRef;
  readonly knowledgeKey: string;
  readonly definitionQualifier: string | null;
  readonly measurementBasis: string;
  readonly contestedFrom: UtcTimestamp | null;
  readonly conflictKind:
    "VALUE_MISMATCH" | "UNIT_MISMATCH" | "CURRENCY_MISMATCH";
  readonly materiality: "MATERIAL" | "IMMATERIAL" | "UNDETERMINED";
  readonly status: ContradictionStatus;
  readonly visibilityScope: MarketplaceVisibility;
  readonly sensitivityClass: MessageSensitivity;
  readonly resolutionReason: string | null;
  readonly resolvedAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
};

const SetRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  subject_type: z.literal("COMPANY"),
  subject_id: z.string().uuid(),
  knowledge_key: z.string(),
  definition_qualifier: z.string().nullable(),
  measurement_basis: z.string(),
  contested_from: NullableTimestamp,
  conflict_kind: z.enum([
    "VALUE_MISMATCH",
    "UNIT_MISMATCH",
    "CURRENCY_MISMATCH",
  ]),
  materiality: z.enum(["MATERIAL", "IMMATERIAL", "UNDETERMINED"]),
  status: z.enum(CONTRADICTION_STATUSES),
  visibility_scope: MarketplaceVisibilitySchema,
  sensitivity_class: MessageSensitivitySchema,
  resolution_reason: z.string().nullable(),
  resolved_at: NullableTimestamp,
  created_at: Timestamp,
});

function toSet(row: unknown): ContradictionSet {
  const r = SetRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id as TenantId,
    subject: { subjectType: r.subject_type, subjectId: r.subject_id },
    knowledgeKey: r.knowledge_key,
    definitionQualifier: r.definition_qualifier,
    measurementBasis: r.measurement_basis,
    contestedFrom: r.contested_from,
    conflictKind: r.conflict_kind,
    materiality: r.materiality,
    status: r.status,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    resolutionReason: r.resolution_reason,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  };
}

export type ContradictionRepository = {
  /**
   * Opens the disagreement, or returns the one already open about exactly
   * this question. A second challenger joins the argument rather than
   * starting a parallel one.
   */
  readonly openOrJoin: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly subject: KnowledgeSubjectRef;
      readonly knowledgeKey: string;
      readonly definitionQualifier: string | null;
      readonly measurementBasis: string;
      readonly contestedFrom: string | null;
      readonly conflictKind: ContradictionSet["conflictKind"];
      readonly materiality: ContradictionSet["materiality"];
      readonly visibilityScope: MarketplaceVisibility;
      readonly sensitivityClass: MessageSensitivity;
      readonly incumbentObjectId: string;
      readonly challengerObjectId: string;
    },
  ) => Promise<ContradictionSet>;
  readonly findOpenFor: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    subject: KnowledgeSubjectRef,
    knowledgeKey: string,
  ) => Promise<readonly ContradictionSet[]>;
  readonly listMembers: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    setId: string,
  ) => Promise<
    readonly {
      readonly knowledgeObjectId: string;
      readonly role: "INCUMBENT" | "CHALLENGER";
    }[]
  >;
  /** The understandings in a set, so a caller can show every side at once. */
  readonly listMemberObjects: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    setId: string,
  ) => Promise<readonly KnowledgeObject[]>;
  /** Settles a set. Every member survives; nothing is deleted. */
  readonly settle: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly setId: string;
      readonly status: Exclude<ContradictionStatus, "OPEN">;
      readonly reason: string;
    },
  ) => Promise<ContradictionSet>;
  /** Open sets touching a subject, for the internal knowledge-health view. */
  readonly countOpenForSubject: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    subject: KnowledgeSubjectRef,
  ) => Promise<number>;
};

export function createPostgresContradictionRepository(): ContradictionRepository {
  return {
    openOrJoin: async (tx, input) => {
      const [existing] = await tx.sql`
        select id, tenant_id, subject_type, subject_id, knowledge_key,
               definition_qualifier, measurement_basis, contested_from, conflict_kind,
               materiality, status, visibility_scope, sensitivity_class, resolution_reason,
               resolved_at, created_at
          from q_knowledge.contradiction_sets
         where tenant_id = ${input.tenantId}
           and subject_type = ${input.subject.subjectType}
           and subject_id = ${input.subject.subjectId}
           and knowledge_key = ${input.knowledgeKey}
           and coalesce(definition_qualifier, '') = ${input.definitionQualifier ?? ""}
           and measurement_basis = ${input.measurementBasis}
           and coalesce(contested_from, '-infinity'::timestamptz)
               = coalesce(${input.contestedFrom}::timestamptz, '-infinity'::timestamptz)
           and status = 'OPEN'
         for update`;

      const set =
        existing !== undefined
          ? toSet(existing)
          : await (async () => {
              const [created] = await tx.sql`
                insert into q_knowledge.contradiction_sets
                  (tenant_id, subject_type, subject_id, knowledge_key,
                   definition_qualifier, measurement_basis, contested_from,
                   conflict_kind, materiality, visibility_scope, sensitivity_class)
                values
                  (${input.tenantId}, ${input.subject.subjectType}, ${input.subject.subjectId},
                   ${input.knowledgeKey}, ${input.definitionQualifier},
                   ${input.measurementBasis}, ${input.contestedFrom},
                   ${input.conflictKind}, ${input.materiality},
                   ${input.visibilityScope}, ${input.sensitivityClass})
                returning id, tenant_id, subject_type, subject_id, knowledge_key,
                          definition_qualifier, measurement_basis, contested_from,
                          conflict_kind, materiality, status, visibility_scope,
                          sensitivity_class, resolution_reason, resolved_at, created_at`;
              return toSet(created);
            })();

      for (const [objectId, role] of [
        [input.incumbentObjectId, "INCUMBENT"],
        [input.challengerObjectId, "CHALLENGER"],
      ] as const) {
        await tx.sql`
          insert into q_knowledge.contradiction_members
            (tenant_id, contradiction_set_id, knowledge_object_id, role)
          values (${input.tenantId}, ${set.id}, ${objectId}, ${role})
          on conflict do nothing`;
      }
      return set;
    },

    findOpenFor: async (executor, tenantId, subject, knowledgeKey) => {
      const rows = await executor`
        select id, tenant_id, subject_type, subject_id, knowledge_key,
               definition_qualifier, measurement_basis, contested_from, conflict_kind,
               materiality, status, visibility_scope, sensitivity_class, resolution_reason,
               resolved_at, created_at
          from q_knowledge.contradiction_sets
         where tenant_id = ${tenantId}
           and subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}
           and knowledge_key = ${knowledgeKey}
           and status = 'OPEN'
         order by created_at`;
      return rows.map((row) => toSet(row));
    },

    listMembers: async (executor, tenantId, setId) => {
      const rows = await executor<
        { knowledge_object_id: string; role: string }[]
      >`
        select knowledge_object_id, role from q_knowledge.contradiction_members
         where tenant_id = ${tenantId} and contradiction_set_id = ${setId}
         order by role desc, knowledge_object_id`;
      return rows.map((row) => ({
        knowledgeObjectId: row.knowledge_object_id,
        role: row.role as "INCUMBENT",
      }));
    },

    listMemberObjects: async (executor, tenantId, setId) => {
      const rows = await executor`
        select o.id, o.tenant_id, o.subject_type, o.subject_id, o.knowledge_type,
               o.knowledge_key, o.statement, o.structured_value, o.truth_class,
               o.evidence_status, o.confidence_class, o.reliability_class, o.valid_from,
               o.valid_to, o.recorded_at, o.source_environment, o.visibility_scope,
               o.sensitivity_class, o.definition_qualifier, o.measurement_basis,
               o.last_verified_at, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
          join q_knowledge.contradiction_members m
            on m.knowledge_object_id = o.id and m.tenant_id = o.tenant_id
         where o.tenant_id = ${tenantId} and m.contradiction_set_id = ${setId}
         order by m.role desc, o.recorded_at`;
      return rows.map((row) => toKnowledgeObject(row));
    },

    settle: async (tx, input) => {
      const [row] = await tx.sql`
        update q_knowledge.contradiction_sets
           set status = ${input.status},
               resolution_reason = ${input.reason},
               resolved_at = now()
         where id = ${input.setId} and tenant_id = ${input.tenantId}
           and status = 'OPEN'
        returning id, tenant_id, subject_type, subject_id, knowledge_key,
                  definition_qualifier, measurement_basis, contested_from,
                  conflict_kind, materiality, status, visibility_scope,
                  sensitivity_class, resolution_reason, resolved_at, created_at`;
      if (row === undefined) {
        throw new Error("no open contradiction to settle");
      }
      return toSet(row);
    },

    countOpenForSubject: async (executor, tenantId, subject) => {
      const rows = await executor<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.contradiction_sets
         where tenant_id = ${tenantId}
           and subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}
           and status = 'OPEN'`;
      return rows[0]?.n ?? 0;
    },
  };
}
