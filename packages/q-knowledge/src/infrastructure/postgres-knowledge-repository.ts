import { z } from "zod";

import {
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  QConfidenceLevelSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
} from "@capital-q/evidence/contracts";
import { TenantIdSchema, type TenantId } from "@capital-q/security";

import {
  KnowledgeKeySchema,
  KnowledgeStatusSchema,
  KnowledgeTypeSchema,
  type KnowledgeObject,
  type KnowledgeRevision,
  type KnowledgeSubjectRef,
} from "../knowledge/contracts.js";

/**
 * The knowledge store in Postgres (CQ-KNW-002 §40-§42).
 *
 * The only file that writes `q_knowledge.objects`, `revisions`,
 * `object_evidence`, `object_sources` and `lineage`. Every statement is
 * parameterised and every read takes an explicit tenant: there is no ambient
 * tenant, and no query here can be reached from a browser, an API route or a
 * model, because nothing above the application layer is given this module.
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

const ObjectRow = z.object({
  id: z.string().uuid(),
  tenant_id: TenantIdSchema,
  subject_type: z.literal("COMPANY"),
  subject_id: z.string().uuid(),
  knowledge_type: KnowledgeTypeSchema,
  knowledge_key: KnowledgeKeySchema,
  statement: z.string(),
  structured_value: z.record(z.string(), z.unknown()).nullable(),
  truth_class: TruthClassSchema,
  evidence_status: EvidenceStatusSchema,
  confidence_class: QConfidenceLevelSchema,
  reliability_class: z.string().nullable(),
  valid_from: NullableTimestamp,
  valid_to: NullableTimestamp,
  recorded_at: Timestamp,
  source_environment: z.enum([
    "PLATFORM",
    "DOCUMENT",
    "CONVERSATION",
    "MEETING",
    "INTEGRATION",
    "PUBLIC",
  ]),
  visibility_scope: MarketplaceVisibilitySchema,
  sensitivity_class: MessageSensitivitySchema,
  status: KnowledgeStatusSchema,
  hold_reason: z.string().nullable(),
  reassessment_required_at: NullableTimestamp,
  reassessment_reason: z.string().nullable(),
  current_revision_number: z.number().int(),
  created_at: Timestamp,
});

export function toKnowledgeObject(row: unknown): KnowledgeObject {
  const r = ObjectRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    subject: { subjectType: r.subject_type, subjectId: r.subject_id },
    knowledgeType: r.knowledge_type,
    knowledgeKey: r.knowledge_key,
    statement: r.statement,
    structuredValue: r.structured_value,
    truthClass: r.truth_class,
    evidenceStatus: r.evidence_status,
    confidenceClass: r.confidence_class,
    reliabilityClass: r.reliability_class,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    recordedAt: r.recorded_at,
    sourceEnvironment: r.source_environment,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    status: r.status,
    holdReason: r.hold_reason,
    reassessmentRequiredAt: r.reassessment_required_at,
    reassessmentReason: r.reassessment_reason,
    currentRevisionNumber: r.current_revision_number,
    createdAt: r.created_at,
  };
}

const RevisionRow = z.object({
  id: z.string().uuid(),
  knowledge_object_id: z.string().uuid(),
  revision_number: z.number().int(),
  statement: z.string(),
  structured_value: z.record(z.string(), z.unknown()).nullable(),
  truth_class: TruthClassSchema,
  evidence_status: EvidenceStatusSchema,
  confidence_class: QConfidenceLevelSchema,
  valid_from: NullableTimestamp,
  valid_to: NullableTimestamp,
  change_reason: z.string(),
  created_by_type: z.enum(["USER", "SYSTEM", "Q"]),
  created_by_id: z.string().uuid().nullable(),
  created_at: Timestamp,
});

function toRevision(row: unknown): KnowledgeRevision {
  const r = RevisionRow.parse(row);
  return {
    id: r.id,
    knowledgeObjectId: r.knowledge_object_id,
    revisionNumber: r.revision_number,
    statement: r.statement,
    structuredValue: r.structured_value,
    truthClass: r.truth_class,
    evidenceStatus: r.evidence_status,
    confidenceClass: r.confidence_class,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    changeReason: r.change_reason,
    createdByType: r.created_by_type,
    createdById: r.created_by_id,
    createdAt: r.created_at,
  };
}

export type NewKnowledgeObject = {
  readonly tenantId: TenantId;
  readonly subject: KnowledgeSubjectRef;
  readonly knowledgeType: KnowledgeObject["knowledgeType"];
  readonly knowledgeKey: string;
  readonly statement: string;
  readonly structuredValue: Record<string, unknown> | null;
  readonly truthClass: KnowledgeObject["truthClass"];
  readonly evidenceStatus: KnowledgeObject["evidenceStatus"];
  readonly confidenceClass: KnowledgeObject["confidenceClass"];
  readonly reliabilityClass: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly sourceEnvironment: KnowledgeObject["sourceEnvironment"];
  readonly visibilityScope: KnowledgeObject["visibilityScope"];
  readonly sensitivityClass: KnowledgeObject["sensitivityClass"];
  readonly status: KnowledgeObject["status"];
  readonly holdReason: string | null;
  readonly changeReason: string;
  readonly createdByType: "USER" | "SYSTEM" | "Q";
  readonly createdById: string | null;
};

export type KnowledgeRepository = {
  /** Inserts the object and its revision 1 together, or neither. */
  readonly insert: (
    tx: TransactionContext,
    input: NewKnowledgeObject,
  ) => Promise<KnowledgeObject>;
  /** Appends revision N+1 and advances the projection. */
  readonly revise: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly objectId: string;
      readonly statement: string;
      readonly structuredValue: Record<string, unknown> | null;
      readonly truthClass: KnowledgeObject["truthClass"];
      readonly evidenceStatus: KnowledgeObject["evidenceStatus"];
      readonly confidenceClass: KnowledgeObject["confidenceClass"];
      readonly validFrom: string | null;
      readonly validTo: string | null;
      readonly changeReason: string;
      readonly createdByType: "USER" | "SYSTEM" | "Q";
      readonly createdById: string | null;
      readonly status?: KnowledgeObject["status"] | undefined;
      readonly reassessmentReason?: string | null | undefined;
    },
  ) => Promise<KnowledgeObject>;
  readonly findActiveByKey: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    subject: KnowledgeSubjectRef,
    knowledgeKey: string,
  ) => Promise<KnowledgeObject | null>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    objectId: string,
  ) => Promise<KnowledgeObject | null>;
  readonly listRevisions: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    objectId: string,
  ) => Promise<readonly KnowledgeRevision[]>;
  readonly linkEvidence: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly objectId: string;
      readonly evidenceItemId: string;
      readonly relationship:
        "SUPPORTS" | "CONTRADICTS" | "QUALIFIES" | "SUPERSEDES";
    },
  ) => Promise<void>;
  readonly linkSource: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly objectId: string;
      readonly sourceId: string;
    },
  ) => Promise<void>;
  readonly linkLineage: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly parentObjectId: string;
      readonly childObjectId: string;
      readonly relationship:
        | "derived_from"
        | "depends_on"
        | "supports"
        | "reassesses"
        | "supersedes";
    },
  ) => Promise<void>;
  readonly listEvidenceLinks: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    objectId: string,
  ) => Promise<
    readonly {
      readonly evidenceItemId: string;
      readonly relationship:
        "SUPPORTS" | "CONTRADICTS" | "QUALIFIES" | "SUPERSEDES";
    }[]
  >;
  readonly listSourceIds: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    objectId: string,
  ) => Promise<readonly string[]>;
  /** Objects resting on any of these evidence items. The revocation seam. */
  readonly listDependentsOfEvidence: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    evidenceItemIds: readonly string[],
  ) => Promise<readonly KnowledgeObject[]>;
  readonly listDependentsOfSource: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    sourceId: string,
  ) => Promise<readonly KnowledgeObject[]>;
  readonly markReassessment: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly objectId: string;
      readonly reason: string;
    },
  ) => Promise<void>;
};

