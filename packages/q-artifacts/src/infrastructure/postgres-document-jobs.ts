import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  DOCUMENT_JOB_ATTEMPTS_MAX,
  DocumentJobInputSchema,
  DocumentJobKindSchema,
  DocumentJobStageSchema,
  type ClaimedDocumentJob,
  type DocumentJobRepository,
} from "../application/document-jobs.js";

/**
 * artifacts.document_jobs behind its port (Q room W5). Server-only: no
 * browser principal reaches the table, and every read for a person
 * carries their tenant, organisation and user into the `where` clause.
 */

/** A RUNNING job not touched for this long was abandoned by its worker. */
const STALE = "10 minutes";

const JobRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  artifact_id: z.string().uuid(),
  requested_by_user_id: z.string().uuid(),
  q_run_id: z.string().uuid(),
  kind: DocumentJobKindSchema,
  attempts: z.coerce.number().int(),
  input: z.unknown(),
});

const iso = (value: unknown): string =>
  value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();

export function createPostgresDocumentJobRepository(options: {
  readonly sql: DatabaseExecutor;
}): DocumentJobRepository {
  const { sql } = options;
  return {
    enqueue: async (tx, job) => {
      await tx.sql`
        insert into artifacts.document_jobs (
          tenant_id, organisation_id, artifact_id, requested_by_user_id,
          q_run_id, kind, input)
        values (
          ${job.tenantId}, ${job.organisationId}, ${job.artifactId},
          ${job.userId}, ${job.runId}, ${job.kind},
          ${tx.sql.json(DocumentJobInputSchema.parse(job.input))}::jsonb)`;
    },

    progress: async (actor, artifactId) => {
      const rows = await sql`
        select artifact_id, stage, status, updated_at
          from artifacts.document_jobs
         where artifact_id = ${artifactId}
           and tenant_id = ${actor.tenantId}
           and organisation_id = ${actor.organisationId ?? null}
         limit 1`;
      const row = rows[0];
      if (row === undefined) return null;
      const stage = DocumentJobStageSchema.safeParse(
        Reflect.get(Object(row), "stage"),
      );
      const status: unknown = Reflect.get(Object(row), "status");
      if (
        !stage.success ||
        (status !== "QUEUED" &&
          status !== "RUNNING" &&
          status !== "DONE" &&
          status !== "FAILED")
      ) {
        return null;
      }
      return {
        artifactId,
        stage: stage.data,
        status,
        updatedAt: iso(Reflect.get(Object(row), "updated_at")),
      };
    },

    claim: async () => {
      // Out of attempts, or the person who asked has left: failed, with
      // the artifact they would have filled (a resting state, not a gap).
      await sql`
        with gone as (
          update artifacts.document_jobs d
             set status = 'FAILED', stage = 'FAILED',
                 failure_code = case when d.attempts >= ${DOCUMENT_JOB_ATTEMPTS_MAX}
                                     then 'ATTEMPTS_EXHAUSTED' else 'REQUESTER_LEFT' end,
                 finished_at = now(), updated_at = now()
           where d.status in ('QUEUED', 'RUNNING')
             and (
               (d.attempts >= ${DOCUMENT_JOB_ATTEMPTS_MAX}
                 and (d.status = 'QUEUED' or d.updated_at < now() - ${STALE}::interval))
               or not exists (
                 select 1 from identity.organisation_memberships m
                  where m.organisation_id = d.organisation_id
                    and m.user_id = d.requested_by_user_id
                    and m.membership_status = 'active'))
          returning d.artifact_id)
        update artifacts.artifacts a
           set status = 'FAILED', updated_at = now()
          from gone
         where a.id = gone.artifact_id and a.status = 'PREPARING'`;
      const rows = await sql`
        update artifacts.document_jobs j
           set status = 'RUNNING', attempts = j.attempts + 1,
               started_at = now(), updated_at = now()
         where j.id = (
           select d.id from artifacts.document_jobs d
            where (d.status = 'QUEUED'
                   or (d.status = 'RUNNING' and d.updated_at < now() - ${STALE}::interval))
              and d.attempts < ${DOCUMENT_JOB_ATTEMPTS_MAX}
            order by d.created_at
            for update of d skip locked
            limit 1)
        returning j.id, j.tenant_id, j.organisation_id, j.artifact_id,
                  j.requested_by_user_id, j.q_run_id, j.kind, j.attempts,
                  j.input`;
      const row = rows[0];
      if (row === undefined) return null;
      const parsed = JobRow.parse(row);
      const input = DocumentJobInputSchema.safeParse(parsed.input);
      if (!input.success) {
        await sql`
          update artifacts.document_jobs
             set status = 'FAILED', stage = 'FAILED', failure_code = 'INVALID_INPUT',
                 finished_at = now(), updated_at = now()
           where id = ${parsed.id}`;
        return null;
      }
      const job: ClaimedDocumentJob = {
        id: parsed.id,
        tenantId: parsed.tenant_id,
        organisationId: parsed.organisation_id,
        artifactId: parsed.artifact_id,
        userId: parsed.requested_by_user_id,
        runId: parsed.q_run_id,
        kind: parsed.kind,
        attempts: parsed.attempts,
        input: input.data,
      };
      return job;
    },

    setStage: async (jobId, stage) => {
      await sql`
        update artifacts.document_jobs
           set stage = ${stage}, updated_at = now()
         where id = ${jobId} and status = 'RUNNING'`;
    },

    finish: async (jobId, outcome, failureCode) => {
      await sql`
        update artifacts.document_jobs
           set status = ${outcome},
               stage = ${outcome === "DONE" ? "READY" : "FAILED"},
               failure_code = ${outcome === "FAILED" ? (failureCode ?? "FAILED") : null},
               finished_at = now(), updated_at = now()
         where id = ${jobId}`;
    },

    release: async (jobId) => {
      await sql`
        update artifacts.document_jobs
           set status = 'QUEUED', stage = 'QUEUED', updated_at = now()
         where id = ${jobId} and status = 'RUNNING'`;
    },
  };
}
