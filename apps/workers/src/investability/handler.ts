import type { EventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { InvestabilityService } from "@capital-q/readiness";
import { z } from "zod";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * Investability follows the evidence (owner 2026-10-16: "recomputed when
 * the founder shares new information or evidence status changes").
 *
 *   outbox event about a company's investor-eligible inputs
 *     -> the company ids it concerns, read from the database (the message
 *        names subjects; it is never authority)
 *     -> recompute each: append a revision only when the basis changed
 *
 * Idempotent: a redelivery, or an event that changed nothing a score
 * reads, writes nothing. A failure is logged and the event continues to
 * the next consumer; the periodic sweep below repairs anything missed
 * (deck confirmations have no outbox event, the sweep covers them).
 */

export const INVESTABILITY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "core.company.created",
  "core.company.updated",
  "core.company.visibility_changed",
  "core.company.marketplace_readiness_changed",
  "core.founder_profile.updated",
  "evidence.claim.changed",
  "evidence.document.ready",
  "evidence.document.version_created",
  "evidence.document.details_changed",
  "evidence.document.download_audience_changed",
  "verification.claim.decided",
  // ADR 0075: the pitch investors may play is an input.
  "media.asset.status_changed",
  "media.asset.moderated",
  "media.asset.playback_policy_changed",
  "media.asset.replaced",
  "media.asset.deleted",
]);

const MAX_COMPANIES_PER_EVENT = 20;

const Subjects = z
  .object({
    companyId: z.string().uuid().optional(),
    subjectType: z.string().optional(),
    subjectId: z.string().uuid().optional(),
    organisationId: z.string().uuid().optional(),
    claimId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    ownerType: z.string().optional(),
    ownerId: z.string().uuid().optional(),
  })
  .passthrough();

export async function companiesOfEvent(
  sql: DatabaseExecutor,
  type: string,
  data: unknown,
): Promise<readonly string[]> {
  const parsed = Subjects.safeParse(data);
  if (!parsed.success) return [];
  const d = parsed.data;
  if (d.companyId !== undefined) return [d.companyId];
  if (d.subjectType === "COMPANY" && d.subjectId !== undefined) {
    return [d.subjectId];
  }
  if (d.ownerType === "COMPANY" && d.ownerId !== undefined) {
    return [d.ownerId];
  }
  let organisationId = d.organisationId;
  if (
    organisationId === undefined &&
    type === "verification.claim.decided" &&
    d.claimId !== undefined
  ) {
    const [row] = await sql<{ organisation_id: string }[]>`
      select organisation_id from evidence.verification_claims
       where id = ${d.claimId}::uuid`;
    organisationId = row?.organisation_id;
  }
  if (organisationId !== undefined) {
    const rows = await sql<{ id: string }[]>`
      select id from core.companies
       where organisation_id = ${organisationId}::uuid
       order by id limit ${MAX_COMPANIES_PER_EVENT}`;
    return rows.map((r) => r.id);
  }
  if (d.userId !== undefined) {
    const rows = await sql<{ company_id: string }[]>`
      select distinct company_id from core.company_members
       where user_id = ${d.userId}::uuid and is_founder and is_current
       order by company_id limit ${MAX_COMPANIES_PER_EVENT}`;
    return rows.map((r) => r.company_id);
  }
  return [];
}

export function withInvestabilityRecompute(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: {
    readonly registry: EventRegistry;
    readonly sql: DatabaseExecutor;
    readonly service: Pick<InvestabilityService, "recompute">;
    /**
     * A new revision changes the Discover order (fit-order.v2): refresh the
     * slates that serve this company. Never fails the event.
     */
    readonly onRecorded?: ((companyId: string) => Promise<void>) | undefined;
    readonly logger: RunnerLogger;
  },
): (message: QueueMessage) => Promise<MessageOutcome> {
  const { registry, sql, service, logger } = options;
  return async (message) => {
    const parsed = registry.parse(message.message);
    if (!parsed.ok || !INVESTABILITY_EVENT_TYPES.has(parsed.message.type)) {
      return inner(message);
    }
    const event = parsed.message;
    try {
      const companies = await companiesOfEvent(sql, event.type, event.data);
      for (const companyId of companies) {
        const outcome = await service.recompute(companyId);
        if (outcome.kind === "RECORDED") {
          await options.onRecorded?.(companyId).catch(() => undefined);
          logger.info(
            {
              event: "investability.recorded",
              eventType: event.type,
              eventId: event.id,
              companyId,
              revision: outcome.revision,
            },
            "investability recomputed",
          );
        }
      }
    } catch (error: unknown) {
      logger.warn(
        {
          event: "investability.recompute_failed",
          eventType: event.type,
          eventId: event.id,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "investability recompute failed; the sweep will repair it",
      );
    }
    return inner(message);
  };
}

/** Every 30 minutes, paced: deck confirmations and anything an event missed. */
export const INVESTABILITY_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
/** 48 × 30 minutes: one full sweep a day. */
const FULL_SWEEP_EVERY_TICKS = 48;

export async function runInvestabilitySweepTicker(options: {
  readonly service: Pick<InvestabilityService, "sweep">;
  /**
   * After a sweep that recorded anything, and once after the first sweep
   * of a process (a deploy may have changed the method or the order),
   * every current slate is refreshed once (coalesced per mandate), so
   * Discover's order uses the new Investability without waiting for the
   * slates to expire.
   */
  readonly onScoresChanged?: (() => Promise<void>) | undefined;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  await sleep(FIRST_SWEEP_DELAY_MS, options.signal);
  let tick = 1;
  let first = true;
  while (!options.signal.aborted) {
    try {
      // Changed companies every tick (one read when nothing changed); every
      // company once a day, as a repair.
      const changedOnly = tick % FULL_SWEEP_EVERY_TICKS !== 0;
      tick += 1;
      const result = await options.service.sweep({ pauseMs: 250, changedOnly });
      options.logger.info(
        { event: "investability.sweep", changedOnly, ...result },
        "investability sweep",
      );
      if (result.recorded > 0 || first) {
        await options.onScoresChanged?.().catch(() => undefined);
      }
      first = false;
    } catch {
      options.logger.warn(
        { event: "investability.sweep_failed" },
        "investability sweep failed; retrying next interval",
      );
    }
    await sleep(
      options.intervalMs ?? INVESTABILITY_SWEEP_INTERVAL_MS,
      options.signal,
    );
  }
}
