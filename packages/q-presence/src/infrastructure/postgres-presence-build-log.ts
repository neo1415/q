import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema } from "@capital-q/security";

import {
  PresenceBuildStatusSchema,
  PresenceSubjectTypeSchema,
} from "../contracts.js";
import type { PresenceBuildLog } from "../ports.js";

/**
 * The build log in PostgreSQL. Parameterised SQL on the executor the caller
 * supplies; every statement names the tenant. It holds counts, status and
 * timing — no statement, no excerpt, no query, no model output — so a read
 * of this table can never disclose anything about a subject.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );

const BuildRow = z.object({
  id: z.string().uuid(),
  tenant_id: TenantIdSchema,
  subject_type: PresenceSubjectTypeSchema,
  subject_id: z.string().uuid(),
  status: PresenceBuildStatusSchema,
  source_count: z.number().int().min(0),
  understanding_count: z.number().int().min(0),
  failure_code: z.string().nullable(),
  started_at: Timestamp,
  completed_at: Timestamp.nullable(),
});

export function createPostgresPresenceBuildLog(options: {
  readonly sql: DatabaseExecutor;
}): PresenceBuildLog {
  const { sql } = options;
  return {
    latest: async (actor, subject) => {
      const rows = await sql`
        select id, tenant_id, subject_type, subject_id, status, source_count,
               understanding_count, failure_code, started_at, completed_at
          from q_knowledge.presence_builds
         where tenant_id = ${actor.tenantId}
           and subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}
         order by started_at desc
         limit 1`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = BuildRow.safeParse(rows[0]);
      if (!parsed.success) {
        // A malformed row is a server integrity problem, not a reason to
        // treat the subject as never read: refusing to decide is safer.
        return null;
      }
      const row = parsed.data;
      return {
        id: row.id,
        subject: {
          subjectType: row.subject_type,
          subjectId: row.subject_id,
        },
        status: row.status,
        sourceCount: row.source_count,
        understandingCount: row.understanding_count,
        failureCode: row.failure_code,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      };
    },

    start: async (actor, subject, correlationId) => {
      const rows = await sql`
        insert into q_knowledge.presence_builds
          (tenant_id, subject_type, subject_id, status, correlation_id)
        values
          (${actor.tenantId}, ${subject.subjectType}, ${subject.subjectId},
           'RUNNING', ${correlationId})
        returning id`;
      const parsed = z.object({ id: z.string().uuid() }).parse(rows[0]);
      return { id: parsed.id };
    },

    finish: async (actor, input) => {
      // The tenant is named even though the id is a uuid: an id is not a
      // permission, and one statement that forgets it is the whole rule.
      await sql`
        update q_knowledge.presence_builds
           set status = ${input.status},
               source_count = ${input.sourceCount},
               understanding_count = ${input.understandingCount},
               failure_code = ${input.failureCode},
               completed_at = now()
         where id = ${input.buildId}
           and tenant_id = ${actor.tenantId}`;
    },
  };
}
