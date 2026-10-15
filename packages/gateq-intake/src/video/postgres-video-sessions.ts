import { z } from "zod";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import type {
  GateqVideoSessionRow,
  GateqVideoSessionStore,
} from "./video-interview.js";

const Row = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  application_id: z.string().uuid(),
  status: z.enum(["STARTING", "LIVE", "ENDED"]),
  ended_reason: z
    .enum([
      "APPLICANT_ENDED",
      "CONTINUED_BY_TYPING",
      "TIME_LIMIT",
      "PROVIDER_FAILED",
      "SWEPT",
    ])
    .nullable(),
  provider_conversation_id: z.string().nullable(),
  join_url_sealed: z.string().nullable(),
  guest_credential_sealed: z.string(),
  max_seconds: z.coerce.number().int(),
  created_at: z.coerce.date(),
  ends_at: z.coerce.date(),
});

const toRow = (raw: unknown): GateqVideoSessionRow => {
  const r = Row.parse(raw);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    applicationId: r.application_id,
    status: r.status,
    endedReason: r.ended_reason,
    providerConversationId: r.provider_conversation_id,
    joinUrlSealed: r.join_url_sealed,
    guestCredentialSealed: r.guest_credential_sealed,
    maxSeconds: r.max_seconds,
    createdAt: r.created_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
  };
};

/** Server-only store for gateq.application_video_sessions. */
const AllowanceRow = z.object({
  weekly_sessions: z.coerce.number().int().min(0),
  remaining: z.coerce.number().int().min(0),
  resets_at: z.coerce.date(),
});

/**
 * The shared weekly allowance and the account's monthly safeguard are
 * enforced by the database when the session row is inserted (migration
 * 20261226150000), inside this same transaction: a refusal rolls the
 * whole reservation back, so no room is ever created without one.
 */
async function reserveWithinAllowance<T>(
  run: () => Promise<T>,
): Promise<
  | T
  | { readonly kind: "WEEKLY_ALLOWANCE" }
  | { readonly kind: "PLATFORM_LIMIT" }
> {
  try {
    return await run();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message === "CQ_VIDEO_WEEKLY_ALLOWANCE_EXHAUSTED")
      return { kind: "WEEKLY_ALLOWANCE" };
    if (message === "CQ_VIDEO_GLOBAL_CAP") return { kind: "PLATFORM_LIMIT" };
    throw error;
  }
}

export function createPostgresGateqVideoSessions(deps: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): GateqVideoSessionStore {
  const { sql, transactions } = deps;
  return {
    reserve: (input) =>
      reserveWithinAllowance(() =>
        transactions.run(async (tx) => {
          // The application row lock orders this with Submit and with another
          // start for the same application; the advisory lock orders starts
          // across applications for the concurrency cap.
          const app = await tx.sql`
          select status from gateq.applications
          where id = ${input.applicationId} and tenant_id = ${input.tenantId} for update`;
          if (app.length !== 1 || app[0]?.["status"] === "SUBMITTED")
            return { kind: "ALLOWANCE" as const };
          await tx.sql`select pg_advisory_xact_lock(hashtextextended('gateq-video-sessions', 0))`;
          const open = await tx.sql`
          select * from gateq.application_video_sessions
           where application_id = ${input.applicationId} and status <> 'ENDED' and ends_at > now()
           order by created_at desc limit 1`;
          if (open[0] !== undefined)
            return { kind: "EXISTING" as const, row: toRow(open[0]) };
          const counts = z
            .object({ used: z.coerce.number(), live: z.coerce.number() })
            .parse(
              (
                await tx.sql`
            select
              (select count(*) from gateq.application_video_sessions where application_id = ${input.applicationId}) as used,
              (select count(*) from gateq.application_video_sessions where status <> 'ENDED' and ends_at > now()) as live`
              )[0],
            );
          if (counts.used >= input.perApplication)
            return { kind: "ALLOWANCE" as const };
          if (counts.live >= input.concurrency)
            return { kind: "CONCURRENCY" as const };
          const created = await tx.sql`
          insert into gateq.application_video_sessions
            (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, max_seconds, created_at, ends_at)
          values (${input.id}, ${input.tenantId}, ${input.applicationId}, ${input.bridgeTokenHash},
                  ${input.guestCredentialSealed}, ${input.maxSeconds}, now(),
                  now() + make_interval(secs => ${input.maxSeconds}))
          returning *`;
          return { kind: "CREATED" as const, row: toRow(created[0]) };
        }),
      ),
    allowanceFor: async (input) => {
      const rows = await sql`
        select weekly_sessions, remaining, resets_at
          from billing.video_allowance_status(
            billing.video_subject_for_application(${input.applicationId}, ${input.tenantId}))`;
      const row = AllowanceRow.safeParse(rows[0]);
      return row.success
        ? {
            weeklySessions: row.data.weekly_sessions,
            remaining: row.data.remaining,
            resetsAt: row.data.resets_at.toISOString(),
          }
        : null;
    },
    markLive: async (input) => {
      await sql`
        update gateq.application_video_sessions
           set status = 'LIVE', provider_conversation_id = ${input.providerConversationId},
               join_url_sealed = ${input.joinUrlSealed}
         where id = ${input.id} and status = 'STARTING'`;
    },
    end: async (input) => {
      const rows = await sql`
        update gateq.application_video_sessions
           set status = 'ENDED', ended_reason = ${input.reason}, ended_at = now()
         where id = ${input.id} and status <> 'ENDED'
         returning *`;
      if (rows[0] !== undefined) return toRow(rows[0]);
      // Already ended: return it as it stands (idempotent end).
      const existing =
        await sql`select * from gateq.application_video_sessions where id = ${input.id}`;
      return existing[0] === undefined ? null : toRow(existing[0]);
    },
    openForApplication: async (applicationId) => {
      const rows = await sql`
        select * from gateq.application_video_sessions
         where application_id = ${applicationId} and status <> 'ENDED'
         order by created_at desc limit 1`;
      return rows[0] === undefined ? null : toRow(rows[0]);
    },
    countForApplication: async (applicationId) =>
      z.coerce
        .number()
        .parse(
          (
            await sql`select count(*) as n from gateq.application_video_sessions where application_id = ${applicationId}`
          )[0]?.["n"] ?? 0,
        ),
    byBridgeTokenHash: async (hash) => {
      if (!/^[0-9a-f]{64}$/u.test(hash)) return null;
      const rows =
        await sql`select * from gateq.application_video_sessions where bridge_token_hash = ${hash}`;
      return rows[0] === undefined ? null : toRow(rows[0]);
    },
    expired: async (limit) => {
      const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
      const rows = await sql`
        select * from gateq.application_video_sessions
         where status <> 'ENDED' and ends_at <= now()
         order by ends_at limit ${bounded}`;
      return rows.map(toRow);
    },
  };
}
