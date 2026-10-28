import { z } from "zod";

import type {
  PendingWrite,
  PendingWriteRepository,
} from "../application/pending-writes.js";

/**
 * PostgreSQL adapter for `onboarding.pending_writes`. Parameterised SQL
 * only; every read is keyed by the session AND its owner, so a held change
 * is never read across people.
 */

const Row = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  step_key: z.string(),
  response: z
    .object({ value: z.unknown(), note: z.string().optional() })
    .passthrough(),
  origin: z.enum(["CONVERSATION", "FORM", "CONFIRMATION_GROUP"]),
  idempotency_key: z.string().uuid(),
  attempts: z.coerce.number().int().min(0),
  created_at: z.union([z.date(), z.string()]).transform((v) => new Date(v)),
  updated_at: z
    .union([z.date(), z.string()])
    .transform((v) => new Date(v))
    .optional(),
  last_error: z.string().nullable().optional(),
});

function toWrite(raw: unknown): PendingWrite {
  const row = Row.parse(raw);
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    stepKey: row.step_key,
    response:
      row.response.note === undefined
        ? { value: row.response.value }
        : { value: row.response.value, note: row.response.note },
    origin: row.origin,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    createdAt: row.created_at,
    ...(row.updated_at === undefined ? {} : { lastAttemptAt: row.updated_at }),
    lastError: row.last_error ?? null,
  };
}

export function createPostgresPendingWriteRepository(): PendingWriteRepository {
  return {
    hold: async (executor, input) => {
      const existing = await executor`
        select id, session_id, user_id, step_key, response, origin,
               idempotency_key, attempts, created_at from onboarding.pending_writes
         where session_id = ${input.sessionId}
           and idempotency_key = ${input.idempotencyKey}`;
      if (existing.length > 0) return toWrite(existing[0]);
      // A later confirmed change to the same field supersedes the held one.
      await executor`
        update onboarding.pending_writes
           set status = 'DISCARDED', settled_at = clock_timestamp(),
               last_error = 'SUPERSEDED'
         where session_id = ${input.sessionId}
           and step_key = ${input.stepKey}
           and status = 'PENDING'`;
      const rows = await executor`
        insert into onboarding.pending_writes
               (session_id, user_id, step_key, response, origin, idempotency_key)
        values (${input.sessionId}, ${input.userId}, ${input.stepKey},
                ${JSON.stringify(input.response)}::text::jsonb, ${input.origin},
                ${input.idempotencyKey})
        on conflict (session_id, idempotency_key) do nothing
        returning id, session_id, user_id, step_key, response, origin,
               idempotency_key, attempts, created_at`;
      if (rows.length > 0) return toWrite(rows[0]);
      const again = await executor`
        select id, session_id, user_id, step_key, response, origin,
               idempotency_key, attempts, created_at from onboarding.pending_writes
         where session_id = ${input.sessionId}
           and idempotency_key = ${input.idempotencyKey}`;
      return toWrite(again[0]);
    },
    listPending: async (executor, sessionId, userId) => {
      const rows = await executor`
        select id, session_id, user_id, step_key, response, origin,
               idempotency_key, attempts, created_at, updated_at, last_error
          from onboarding.pending_writes
         where session_id = ${sessionId}
           and user_id = ${userId}
           and status = 'PENDING'
         order by created_at asc
         limit 50`;
      return rows.map(toWrite);
    },
    settle: async (executor, id, status, code) => {
      await executor`
        update onboarding.pending_writes
           set status = ${status}, settled_at = clock_timestamp(),
               last_error = ${code}
         where id = ${id} and status = 'PENDING'`;
    },
    recordAttempt: async (executor, id, code) => {
      await executor`
        update onboarding.pending_writes
           set attempts = least(attempts + 1, 1000), last_error = ${code}
         where id = ${id} and status = 'PENDING'`;
    },
  };
}