export function createPostgresKnowledgeRepository(): KnowledgeRepository {
  return {
    insert: async (tx, input) => {
      const [inserted] = await tx.sql<{ id: string }[]>`
        insert into q_knowledge.objects
          (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key,
           statement, structured_value, truth_class, evidence_status, confidence_class,
           reliability_class, valid_from, valid_to, source_environment,
           visibility_scope, sensitivity_class, status, hold_reason)
        values
          (${input.tenantId}, ${input.subject.subjectType}, ${input.subject.subjectId},
           ${input.knowledgeType}, ${input.knowledgeKey}, ${input.statement},
           ${input.structuredValue === null ? null : JSON.stringify(input.structuredValue)}::text::jsonb,
           ${input.truthClass}, ${input.evidenceStatus}, ${input.confidenceClass},
           ${input.reliabilityClass}, ${input.validFrom}, ${input.validTo},
           ${input.sourceEnvironment}, ${input.visibilityScope}, ${input.sensitivityClass},
           ${input.status}, ${input.holdReason})
        returning id`;
      if (inserted === undefined) {
        throw new Error("knowledge object insert returned no row");
      }
      const [revision] = await tx.sql<{ id: string }[]>`
        insert into q_knowledge.revisions
          (tenant_id, knowledge_object_id, revision_number, statement, structured_value,
           truth_class, evidence_status, confidence_class, valid_from, valid_to,
           change_reason, created_by_type, created_by_id)
        values
          (${input.tenantId}, ${inserted.id}, 1, ${input.statement},
           ${input.structuredValue === null ? null : JSON.stringify(input.structuredValue)}::text::jsonb,
           ${input.truthClass}, ${input.evidenceStatus}, ${input.confidenceClass},
           ${input.validFrom}, ${input.validTo}, ${input.changeReason},
           ${input.createdByType}, ${input.createdById})
        returning id`;
      await tx.sql`
        update q_knowledge.objects set current_revision_id = ${revision?.id ?? null}
         where id = ${inserted.id} and tenant_id = ${input.tenantId}`;
      const [row] = await tx.sql`
        select id, tenant_id, subject_type, subject_id, knowledge_type,
               knowledge_key, statement, structured_value, truth_class, evidence_status,
               confidence_class, reliability_class, valid_from, valid_to, recorded_at,
               source_environment, visibility_scope, sensitivity_class, status, hold_reason,
               reassessment_required_at, reassessment_reason, current_revision_number, created_at
          from q_knowledge.objects
         where id = ${inserted.id} and tenant_id = ${input.tenantId}`;
      return toKnowledgeObject(row);
    },

    revise: async (tx, input) => {
      // The projection is advanced from the object's own current number, so
      // two concurrent revisions cannot both claim N+1: the unique index on
      // (object, revision_number) refuses the loser.
      const [current] = await tx.sql<{ current_revision_number: number }[]>`
        select current_revision_number from q_knowledge.objects
         where id = ${input.objectId} and tenant_id = ${input.tenantId}
         for update`;
      if (current === undefined) {
        throw new Error("knowledge object not found for revision");
      }
      const next = current.current_revision_number + 1;
      const [revision] = await tx.sql<{ id: string }[]>`
        insert into q_knowledge.revisions
          (tenant_id, knowledge_object_id, revision_number, statement, structured_value,
           truth_class, evidence_status, confidence_class, valid_from, valid_to,
           change_reason, created_by_type, created_by_id)
        values
          (${input.tenantId}, ${input.objectId}, ${next}, ${input.statement},
           ${input.structuredValue === null ? null : JSON.stringify(input.structuredValue)}::text::jsonb,
           ${input.truthClass}, ${input.evidenceStatus}, ${input.confidenceClass},
           ${input.validFrom}, ${input.validTo}, ${input.changeReason},
           ${input.createdByType}, ${input.createdById})
        returning id`;
      await tx.sql`
        update q_knowledge.objects
           set statement = ${input.statement},
               structured_value = ${input.structuredValue === null ? null : JSON.stringify(input.structuredValue)}::text::jsonb,
               truth_class = ${input.truthClass},
               evidence_status = ${input.evidenceStatus},
               confidence_class = ${input.confidenceClass},
               valid_from = ${input.validFrom},
               valid_to = ${input.validTo},
               status = coalesce(${input.status ?? null}, status),
               reassessment_reason = ${input.reassessmentReason ?? null},
               reassessment_required_at = case when ${input.reassessmentReason ?? null}::text is null
                                              then null else now() end,
               current_revision_id = ${revision?.id ?? null},
               current_revision_number = ${next}
         where id = ${input.objectId} and tenant_id = ${input.tenantId}`;
      const [row] = await tx.sql`
        select id, tenant_id, subject_type, subject_id, knowledge_type,
               knowledge_key, statement, structured_value, truth_class, evidence_status,
               confidence_class, reliability_class, valid_from, valid_to, recorded_at,
               source_environment, visibility_scope, sensitivity_class, status, hold_reason,
               reassessment_required_at, reassessment_reason, current_revision_number, created_at
          from q_knowledge.objects
         where id = ${input.objectId} and tenant_id = ${input.tenantId}`;
      return toKnowledgeObject(row);
    },

    findActiveByKey: async (executor, tenantId, subject, knowledgeKey) => {
      const [row] = await executor`
        select id, tenant_id, subject_type, subject_id, knowledge_type, knowledge_key,
               statement, structured_value, truth_class, evidence_status, confidence_class,
               reliability_class, valid_from, valid_to, recorded_at, source_environment,
               visibility_scope, sensitivity_class, status, hold_reason,
               reassessment_required_at, reassessment_reason, current_revision_number, created_at
          from q_knowledge.objects
         where tenant_id = ${tenantId}
           and subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}
           and knowledge_key = ${knowledgeKey}
           and status = 'ACTIVE'`;
      return row === undefined ? null : toKnowledgeObject(row);
    },

    findById: async (executor, tenantId, objectId) => {
      const [row] = await executor`
        select id, tenant_id, subject_type, subject_id, knowledge_type, knowledge_key,
               statement, structured_value, truth_class, evidence_status, confidence_class,
               reliability_class, valid_from, valid_to, recorded_at, source_environment,
               visibility_scope, sensitivity_class, status, hold_reason,
               reassessment_required_at, reassessment_reason, current_revision_number, created_at
          from q_knowledge.objects
         where tenant_id = ${tenantId} and id = ${objectId}`;
      return row === undefined ? null : toKnowledgeObject(row);
    },

    listRevisions: async (executor, tenantId, objectId) => {
      const rows = await executor`
        select id, knowledge_object_id, revision_number, statement, structured_value,
               truth_class, evidence_status, confidence_class, valid_from, valid_to,
               change_reason, created_by_type, created_by_id, created_at
          from q_knowledge.revisions
         where tenant_id = ${tenantId} and knowledge_object_id = ${objectId}
         order by revision_number`;
      return rows.map((row) => toRevision(row));
    },

    linkEvidence: async (tx, input) => {
      await tx.sql`
        insert into q_knowledge.object_evidence
          (tenant_id, knowledge_object_id, evidence_item_id, relationship)
        values (${input.tenantId}, ${input.objectId}, ${input.evidenceItemId}, ${input.relationship})
        on conflict do nothing`;
    },

    linkSource: async (tx, input) => {
      await tx.sql`
        insert into q_knowledge.object_sources (tenant_id, knowledge_object_id, source_id)
        values (${input.tenantId}, ${input.objectId}, ${input.sourceId})
        on conflict do nothing`;
    },

    linkLineage: async (tx, input) => {
      await tx.sql`
        insert into q_knowledge.lineage
          (tenant_id, parent_object_id, child_object_id, relationship)
        values (${input.tenantId}, ${input.parentObjectId}, ${input.childObjectId}, ${input.relationship})
        on conflict do nothing`;
    },

    listEvidenceLinks: async (executor, tenantId, objectId) => {
      const rows = await executor<
        { evidence_item_id: string; relationship: string }[]
      >`
        select evidence_item_id, relationship from q_knowledge.object_evidence
         where tenant_id = ${tenantId} and knowledge_object_id = ${objectId}
         order by relationship, evidence_item_id`;
      return rows.map((row) => ({
        evidenceItemId: row.evidence_item_id,
        relationship: row.relationship as "SUPPORTS",
      }));
    },

    listSourceIds: async (executor, tenantId, objectId) => {
      const rows = await executor<{ source_id: string }[]>`
        select source_id from q_knowledge.object_sources
         where tenant_id = ${tenantId} and knowledge_object_id = ${objectId}
         order by source_id`;
      return rows.map((row) => row.source_id);
    },

    listDependentsOfEvidence: async (executor, tenantId, evidenceItemIds) => {
      if (evidenceItemIds.length === 0) {
        return [];
      }
      const ids = [...evidenceItemIds];
      const rows = await executor`
        select distinct o.id, o.tenant_id, o.subject_type, o.subject_id, o.knowledge_type,
               o.knowledge_key, o.statement, o.structured_value, o.truth_class,
               o.evidence_status, o.confidence_class, o.reliability_class, o.valid_from,
               o.valid_to, o.recorded_at, o.source_environment, o.visibility_scope,
               o.sensitivity_class, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
          join q_knowledge.object_evidence e
            on e.knowledge_object_id = o.id and e.tenant_id = o.tenant_id
         where o.tenant_id = ${tenantId}
           and e.evidence_item_id = any(${ids}::uuid[])
           and e.relationship = 'SUPPORTS'`;
      return rows.map((row) => toKnowledgeObject(row));
    },

    listDependentsOfSource: async (executor, tenantId, sourceId) => {
      const rows = await executor`
        select distinct o.id, o.tenant_id, o.subject_type, o.subject_id, o.knowledge_type,
               o.knowledge_key, o.statement, o.structured_value, o.truth_class,
               o.evidence_status, o.confidence_class, o.reliability_class, o.valid_from,
               o.valid_to, o.recorded_at, o.source_environment, o.visibility_scope,
               o.sensitivity_class, o.status, o.hold_reason, o.reassessment_required_at,
               o.reassessment_reason, o.current_revision_number, o.created_at
          from q_knowledge.objects o
          join q_knowledge.object_sources s
            on s.knowledge_object_id = o.id and s.tenant_id = o.tenant_id
         where o.tenant_id = ${tenantId} and s.source_id = ${sourceId}`;
      return rows.map((row) => toKnowledgeObject(row));
    },

    markReassessment: async (tx, input) => {
      await tx.sql`
        update q_knowledge.objects
           set reassessment_required_at = now(), reassessment_reason = ${input.reason}
         where id = ${input.objectId} and tenant_id = ${input.tenantId}`;
    },
  };
}
