import { z } from "zod";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import type {
  GateqVoiceSessionRow,
  GateqVoiceSessionStore,
} from "./voice-interview.js";

const Row = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  application_id: z.string().uuid(),
  status: z.enum(["LIVE", "ENDED"]),
  ended_reason: z
    .enum([
      "APPLICANT_ENDED",
      "CONTINUED_BY_TYPING",
      "TIME_LIMIT",
      "PROVIDER_FAILED",
      "SWEPT",
    ])
    .nullable(),
  guest_credential_sealed: z.string(),
  bridge_token_hash: z.string(),
  max_seconds: z.coerce.number().int(),
  created_at: z.coerce.date(),
  ends_at: z.coerce.date(),
});

const toRow = (raw: unknown): GateqVoiceSessionRow => {
  const r = Row.parse(raw);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    applicationId: r.application_id,
    status: r.status,
    endedReason: r.ended_reason,
    guestCredentialSealed: r.guest_credential_sealed,
    bridgeTokenHash: r.bridge_token_hash,
    maxSeconds: r.max_seconds,
    createdAt: r.created_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
  };
};

/**
 * Server-only store for gateq.application_voice_sessions (migration
 * 20261231530000). Every read is keyed by application AND tenant.
 */
export function createPostgresGateqVoiceSessions(deps: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): GateqVoiceSessionStore {
  const { sql, transactions } = deps;
  return {
    reserve: (input) =>
      transactions.run(async (tx) => {
        // The application row lock orders this with Submit and with another
        // start for the same application; the advisory lock orders starts
        // across applications for the concurrency cap.
        const app = await tx.sql`
          select status from gateq.applications
           where id = ${input.applicationId} and tenant_id = ${input.tenantId} for update`;
        if (app.length !== 1 || app[0]?.["status"] === "SUBMITTED")
          return { kind: "ALLOWANCE" as const };
        await tx.sql`select pg_advisory_xact_lock(hashtextextended('gateq-voice-sessions', 0))`;
        // A reconnect: the same session and clock, a new line bearer.
        const reopened = await tx.sql`
          update gateq.application_voice_sessions
             set bridge_token_hash = ${input.bridgeTokenHash}
           where id = (
             select id from gateq.application_voice_sessions
              where application_id = ${input.applicationId} and tenant_id = ${input.tenantId}
                and status = 'LIVE' and ends_at > now()
              order by created_at desc limit 1)
          returning *`;
        if (reopened[0] !== undefined)
          return { kind: "EXISTING" as const, row: toRow(reopened[0]) };
        const counts = z
          .object({ used: z.coerce.number(), live: z.coerce.number() })
          .parse(
            (
              await tx.sql`
          select
            (select count(*) from gateq.application_voice_sessions
              where application_id = ${input.applicationId}
                and ended_reason is distinct from 'PROVIDER_FAILED') as used,
            (select count(*) from gateq.application_voice_sessions
              where status = 'LIVE' and ends_at > now()) as live`
            )[0],
          );
        if (counts.used >= input.perApplication)
          return { kind: "ALLOWANCE" as const };
        if (counts.live >= input.concurrency)
          return { kind: "CONCURRENCY" as const };
        const created = await tx.sql`
          insert into gateq.application_voice_sessions
            (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed,
             provider, max_seconds, created_at, ends_at)
          values (${input.id}, ${input.tenantId}, ${input.applicationId}, ${input.bridgeTokenHash},
                  ${input.guestCredentialSealed}, ${input.provider ?? "DEEPGRAM"},
                  ${input.maxSeconds}, now(),
                  now() + make_interval(secs => ${input.maxSeconds}))
          returning *`;
        return { kind: "CREATED" as const, row: toRow(created[0]) };
      }),
    end: async (input) => {
      const rows = await sql`
        update gateq.application_voice_sessions
           set status = 'ENDED', ended_reason = ${input.reason},
               ended_at = least(now(), ends_at)
         where id = ${input.id} and status <> 'ENDED'
         returning *`;
      if (rows[0] !== undefined) return toRow(rows[0]);
      const existing =
        await sql`select * from gateq.application_voice_sessions where id = ${input.id}`;
      return existing[0] === undefined ? null : toRow(existing[0]);
    },
    openForApplication: async (input) => {
      const rows = await sql`
        select * from gateq.application_voice_sessions
         where application_id = ${input.applicationId} and tenant_id = ${input.tenantId}
           and status = 'LIVE' and ends_at > now()
         order by created_at desc limit 1`;
      return rows[0] === undefined ? null : toRow(rows[0]);
    },
    countForApplication: async (input) =>
      z.coerce.number().parse(
        (
          await sql`
              select count(*) as n from gateq.application_voice_sessions
               where application_id = ${input.applicationId} and tenant_id = ${input.tenantId}
                 and ended_reason is distinct from 'PROVIDER_FAILED'`
        )[0]?.["n"] ?? 0,
      ),
    byBridgeTokenHash: async (hash) => {
      if (!/^[0-9a-f]{64}$/u.test(hash)) return null;
      const rows =
        await sql`select * from gateq.application_voice_sessions where bridge_token_hash = ${hash}`;
      return rows[0] === undefined ? null : toRow(rows[0]);
    },
    expired: async (limit) => {
      const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
      const rows = await sql`
        select * from gateq.application_voice_sessions
         where status = 'LIVE' and ends_at <= now()
         order by ends_at limit ${bounded}`;
      return rows.map(toRow);
    },
  };
}
