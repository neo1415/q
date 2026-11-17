import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import { z } from "zod";

import type { MalwareScanner, MalwareVerdict } from "./malware.js";

/**
 * Scanning what was never scanned (decision 104; ADR 0042, reversal step 2).
 *
 * While no scanner existed, files were processed under the interim policy
 * and recorded NOT_SCANNED. Once ClamAV is attached, each of those versions
 * is scanned here and its record follows the scanner's verdict, and only
 * that verdict:
 *
 *   CLEAN     NOT_SCANNED -> CLEAN
 *   INFECTED  NOT_SCANNED -> BLOCKED, and every chunk set cut from that
 *             version is REVOKED (MALWARE_DETECTED), so Q retrieval, the
 *             page reads and every download that admits CLEAN/NOT_SCANNED
 *             stop serving it. The file stays in private storage; only its
 *             eligibility ends.
 *   ERROR / UNAVAILABLE  nothing changes; it stays NOT_SCANNED and is
 *             picked up by the next run.
 *
 * Bounded (oldest upload first, `limit` per run) and idempotent: every write
 * is a compare-and-set from NOT_SCANNED, so a second run, or two runs at
 * once, change nothing twice. It never re-extracts and calls no model.
 */

export type NotScannedVersion = {
  readonly documentVersionId: string;
  readonly tenantId: string;
  readonly bucket: string;
  readonly key: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
};

export type ScanBackfillStore = {
  readonly select: (limit: number) => Promise<readonly NotScannedVersion[]>;
  /** NOT_SCANNED -> CLEAN. False when it was no longer NOT_SCANNED. */
  readonly markClean: (version: NotScannedVersion) => Promise<boolean>;
  /** NOT_SCANNED -> BLOCKED and its chunk sets revoked, in one transaction. */
  readonly quarantine: (version: NotScannedVersion) => Promise<boolean>;
};

export type ScanBackfillResult =
  | { readonly kind: "REFUSED"; readonly reason: string }
  | {
      readonly kind: "DRY_RUN" | "APPLIED";
      readonly selected: number;
      readonly clean: number;
      readonly infected: number;
      /** Scanner errors: left NOT_SCANNED for the next run. */
      readonly failed: number;
      /** Already changed by another run between selection and write. */
      readonly skipped: number;
      readonly versions: readonly ScannedVersionOutcome[];
    };

export type ScannedVersionOutcome = {
  readonly documentVersionId: string;
  readonly tenantId: string;
  readonly outcome: "SELECTED" | "CLEAN" | "INFECTED" | "FAILED" | "SKIPPED";
  /** The scanner's signature name for an infected file; never content. */
  readonly signature?: string | undefined;
};

export const SCAN_BACKFILL_DEFAULT_LIMIT = 200;
const SCAN_BACKFILL_MAX_LIMIT = 1_000;

export async function scanNotScannedDocuments(options: {
  readonly store: ScanBackfillStore;
  readonly scanner: MalwareScanner;
  readonly apply: boolean;
  readonly limit?: number | undefined;
}): Promise<ScanBackfillResult> {
  // With no scanner every verdict would be UNAVAILABLE: nothing to learn.
  if (options.scanner.id === "none") {
    return {
      kind: "REFUSED",
      reason:
        "No scanner is attached: set CLAMAV_HOST (and CLAMAV_PORT) on the workers first.",
    };
  }
  const limit = Math.max(
    1,
    Math.min(
      options.limit ?? SCAN_BACKFILL_DEFAULT_LIMIT,
      SCAN_BACKFILL_MAX_LIMIT,
    ),
  );
  const selected = await options.store.select(limit);
  if (!options.apply) {
    return {
      kind: "DRY_RUN",
      selected: selected.length,
      clean: 0,
      infected: 0,
      failed: 0,
      skipped: 0,
      versions: selected.map((version) => ({
        documentVersionId: version.documentVersionId,
        tenantId: version.tenantId,
        outcome: "SELECTED" as const,
      })),
    };
  }
  let clean = 0;
  let infected = 0;
  let failed = 0;
  let skipped = 0;
  const versions: ScannedVersionOutcome[] = [];
  for (const version of selected) {
    const base = {
      documentVersionId: version.documentVersionId,
      tenantId: version.tenantId,
    };
    let verdict: MalwareVerdict | null;
    try {
      verdict = await options.scanner.scan({
        bucket: version.bucket,
        key: version.key,
        sizeBytes: version.sizeBytes,
        mimeType: version.mimeType,
      });
    } catch {
      verdict = null;
    }
    if (verdict?.status === "CLEAN") {
      if (await options.store.markClean(version)) {
        clean += 1;
        versions.push({ ...base, outcome: "CLEAN" });
      } else {
        skipped += 1;
        versions.push({ ...base, outcome: "SKIPPED" });
      }
    } else if (verdict?.status === "INFECTED") {
      if (await options.store.quarantine(version)) {
        infected += 1;
        versions.push({
          ...base,
          outcome: "INFECTED",
          ...(verdict.signature === undefined
            ? {}
            : { signature: verdict.signature }),
        });
      } else {
        skipped += 1;
        versions.push({ ...base, outcome: "SKIPPED" });
      }
    } else {
      failed += 1;
      versions.push({ ...base, outcome: "FAILED" });
    }
  }
  return {
    kind: "APPLIED",
    selected: selected.length,
    clean,
    infected,
    failed,
    skipped,
    versions,
  };
}

