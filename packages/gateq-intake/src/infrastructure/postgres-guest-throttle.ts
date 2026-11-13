import { createHash } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import {
  createGuestThrottle,
  GATEQ_GUEST_QUOTAS,
  type GateQGuestOperation,
  type GuestQuota,
  type GuestThrottle,
} from "../domain/throttle.js";

/** Expired rows deleted per sweep: small, so a sweep never stalls anything. */
const SWEEP_BATCH = 200;
/** One sweep per this many successful charges on one instance. */
const SWEEP_EVERY = 256;

/**
 * The guest throttle shared across API instances (directive B8).
 *
 * Same buckets, quotas and key semantics as the in-process throttle, held in
 * `gateq.guest_throttle_buckets`, so a deploy no longer resets every
 * allowance and a second replica cannot double it. The window clock is the
 * database's, so instances never disagree about when a window ends.
 *
 * The row key is the sha256 of `operation:sessionId`: the counter table
 * never holds a session id (and a session id is already never a credential).
 *
 * One atomic statement per charge, the contact-verification-limits pattern:
 * insert the bucket, or on conflict restart an expired window or increment
 * a live one only while it is under the limit. No row back means refused,
 * and there is no read-then-write gap for two instances to race through.
 *
 * Fail open, deliberately: if the database call throws, that one charge is
 * decided by an in-process fallback throttle, so a database blip degrades to
 * the per-instance bound instead of locking every applicant out. Every guest
 * request has already been authorised against the same database, so an
 * outage long enough to matter refuses the request there first.
 *
 * Cleanup needs no cron: every SWEEP_EVERY charges, one bounded, skip-locked
 * delete removes rows older than the longest window. It runs after the
 * charge and the request never waits for it.
 */
export function createPostgresGuestThrottle(options: {
  readonly sql: DatabaseExecutor;
  readonly quotas?: Readonly<Record<GateQGuestOperation, GuestQuota>>;
  readonly logger?: Pick<Logger, "warn"> | undefined;
  /** The fail-open fallback; injectable for a test. */
  readonly fallback?: GuestThrottle;
}): GuestThrottle {
  const { sql, logger } = options;
  const quotas = options.quotas ?? GATEQ_GUEST_QUOTAS;
  const fallback = options.fallback ?? createGuestThrottle({ quotas });
  const longestWindowMs = Math.max(
    ...Object.values(quotas).map((quota) => quota.windowMs),
  );
  let charges = 0;
  // Warn once per outage, not once per request: a flood of identical lines
  // during a blip helps nobody. The next successful charge re-arms it.
  let degraded = false;

  const sweep = async (): Promise<void> => {
    await sql`
      delete from gateq.guest_throttle_buckets
       where key_hash in (
         select key_hash from gateq.guest_throttle_buckets
          where window_started_at <= clock_timestamp() - ${longestWindowMs}::int * interval '1 millisecond'
          limit ${SWEEP_BATCH}
          for update skip locked
       )`;
  };

  return {
    charge: async ({ sessionId, operation }) => {
      const quota = quotas[operation];
      const keyHash = createHash("sha256")
        .update(`${operation}:${sessionId}`)
        .digest("hex");
      let allowed: boolean;
      try {
        const rows = await sql`
          insert into gateq.guest_throttle_buckets as b (key_hash, window_started_at, count)
          values (${keyHash}, clock_timestamp(), 1)
          on conflict (key_hash) do update set
            window_started_at = case
              when b.window_started_at <= clock_timestamp() - ${quota.windowMs}::int * interval '1 millisecond'
              then clock_timestamp() else b.window_started_at end,
            count = case
              when b.window_started_at <= clock_timestamp() - ${quota.windowMs}::int * interval '1 millisecond'
              then 1 else b.count + 1 end
          where b.window_started_at <= clock_timestamp() - ${quota.windowMs}::int * interval '1 millisecond'
             or b.count < ${quota.limit}::int
          returning b.key_hash`;
        allowed = rows.length === 1;
      } catch {
        if (!degraded) {
          degraded = true;
          // No key, no session id, and no error text that could carry either.
          logger?.warn(
            { component: "gateq-guest-throttle", operation },
            "Shared guest throttle unavailable; using this instance's counters.",
          );
        }
        return fallback.charge({ sessionId, operation });
      }
      degraded = false;
      charges += 1;
      if (charges % SWEEP_EVERY === 0) {
        // Best effort: a failed sweep leaves its rows for the next one.
        void sweep().catch(() => undefined);
      }
      return allowed;
    },
    size: () => fallback.size(),
  };
}
