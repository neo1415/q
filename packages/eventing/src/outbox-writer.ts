import { z } from "zod";

import {
  isTenantOwnedEvent,
  UtcTimestampSchema,
  type CapitalQEvent,
  type EventRegistry,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";

import { OutboxEventConflictError, OutboxEventInvalidError } from "./errors.js";

/**
 * Records a canonical event for publication, inside the caller's transaction.
 *
 * This is the only way domain and application code emit events. The required
 * usage makes atomicity visible at the call site:
 *
 *   await transactions.run(async (tx) => {
 *     await companyRepository.update(tx, company);
 *     await outbox.enqueue(tx, companyUpdatedEvent(...));
 *   });
 *
 * There is deliberately no `enqueue(event)` that opens its own transaction:
 * an event committed separately from the change it describes is exactly the
 * dual write the outbox exists to prevent. Nothing here knows about pgmq.
 */

export type OutboxEnqueueOptions = {
  /** Earliest publication time. Clamped to the database's now() if earlier. */
  readonly availableAt?: UtcTimestamp | undefined;
};

export type OutboxEnqueueResult =
  | { readonly status: "ENQUEUED" }
  /** The identical event was already recorded; a retried idempotent command. */
  | { readonly status: "ALREADY_ENQUEUED" };

export type OutboxWriter = {
  readonly enqueue: (
    tx: TransactionContext,
    event: CapitalQEvent<unknown>,
    options?: OutboxEnqueueOptions,
  ) => Promise<OutboxEnqueueResult>;
};

export type OutboxWriterOptions = {
  /** The canonical production registry. Unknown events are rejected. */
  readonly registry: EventRegistry;
};

const InsertedRowSchema = z.object({ id: z.coerce.number() });
const DuplicateRowSchema = z.object({ same: z.boolean() });

export function createOutboxWriter(options: OutboxWriterOptions): OutboxWriter {
  const { registry } = options;

  return {
    enqueue: async (tx, event, enqueueOptions = {}) => {
      // 1-3. Envelope, registry resolution and data schema. The registry
      // returns the canonical (stripped, validated) form, which is what gets
      // persisted -- never the raw object as offered.
      const parsed = registry.parse(event);
      if (!parsed.ok) {
        throw new OutboxEventInvalidError(
          parsed.rejection,
          parsed.type,
          parsed.version,
        );
      }
      const canonical = parsed.message;

      // 4. Definition-level requirements. A tenant-owned event with no tenant
      // is not given a fallback tenant; it fails the business transaction.
      const definition = registry.get(canonical.type, canonical.eventVersion);
      if (definition === undefined) {
        throw new OutboxEventInvalidError(
          "UNKNOWN_TYPE",
          canonical.type,
          canonical.eventVersion,
        );
      }
      if (isTenantOwnedEvent(definition) && canonical.tenantId === undefined) {
        throw new OutboxEventInvalidError(
          "TENANT_REQUIRED",
          canonical.type,
          canonical.eventVersion,
        );
      }

      const availableAt =
        enqueueOptions.availableAt === undefined
          ? null
          : UtcTimestampSchema.parse(enqueueOptions.availableAt);
      const payload = JSON.stringify(canonical);

      // Indexed columns are derived from the validated envelope, so they can
      // never disagree with the payload.
      const inserted = await tx.sql`
        insert into events.outbox
          (event_id, tenant_id, event_type, event_version, payload, available_at)
        values (
          ${canonical.id},
          ${canonical.tenantId ?? null},
          ${canonical.type},
          ${canonical.eventVersion},
          ${payload}::text::jsonb,
          greatest(coalesce(${availableAt}::timestamptz, now()), now())
        )
        on conflict (event_id) do nothing
        returning id`;

      if (
        inserted.length > 0 &&
        InsertedRowSchema.safeParse(inserted[0]).success
      ) {
        return { status: "ENQUEUED" };
      }

      // Same EventId already recorded. jsonb equality is structural, so key
      // order and whitespace are irrelevant; only meaning is compared.
      const existing = await tx.sql`
        select (o.payload = ${payload}::text::jsonb) as same
          from events.outbox o
         where o.event_id = ${canonical.id}`;
      const duplicate = DuplicateRowSchema.safeParse(existing[0]);
      if (duplicate.success && duplicate.data.same) {
        return { status: "ALREADY_ENQUEUED" };
      }
      throw new OutboxEventConflictError(canonical.id);
    },
  };
}