const SelectedRow = z.object({
  document_version_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  storage_bucket: z.string().min(1),
  storage_key: z.string().min(1),
  size_bytes: z.union([z.number(), z.string()]).transform(Number),
  mime_type: z.string().min(1),
});

/** The store, against evidence.document_versions and q_knowledge chunk sets. */
export function createPostgresScanBackfillStore(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): ScanBackfillStore {
  const { sql, transactions } = dependencies;
  return {
    select: async (limit) => {
      const rows = await sql`
        select v.id as document_version_id, v.tenant_id, v.storage_bucket,
               v.storage_key, v.size_bytes, v.mime_type
          from evidence.document_versions v
         where v.malware_scan_status = 'NOT_SCANNED'
         order by v.uploaded_at asc, v.id asc
         limit ${limit}`;
      return rows.map((row) => {
        const parsed = SelectedRow.parse(row);
        return {
          documentVersionId: parsed.document_version_id,
          tenantId: parsed.tenant_id,
          bucket: parsed.storage_bucket,
          key: parsed.storage_key,
          sizeBytes: parsed.size_bytes,
          mimeType: parsed.mime_type,
        };
      });
    },
    markClean: async (version) => {
      const rows = await sql`
        update evidence.document_versions
           set malware_scan_status = 'CLEAN'
         where id = ${version.documentVersionId}
           and tenant_id = ${version.tenantId}
           and malware_scan_status = 'NOT_SCANNED'
        returning id`;
      return rows.length === 1;
    },
    quarantine: (version) =>
      transactions.run(async (tx) => {
        const rows = await tx.sql`
          update evidence.document_versions
             set malware_scan_status = 'BLOCKED'
           where id = ${version.documentVersionId}
             and tenant_id = ${version.tenantId}
             and malware_scan_status = 'NOT_SCANNED'
          returning id`;
        if (rows.length !== 1) return false;
        const sets = await tx.sql`
          update q_knowledge.chunk_sets s
             set status = 'REVOKED',
                 status_reason = 'MALWARE_DETECTED',
                 invalidated_at = coalesce(s.invalidated_at, now())
           where s.tenant_id = ${version.tenantId}
             and s.document_version_id = ${version.documentVersionId}
             and s.status <> 'REVOKED'
          returning s.id`;
        const ids = z
          .array(z.object({ id: z.string().uuid() }))
          .parse(sets)
          .map((row) => row.id);
        if (ids.length > 0) {
          await tx.sql`
            update q_knowledge.chunks c
               set status = 'REVOKED',
                   invalidated_at = coalesce(c.invalidated_at, now())
             where c.tenant_id = ${version.tenantId}
               and c.chunk_set_id = any(${ids}::uuid[])
               and c.status <> 'REVOKED'`;
        }
        return true;
      }),
  };
}

/**
 * At worker start, only when a scanner is attached (the hosted worker has
 * no shell): one bounded run in the background, one log line, never fatal.
 * Ids and counts only; never a title or a byte of a document.
 */
export async function scanNotScannedDocumentsAtStart(options: {
  readonly store: ScanBackfillStore;
  readonly scanner: MalwareScanner;
  readonly logger: {
    readonly info: (fields: Record<string, unknown>, message: string) => void;
    readonly warn: (fields: Record<string, unknown>, message: string) => void;
  };
}): Promise<void> {
  if (options.scanner.id === "none") return;
  try {
    const result = await scanNotScannedDocuments({ ...options, apply: true });
    if (result.kind === "REFUSED") return;
    options.logger.info(
      {
        selected: result.selected,
        clean: result.clean,
        infected: result.infected,
        failed: result.failed,
        skipped: result.skipped,
      },
      "evidence.documents.not_scanned_scanned_at_start",
    );
    for (const version of result.versions) {
      if (version.outcome !== "INFECTED") continue;
      options.logger.warn(
        {
          documentVersionId: version.documentVersionId,
          tenantId: version.tenantId,
          signature: version.signature ?? null,
        },
        "evidence.documents.quarantined_infected",
      );
    }
  } catch (error: unknown) {
    options.logger.warn(
      { error: error instanceof Error ? error.name : "UNKNOWN" },
      "evidence.documents.not_scanned_scan_failed",
    );
  }
}
