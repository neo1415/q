import { randomUUID } from "node:crypto";

import {
  createJobSchema,
  JobIdSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { ProcessDocumentJob } from "@capital-q/evidence/jobs";
import { z } from "zod";

import { DOCUMENTS_QUEUE, type QueueClient } from "../queue/pgmq.js";
import type { MalwarePolicy } from "./malware.js";

/**
 * Re-drive (ADR 0042, founder decision 2026-10-03).
 *
 * Documents uploaded while no scanner existed were BLOCKED with
 * MALWARE_SCAN_UNAVAILABLE under the pipeline version of the day. Under the
 * interim policy they can now be processed: each gets one job under the
 * CURRENT pipeline version, which records a new run (the run table keeps
 * one run per version and pipeline version) and leaves the blocked run as
 * history. Idempotent twice over: a version that already has a run under
 * the current pipeline version is never selected, and a duplicate job is
 * absorbed by that same uniqueness. Nothing here writes a status.
 */

const ProcessDocumentJobSchema = createJobSchema(ProcessDocumentJob.dataSchema);

const Row = z.object({
  document_version_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  blocked_under: z.string(),
});

export type RedriveCandidate = {
  readonly documentVersionId: string;
  readonly tenantId: string;
  /** The pipeline version its blocked run was made under. */
  readonly blockedUnder: string;
};

/**
 * Versions whose LATEST run is BLOCKED for want of a scanner and that have
 * no run under `pipelineVersion` yet. Oldest upload first, bounded.
 */
export async function selectBlockedForRedrive(
  sql: DatabaseExecutor,
  pipelineVersion: string,
  limit = 500,
): Promise<readonly RedriveCandidate[]> {
  const rows = await sql`
    select v.id as document_version_id, v.tenant_id, latest.pipeline_version as blocked_under
      from evidence.document_versions v
      join lateral (
        select r.status, r.error_code, r.pipeline_version
          from evidence.document_processing_runs r
         where r.document_version_id = v.id
         order by r.created_at desc, r.id desc
         limit 1
      ) latest on true
     where latest.status = 'BLOCKED'
       and latest.error_code = 'MALWARE_SCAN_UNAVAILABLE'
       and not exists (
         select 1 from evidence.document_processing_runs r2
          where r2.document_version_id = v.id
            and r2.pipeline_version = ${pipelineVersion}
       )
     order by v.uploaded_at asc, v.id asc
     limit ${limit}`;
  return rows.map((row) => {
    const parsed = Row.parse(row);
    return {
      documentVersionId: parsed.document_version_id,
      tenantId: parsed.tenant_id,
      blockedUnder: parsed.blocked_under,
    };
  });
}

/**
 * TODO (ADR 0042, reversal): when a real scanner is attached, every
 * NOT_SCANNED version is scanned. This is that selection; the scan job
 * that consumes it arrives with the scanner.
 */
export async function selectNotScannedForScan(
  sql: DatabaseExecutor,
  limit = 500,
): Promise<
  readonly { readonly documentVersionId: string; readonly tenantId: string }[]
> {
  const rows = await sql`
    select v.id as document_version_id, v.tenant_id
      from evidence.document_versions v
     where v.malware_scan_status = 'NOT_SCANNED'
     order by v.uploaded_at asc, v.id asc
     limit ${limit}`;
  return rows.map((row) => {
    const parsed = z
      .object({
        document_version_id: z.string().uuid(),
        tenant_id: z.string().uuid(),
      })
      .parse(row);
    return {
      documentVersionId: parsed.document_version_id,
      tenantId: parsed.tenant_id,
    };
  });
}

export type RedriveResult =
  | { readonly kind: "REFUSED"; readonly reason: string }
  | {
      readonly kind: "DRY_RUN" | "APPLIED";
      readonly pipelineVersion: string;
      readonly candidates: readonly RedriveCandidate[];
      readonly enqueued: number;
    };

export async function redriveBlockedDocuments(options: {
  readonly sql: DatabaseExecutor;
  readonly queues: Pick<QueueClient, "send">;
  readonly pipelineVersion: string;
  readonly malwarePolicy: MalwarePolicy;
  readonly apply: boolean;
}): Promise<RedriveResult> {
  // Re-driving under REQUIRE_CLEAN would only block every file again.
  if (options.malwarePolicy === "REQUIRE_CLEAN") {
    return {
      kind: "REFUSED",
      reason:
        "CQ_MALWARE_POLICY is REQUIRE_CLEAN: with no scanner every file would be blocked again. Set ALLOW_UNSCANNED_WITH_WARNING (ADR 0042) first.",
    };
  }
  const candidates = await selectBlockedForRedrive(
    options.sql,
    options.pipelineVersion,
  );
  if (!options.apply) {
    return {
      kind: "DRY_RUN",
      pipelineVersion: options.pipelineVersion,
      candidates,
      enqueued: 0,
    };
  }
  let enqueued = 0;
  for (const candidate of candidates) {
    const job = ProcessDocumentJobSchema.parse({
      id: JobIdSchema.parse(randomUUID()),
      type: ProcessDocumentJob.name,
      jobVersion: ProcessDocumentJob.version,
      tenantId: candidate.tenantId,
      createdAt: UtcTimestampSchema.parse(new Date().toISOString()),
      data: {
        documentVersionId: candidate.documentVersionId,
        pipelineVersion: options.pipelineVersion,
      },
    });
    await options.queues.send(DOCUMENTS_QUEUE, job);
    enqueued += 1;
  }
  return {
    kind: "APPLIED",
    pipelineVersion: options.pipelineVersion,
    candidates,
    enqueued,
  };
}
