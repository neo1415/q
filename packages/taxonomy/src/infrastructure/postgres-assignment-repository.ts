import { z } from "zod";

import { UtcTimestampSchema, UuidSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import {
  TaxonomyAssignmentIdSchema,
  TaxonomyAssignmentSourceSchema,
  TaxonomyAssignmentStatusSchema,
  TaxonomyCanonicalCodeSchema,
  TaxonomyNodeIdSchema,
  TaxonomySubjectTypeSchema,
  TaxonomyVocabularyCodeSchema,
  type TaxonomyEntityAssignment,
} from "../contracts/index.js";
import type { TaxonomyAssignmentRepository } from "../application/ports.js";

/**
 * PostgreSQL adapter for entity assignments. Parameterised SQL only;
 * `entity_type` is bound as data and never selects a table. Confidence is
 * read as text so no probability passes through a JavaScript number. No
 * DELETE and no status setter beyond supersession exist.
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

const Row = z.object({
  id: TaxonomyAssignmentIdSchema,
  tenant_id: TenantIdSchema,
  entity_type: TaxonomySubjectTypeSchema,
  entity_id: UuidSchema,
  node_id: TaxonomyNodeIdSchema,
  vocabulary_code: TaxonomyVocabularyCodeSchema,
  canonical_code: TaxonomyCanonicalCodeSchema,
  assignment_source: TaxonomyAssignmentSourceSchema,
  confidence: z.string().nullable(),
  status: TaxonomyAssignmentStatusSchema,
  raw_source_text: z.string().nullable(),
  source_id: UuidSchema.nullable(),
  classification_run_id: UuidSchema.nullable(),
  confirmed_by_user_id: UserIdSchema.nullable(),
  confirmed_at: Timestamp.nullable(),
  valid_from: Timestamp,
  valid_to: Timestamp.nullable(),
  created_at: Timestamp,
});

function toAssignment(row: unknown): TaxonomyEntityAssignment {
  const r = Row.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    subjectType: r.entity_type,
    subjectId: r.entity_id,
    nodeId: r.node_id,
    vocabularyCode: r.vocabulary_code,
    canonicalCode: r.canonical_code,
    assignmentSource: r.assignment_source,
    confidence: r.confidence,
    status: r.status,
    rawSourceText: r.raw_source_text,
    sourceId: r.source_id,
    classificationRunId: r.classification_run_id,
    confirmedByUserId: r.confirmed_by_user_id,
    confirmedAt: r.confirmed_at,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    createdAt: r.created_at,
  };
}

function assignmentSelect(executor: DatabaseExecutor) {
  return executor`
    select a.id, a.tenant_id, a.entity_type, a.entity_id, a.node_id, v.code as vocabulary_code,
           n.canonical_code, a.assignment_source, a.confidence::text as confidence, a.status,
           a.raw_source_text, a.source_id, a.classification_run_id, a.confirmed_by_user_id,
           a.confirmed_at, a.valid_from, a.valid_to, a.created_at
      from taxonomy.entity_assignments a
      join taxonomy.nodes n on n.id = a.node_id
      join taxonomy.vocabularies v on v.id = n.vocabulary_id`;
}

export function createPostgresTaxonomyAssignmentRepository(): TaxonomyAssignmentRepository {
  return {
    lockSubject: async (tx, subject) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext('taxonomy.entity_assignments'),
          hashtext(${subject.subjectType}::text || ':' || ${subject.subjectId}::text))`;
    },
    listCurrent: async (executor, tenantId, subject, vocabularyCode) => {
      const rows = await executor`
        ${assignmentSelect(executor)}
         where a.tenant_id = ${tenantId}
           and a.entity_type = ${subject.subjectType}
           and a.entity_id = ${subject.subjectId}
           and a.status = 'ACTIVE'
           and a.valid_to is null
           and (${vocabularyCode ?? null}::text is null or v.code = ${vocabularyCode ?? null})
         order by v.code, n.canonical_code`;
      return rows.map(toAssignment);
    },
    listHistory: async (executor, tenantId, subject) => {
      const rows = await executor`
        ${assignmentSelect(executor)}
         where a.tenant_id = ${tenantId}
           and a.entity_type = ${subject.subjectType}
           and a.entity_id = ${subject.subjectId}
         order by a.valid_from, a.id`;
      return rows.map(toAssignment);
    },
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into taxonomy.entity_assignments
          (tenant_id, entity_type, entity_id, node_id, assignment_source, confidence,
           raw_source_text, source_id, classification_run_id, confirmed_by_user_id, confirmed_at)
        values
          (${input.tenantId}, ${input.subjectType}, ${input.subjectId}, ${input.nodeId},
           ${input.assignmentSource}, ${input.confidence}::text::numeric, ${input.rawSourceText},
           ${input.sourceId}, ${input.classificationRunId}, ${input.confirmedByUserId},
           ${input.confirmedAt}::text::timestamptz)
        returning id`;
      const inserted = z
        .object({ id: TaxonomyAssignmentIdSchema })
        .parse(rows[0]);
      const created = await tx.sql`
        ${assignmentSelect(tx.sql)} where a.id = ${inserted.id}`;
      return toAssignment(created[0]);
    },
    supersede: async (tx, tenantId, assignmentIds) => {
      if (assignmentIds.length === 0) {
        return 0;
      }
      const rows = await tx.sql`
        update taxonomy.entity_assignments a
           set status = 'SUPERSEDED', valid_to = clock_timestamp()
         where a.tenant_id = ${tenantId}
           and a.id = any(${[...assignmentIds]}::uuid[])
           and a.status = 'ACTIVE'
           and a.valid_to is null
        returning a.id`;
      return rows.length;
    },
  };
}
