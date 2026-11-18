import {
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";

import { executeAccountDeletion, type DeletionOutcome } from "./deletion.js";
import { buildExportArchive, collectPersonData } from "./export-builder.js";
import { KEPT_AFTER_DELETION } from "./inventory.js";
import {
  organisationsForDeletion,
  type OrganisationForDeletion,
} from "./organisations.js";
import {
  DATA_EXPORT_BUCKET,
  type AuthAccountRemover,
  type DataRightsLogger,
  type DataRightsStorage,
} from "./ports.js";

/**
 * Data rights requests (decision 107). The person is always the verified
 * session's profile id, passed in by the route; nothing a client sends
 * names whose data is read or deleted.
 *
 *   export     requested (rate limited), built by the workers into a ZIP in
 *              the private export bucket, announced, downloadable through a
 *              five-minute signed link, and deleted after seven days.
 *   deletion   confirmed with a fresh re-authentication and typed words,
 *              scheduled after a 14-day grace period the person can cancel,
 *              then executed by the workers (deletion.ts).
 */

export const DATA_RIGHTS_POLICY = {
  /** Exports a person may ask for in 24 hours. */
  exportsPerDay: 3,
  /** How long a built export stays downloadable. */
  exportDays: 7,
  /** How long one signed download link works. */
  downloadLinkSeconds: 300,
  /** The grace period before a deletion runs. */
  graceDays: 14,
  /** How recent the re-authentication must be. */
  stepUpSeconds: 300,
  /** What the person types to confirm. */
  confirmationWords: "DELETE MY ACCOUNT",
  /** A worker's hold on an export build. */
  buildLeaseMinutes: 15,
} as const;

export type ExportStatus =
  "REQUESTED" | "BUILDING" | "READY" | "FAILED" | "EXPIRED";
export type DeletionStatus =
  "SCHEDULED" | "CANCELLED" | "PROCESSING" | "BLOCKED" | "COMPLETED";

export type ExportView = {
  readonly id: string;
  readonly status: ExportStatus;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly expiresAt: string | null;
  readonly byteSize: number | null;
};

export type DeletionView = {
  readonly id: string;
  readonly status: DeletionStatus;
  readonly requestedAt: string;
  readonly scheduledFor: string;
  readonly blockedReason: string | null;
};

export type DataRightsOverview = {
  readonly latestExport: ExportView | null;
  readonly exportsLeftToday: number;
  readonly deletion: DeletionView | null;
  readonly organisations: readonly OrganisationForDeletion[];
  readonly kept: typeof KEPT_AFTER_DELETION;
  readonly policy: {
    readonly graceDays: number;
    readonly exportDays: number;
    readonly confirmationWords: string;
  };
};

export type RequestExportOutcome =
  | {
      readonly kind: "REQUESTED" | "ALREADY_REQUESTED";
      readonly export: ExportView;
    }
  | { readonly kind: "RATE_LIMITED"; readonly retryAfterSeconds: number }
  | { readonly kind: "NOT_AVAILABLE" };

export type DownloadOutcome =
  | { readonly kind: "LINK"; readonly url: string; readonly expiresAt: string }
  | { readonly kind: "NOT_FOUND" };

export type StepUpProof = {
  /** The auth account the fresh token was verified for. */
  readonly authUserId: string;
  readonly method: "password" | "otp" | "totp";
  /** Unix seconds of that re-authentication, from the verified token. */
  readonly at: number;
};

export type RequestDeletionOutcome =
  | {
      readonly kind: "SCHEDULED" | "ALREADY_SCHEDULED";
      readonly deletion: DeletionView;
    }
  | { readonly kind: "STEP_UP_REQUIRED" }
  | { readonly kind: "CONFIRMATION_MISMATCH" }
  | {
      readonly kind: "TRANSFER_REQUIRED";
      readonly organisations: readonly OrganisationForDeletion[];
    }
  | { readonly kind: "ORGANISATIONS_CHANGED" }
  | { readonly kind: "NOT_AVAILABLE" };

export type CancelDeletionOutcome =
  | { readonly kind: "CANCELLED" }
  | { readonly kind: "NOTHING_TO_CANCEL" }
  | { readonly kind: "TOO_LATE" };

type ExportRow = {
  id: string;
  status: ExportStatus;
  requested_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  byte_size: string | number | null;
};

type DeletionRow = {
  id: string;
  status: DeletionStatus;
  requested_at: Date;
  scheduled_for: Date;
  failure_code: string | null;
};

const iso = (value: Date | null): string | null =>
  value === null ? null : new Date(value).toISOString();

const exportView = (row: ExportRow): ExportView => ({
  id: row.id,
  status: row.status,
  requestedAt: new Date(row.requested_at).toISOString(),
  completedAt: iso(row.completed_at),
  expiresAt: iso(row.expires_at),
  byteSize: row.byte_size === null ? null : Number(row.byte_size),
});

const deletionView = (row: DeletionRow): DeletionView => ({
  id: row.id,
  status: row.status,
  requestedAt: new Date(row.requested_at).toISOString(),
  scheduledFor: new Date(row.scheduled_for).toISOString(),
  blockedReason: row.status === "BLOCKED" ? row.failure_code : null,
});

async function securityEvent(
  sql: DatabaseExecutor,
  userId: string,
  eventType: string,
  resourceType: string,
  resourceId: string,
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await sql`
    insert into audit.security_events (event_id, occurred_at, user_id, event_type, severity, resource_type, resource_id, metadata)
    values (gen_random_uuid(), clock_timestamp(), ${userId}, ${eventType}, 'INFO', ${resourceType}, ${resourceId}, ${jsonbParam(sql, metadata)})`;
}

async function activeProfile(
  sql: DatabaseExecutor,
  userId: string,
): Promise<boolean> {
  const rows = await sql<{ status: string }[]>`
    select status from identity.user_profiles where id = ${userId}`;
  return rows[0]?.status === "active";
}

export type DataRightsService = ReturnType<typeof createDataRightsService>;

export function createDataRightsService(options: {
  readonly transactions: TransactionManager;
  readonly storage?: DataRightsStorage | undefined;
}) {
  const { transactions } = options;

  const latestExport = async (sql: DatabaseExecutor, userId: string) => {
    const rows = await sql<ExportRow[]>`
      select id, status, requested_at, completed_at, expires_at, byte_size
        from identity.data_export_requests
       where user_id = ${userId}
       order by requested_at desc limit 1`;
    return rows[0] === undefined ? null : exportView(rows[0]);
  };

  const openDeletion = async (sql: DatabaseExecutor, userId: string) => {
    const rows = await sql<DeletionRow[]>`
      select id, status, requested_at, scheduled_for, failure_code
        from identity.account_deletion_requests
       where user_id = ${userId}
         and status in ('SCHEDULED', 'PROCESSING', 'BLOCKED')
       limit 1`;
    return rows[0] === undefined ? null : deletionView(rows[0]);
  };

  const exportsToday = async (sql: DatabaseExecutor, userId: string) => {
    const rows = await sql<{ n: number; oldest: Date | null }[]>`
      select count(*)::int as n, min(requested_at) as oldest
        from identity.data_export_requests
       where user_id = ${userId}
         and requested_at > clock_timestamp() - interval '24 hours'`;
    return { count: rows[0]?.n ?? 0, oldest: rows[0]?.oldest ?? null };
  };

  return {
    overview: (userId: string): Promise<DataRightsOverview> =>
      transactions.run(async (tx) => {
        const [latest, deletion, organisations, today] = [
          await latestExport(tx.sql, userId),
          await openDeletion(tx.sql, userId),
          await organisationsForDeletion(tx.sql, userId),
          await exportsToday(tx.sql, userId),
        ];
        return {
          latestExport: latest,
          exportsLeftToday: Math.max(
            0,
            DATA_RIGHTS_POLICY.exportsPerDay - today.count,
          ),
          deletion,
          organisations,
          kept: KEPT_AFTER_DELETION,
          policy: {
            graceDays: DATA_RIGHTS_POLICY.graceDays,
            exportDays: DATA_RIGHTS_POLICY.exportDays,
            confirmationWords: DATA_RIGHTS_POLICY.confirmationWords,
          },
        };
      }),

    /** Idempotent on the key: the same key answers with the same request. */
    requestExport: (input: {
      readonly userId: string;
      readonly idempotencyKey: string;
    }): Promise<RequestExportOutcome> =>
      transactions.run(async (tx) => {
        const sql = tx.sql;
        // One request at a time per person: serialise on their id.
        await sql`select pg_advisory_xact_lock(hashtextextended(${`data-export:${input.userId}`}, 0))`;
        const replay = await sql<ExportRow[]>`
          select id, status, requested_at, completed_at, expires_at, byte_size
            from identity.data_export_requests
           where user_id = ${input.userId} and idempotency_key = ${input.idempotencyKey}`;
        if (replay[0] !== undefined) {
          return { kind: "ALREADY_REQUESTED", export: exportView(replay[0]) };
        }
        if (!(await activeProfile(sql, input.userId)))
          return { kind: "NOT_AVAILABLE" };
        if ((await openDeletion(sql, input.userId))?.status === "PROCESSING") {
          return { kind: "NOT_AVAILABLE" };
        }
        const open = await sql<ExportRow[]>`
          select id, status, requested_at, completed_at, expires_at, byte_size
            from identity.data_export_requests
           where user_id = ${input.userId} and status in ('REQUESTED', 'BUILDING')`;
        if (open[0] !== undefined) {
          return { kind: "ALREADY_REQUESTED", export: exportView(open[0]) };
        }
        const today = await exportsToday(sql, input.userId);
        if (today.count >= DATA_RIGHTS_POLICY.exportsPerDay) {
          const oldest =
            today.oldest === null
              ? Date.now()
              : new Date(today.oldest).getTime();
          return {
            kind: "RATE_LIMITED",
            retryAfterSeconds: Math.max(
              60,
              Math.ceil((oldest + 24 * 3600 * 1000 - Date.now()) / 1000),
            ),
          };
        }
        const [row] = await sql<ExportRow[]>`
          insert into identity.data_export_requests (user_id, idempotency_key)
          values (${input.userId}, ${input.idempotencyKey})
          returning id, status, requested_at, completed_at, expires_at, byte_size`;
        if (row === undefined) return { kind: "NOT_AVAILABLE" };
        await securityEvent(
          sql,
          input.userId,
          "data_export_requested",
          "data_export_request",
          row.id,
        );
        return { kind: "REQUESTED", export: exportView(row) };
      }),

    /** A five-minute link to the person's own ready export; anything else is NOT_FOUND. */
    createDownloadLink: async (input: {
      readonly userId: string;
      readonly exportId: string;
    }): Promise<DownloadOutcome> => {
      const storage = options.storage;
      if (storage === undefined) return { kind: "NOT_FOUND" };
      const found = await transactions.run(async (tx) => {
        const rows = await tx.sql<
          {
            id: string;
            storage_bucket: string | null;
            storage_key: string;
            completed_at: Date;
          }[]
        >`
          select id, storage_bucket, storage_key, completed_at
            from identity.data_export_requests
           where id = ${input.exportId} and user_id = ${input.userId}
             and status = 'READY' and expires_at > clock_timestamp()`;
        const row = rows[0];
        if (row === undefined) return null;
        await securityEvent(
          tx.sql,
          input.userId,
          "data_export_downloaded",
          "data_export_request",
          row.id,
        );
        return row;
      });
      if (found === null) return { kind: "NOT_FOUND" };
      const day = new Date(found.completed_at).toISOString().slice(0, 10);
      const link = await storage.createDownloadAuthorization({
        object: {
          bucket: found.storage_bucket ?? DATA_EXPORT_BUCKET,
          key: found.storage_key,
        },
        expiresInSeconds: DATA_RIGHTS_POLICY.downloadLinkSeconds,
        downloadFilename: `capital-q-data-${day}.zip`,
      });
      return { kind: "LINK", url: link.url, expiresAt: link.providerExpiresAt };
    },

    preflight: (userId: string) =>
      transactions.run((tx) => organisationsForDeletion(tx.sql, userId)),

    /**
     * Schedules the deletion. Binds to what the person saw: the
     * organisations that close with the account must be exactly those
     * listed when they confirmed.
     */
    requestDeletion: (input: {
      readonly userId: string;
      readonly stepUp: StepUpProof | null;
      readonly confirmation: string;
      readonly organisationsToClose: readonly string[];
      readonly nowSeconds?: number | undefined;
    }): Promise<RequestDeletionOutcome> =>
      transactions.run(async (tx) => {
        const sql = tx.sql;
        await sql`select pg_advisory_xact_lock(hashtextextended(${`account-deletion:${input.userId}`}, 0))`;
        const existing = await openDeletion(sql, input.userId);
        if (existing !== null)
          return { kind: "ALREADY_SCHEDULED", deletion: existing };
        const profile = await sql<
          { status: string; auth_user_id: string | null }[]
        >`
          select status, auth_user_id from identity.user_profiles where id = ${input.userId}`;
        if (profile[0]?.status !== "active") return { kind: "NOT_AVAILABLE" };
        const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
        const proof = input.stepUp;
        if (
          proof === null ||
          proof.authUserId !== profile[0].auth_user_id ||
          now - proof.at > DATA_RIGHTS_POLICY.stepUpSeconds ||
          proof.at > now + 60
        ) {
          return { kind: "STEP_UP_REQUIRED" };
        }
        if (
          input.confirmation.trim().toUpperCase() !==
          DATA_RIGHTS_POLICY.confirmationWords
        ) {
          return { kind: "CONFIRMATION_MISMATCH" };
        }
        const organisations = await organisationsForDeletion(sql, input.userId);
        const blocking = organisations.filter(
          (o) => o.outcome === "TRANSFER_REQUIRED",
        );
        if (blocking.length > 0)
          return { kind: "TRANSFER_REQUIRED", organisations: blocking };
        const closing = organisations
          .filter((o) => o.outcome === "CLOSES_WITH_ACCOUNT")
          .map((o) => o.organisationId)
          .sort();
        const agreed = [...new Set(input.organisationsToClose)].sort();
        if (closing.join(",") !== agreed.join(","))
          return { kind: "ORGANISATIONS_CHANGED" };
        const [row] = await sql<DeletionRow[]>`
          insert into identity.account_deletion_requests
            (user_id, scheduled_for, step_up_method, step_up_at, organisations_to_close)
          values (${input.userId},
                  clock_timestamp() + make_interval(days => ${DATA_RIGHTS_POLICY.graceDays}),
                  ${proof.method}, to_timestamp(${proof.at}), ${closing}::uuid[])
          returning id, status, requested_at, scheduled_for, failure_code`;
        if (row === undefined) return { kind: "NOT_AVAILABLE" };
        await securityEvent(
          sql,
          input.userId,
          "account_deletion_scheduled",
          "account_deletion_request",
          row.id,
          {
            graceDays: DATA_RIGHTS_POLICY.graceDays,
            organisationsClosing: closing.length,
            stepUpMethod: proof.method,
          },
        );
        return { kind: "SCHEDULED", deletion: deletionView(row) };
      }),

    /** During the grace period (or while blocked). Once it runs, it is too late. */
    cancelDeletion: (userId: string): Promise<CancelDeletionOutcome> =>
      transactions.run(async (tx) => {
        const rows = await tx.sql<{ id: string; status: DeletionStatus }[]>`
          select id, status from identity.account_deletion_requests
           where user_id = ${userId} and status in ('SCHEDULED', 'PROCESSING', 'BLOCKED')
           for update`;
        const row = rows[0];
        if (row === undefined) return { kind: "NOTHING_TO_CANCEL" };
        if (row.status === "PROCESSING") return { kind: "TOO_LATE" };
        await tx.sql`
          update identity.account_deletion_requests
             set status = 'CANCELLED', cancelled_at = clock_timestamp(), lease_until = null
           where id = ${row.id}`;
        await securityEvent(
          tx.sql,
          userId,
          "account_deletion_cancelled",
          "account_deletion_request",
          row.id,
        );
        return { kind: "CANCELLED" };
      }),
  };
}

// --- worker jobs -------------------------------------------------------------

export type DataRightsJobs = ReturnType<typeof createDataRightsJobs>;

export function createDataRightsJobs(options: {
  readonly transactions: TransactionManager;
  readonly storage: DataRightsStorage;
  readonly auth: AuthAccountRemover;
  readonly logger?: DataRightsLogger | undefined;
}) {
  const { transactions, storage } = options;

  /** Builds one queued export, if any. True when it did work. */
  const buildNextExport = async (): Promise<boolean> => {
    const claimed = await transactions.run(async (tx) => {
      const rows = await tx.sql<{ id: string; user_id: string }[]>`
        update identity.data_export_requests
           set status = 'BUILDING', started_at = clock_timestamp(),
               attempts = least(attempts + 1, 100),
               lease_until = clock_timestamp() + make_interval(mins => ${DATA_RIGHTS_POLICY.buildLeaseMinutes})
         where id = (
           select id from identity.data_export_requests
            where status = 'REQUESTED'
               or (status = 'BUILDING' and lease_until < clock_timestamp())
            order by requested_at
            limit 1
            for update skip locked)
        returning id, user_id`;
      return rows[0] ?? null;
    });
    if (claimed === null) return false;
    try {
      const collected = await transactions.run(async (tx) => {
        const [person] = await tx.sql<
          { email: string | null; status: string }[]
        >`
          select lower(u.email) as email, p.status
            from identity.user_profiles p
            left join auth.users u on u.id = p.auth_user_id
           where p.id = ${claimed.user_id}`;
        if (person === undefined || person.status !== "active") return null;
        return collectPersonData(tx.sql, {
          userId: claimed.user_id,
          email: person.email,
        });
      });
      if (collected === null) throw new Error("PROFILE_NOT_ACTIVE");
      const at = new Date();
      const archive = await buildExportArchive(collected, storage, at);
      const key = `exports/${claimed.user_id}/${claimed.id}.zip`;
      await storage.putObject({
        object: { bucket: DATA_EXPORT_BUCKET, key },
        body: archive.zip,
        contentType: "application/zip",
      });
      await transactions.run(async (tx) => {
        const updated = await tx.sql<{ id: string }[]>`
          update identity.data_export_requests
             set status = 'READY', completed_at = clock_timestamp(),
                 expires_at = clock_timestamp() + make_interval(days => ${DATA_RIGHTS_POLICY.exportDays}),
                 storage_bucket = ${DATA_EXPORT_BUCKET}, storage_key = ${key},
                 byte_size = ${archive.zip.length}, manifest = ${jsonbParam(tx.sql, archive.manifest)},
                 lease_until = null, failure_code = null
           where id = ${claimed.id} and status = 'BUILDING'
          returning id`;
        if (updated.length === 0) return;
        await securityEvent(
          tx.sql,
          claimed.user_id,
          "data_export_ready",
          "data_export_request",
          claimed.id,
          {
            byteSize: archive.zip.length,
            tables: Object.keys(archive.manifest.tables).length,
            files: archive.manifest.files,
          },
        );
        // In-app notice, in the tenant of an organisation they work in. A
        // person with none sees the status on the settings page instead.
        await tx.sql`
          insert into communication.notifications
            (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
          select m.tenant_id, ${claimed.user_id}, 'DATA_EXPORT_READY',
                 'Your data download is ready',
                 ${`It stays available for ${DATA_RIGHTS_POLICY.exportDays} days. Download it from Settings, under Privacy.`},
                 '/settings/data', ${`data_export_ready:${claimed.id}`}, 'UPDATE'
            from identity.organisation_memberships m
           where m.user_id = ${claimed.user_id} and m.membership_status = 'active'
           order by m.joined_at
           limit 1
          on conflict do nothing`;
        await tx.sql`
          update identity.data_export_requests set notified_at = clock_timestamp()
           where id = ${claimed.id}`;
      });
      return true;
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z][A-Z_]{2,63}$/u.test(error.message)
          ? error.message
          : "BUILD_FAILED";
      await transactions.run(async (tx) => {
        await tx.sql`
          update identity.data_export_requests
             set status = case when attempts >= 3 then 'FAILED' else 'REQUESTED' end,
                 failure_code = ${code}, lease_until = null
           where id = ${claimed.id} and status = 'BUILDING'`;
      });
      options.logger?.warn(
        { exportId: claimed.id, code },
        "data export build failed",
      );
      return true;
    }
  };

  /** Deletes expired export files; the row stays as EXPIRED. */
  const expireExports = async (limit = 50): Promise<number> => {
    const due = await transactions.run(
      (tx) =>
        tx.sql<
          { id: string; storage_bucket: string | null; storage_key: string }[]
        >`
        select id, storage_bucket, storage_key from identity.data_export_requests
         where status = 'READY' and expires_at <= clock_timestamp()
         order by expires_at limit ${limit}`,
    );
    for (const row of due) {
      await storage.deleteObject({
        bucket: row.storage_bucket ?? DATA_EXPORT_BUCKET,
        key: row.storage_key,
      });
      await transactions.run(async (tx) => {
        await tx.sql`
          update identity.data_export_requests set status = 'EXPIRED'
           where id = ${row.id} and status = 'READY'`;
      });
    }
    return due.length;
  };

  /** Runs deletions whose grace period has passed. */
  const runDueDeletions = async (limit = 5): Promise<DeletionOutcome[]> => {
    const due = await transactions.run(
      (tx) =>
        tx.sql<{ id: string }[]>`
        select id from identity.account_deletion_requests
         where scheduled_for <= clock_timestamp()
           and (status = 'SCHEDULED'
                or (status = 'PROCESSING' and (lease_until is null or lease_until < clock_timestamp()))
                or (status = 'BLOCKED' and requested_at > clock_timestamp() - interval '90 days'))
         order by scheduled_for limit ${limit}`,
    );
    const outcomes: DeletionOutcome[] = [];
    for (const row of due) {
      try {
        const outcome = await executeAccountDeletion({
          transactions,
          storage,
          auth: options.auth,
          requestId: row.id,
        });
        outcomes.push(outcome);
        if (outcome.kind !== "NOT_DUE") {
          options.logger?.info(
            { deletionId: row.id, outcome: outcome.kind },
            "account deletion",
          );
        }
      } catch {
        // Left PROCESSING with its lease: the next pass after the lease retries.
        options.logger?.warn(
          { deletionId: row.id },
          "account deletion failed; will retry",
        );
      }
    }
    return outcomes;
  };

  return { buildNextExport, expireExports, runDueDeletions };
}

/**
 * The same request as a port for Q's action (`person.data.export.request`):
 * one service, one rate limit, whether the page or Q asks.
 */
export function dataExportPort(
  service: Pick<DataRightsService, "requestExport">,
) {
  return {
    request: async (input: {
      readonly userId: string;
      readonly idempotencyKey: string;
    }): Promise<RequestExportOutcome["kind"]> =>
      (await service.requestExport(input)).kind,
  };
}
