import type { TransactionManager } from "@capital-q/database";

import type { ProviderEvent } from "./provider.js";

/**
 * Applying a VERIFIED Stripe event (the route verifies the signature and
 * the replay window first). Idempotent by event id: the event row and its
 * effect commit together, so a redelivery finds the row and changes
 * nothing. Out-of-order delivery: a subscription row only moves for a
 * newer event. Plan access follows the subscription -- active, trialing or
 * past_due (Stripe still retrying) keeps the plan; anything else ends it,
 * and the account returns to the default plan.
 */

export type WebhookOutcome = "APPLIED" | "IGNORED" | "REPLAYED";

const KEEPS_PLAN = new Set(["active", "trialing", "past_due"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const ACCOUNT_KEY = /^[op]:[0-9a-f-]{36}$/;

function accountColumns(accountKey: string): {
  organisation_id: string | null;
  user_id: string | null;
} {
  const id = accountKey.slice(2);
  return accountKey.startsWith("o:")
    ? { organisation_id: id, user_id: null }
    : { organisation_id: null, user_id: id };
}

/** The subscription facts the plan depends on, or null when unusable. */
export function readSubscription(object: unknown): {
  readonly id: string;
  readonly status: string;
  readonly accountKey: string;
  readonly customerId: string | null;
  readonly lookupKey: string | null;
  readonly cancelAt: Date | null;
} | null {
  const sub = record(object);
  if (sub === null) return null;
  const id = text(sub["id"]);
  const status = text(sub["status"]);
  const accountKey = text(record(sub["metadata"])?.["account_key"]);
  if (id === null || status === null || accountKey === null) return null;
  if (!ACCOUNT_KEY.test(accountKey)) return null;
  const items = record(sub["items"])?.["data"];
  const firstItem = Array.isArray(items) ? record(items[0]) : null;
  const lookupKey = text(record(firstItem?.["price"])?.["lookup_key"]);
  const cancelAt = sub["cancel_at"];
  return {
    id,
    status,
    accountKey,
    customerId: text(sub["customer"]),
    lookupKey,
    cancelAt: typeof cancelAt === "number" ? new Date(cancelAt * 1000) : null,
  };
}

export function createWebhookApplier(options: {
  readonly transactions: TransactionManager;
}) {
  const { transactions } = options;

  return async function apply(event: ProviderEvent): Promise<WebhookOutcome> {
    return transactions.run(async (tx) => {
      const claimed = await tx.sql<{ event_id: string }[]>`
        insert into billing.provider_events (provider, event_id, event_type, event_created, outcome)
        values ('STRIPE', ${event.id}, ${event.type}, ${event.created},
                ${handles(event.type) ? "APPLIED" : "IGNORED"})
        on conflict (provider, event_id) do nothing
        returning event_id`;
      if (claimed.length === 0) return "REPLAYED";
      if (!handles(event.type)) return "IGNORED";

      if (event.type === "checkout.session.completed") {
        const session = record(event.object);
        const accountKey = text(session?.["client_reference_id"]);
        const customerId = text(session?.["customer"]);
        if (
          accountKey === null ||
          customerId === null ||
          !ACCOUNT_KEY.test(accountKey)
        ) {
          return "IGNORED";
        }
        const columns = accountColumns(accountKey);
        await tx.sql`
          insert into billing.customers (organisation_id, user_id, provider, provider_customer_id)
          values (${columns.organisation_id}, ${columns.user_id}, 'STRIPE', ${customerId})
          on conflict do nothing`;
        return "APPLIED";
      }

      const sub = readSubscription(event.object);
      if (sub === null) return "IGNORED";
      const plans = await tx.sql<{ id: string }[]>`
        select id from billing.plans
         where stripe_lookup_key = ${sub.lookupKey} and status = 'ACTIVE'`;
      const planId = plans[0]?.id ?? null;
      const moved = await tx.sql<{ provider_subscription_id: string }[]>`
        insert into billing.subscriptions
          (provider, provider_subscription_id, account_key, plan_id, status, cancel_at, last_event_created)
        values ('STRIPE', ${sub.id}, ${sub.accountKey}, ${planId}, ${sub.status},
                ${sub.cancelAt}, ${event.created})
        on conflict (provider, provider_subscription_id) do update
          set plan_id = excluded.plan_id, status = excluded.status,
              cancel_at = excluded.cancel_at,
              last_event_created = excluded.last_event_created,
              updated_at = clock_timestamp()
          where billing.subscriptions.last_event_created <= excluded.last_event_created
        returning provider_subscription_id`;
      // An older event than the one already applied: recorded, not applied.
      if (moved.length === 0) return "APPLIED";

      if (sub.customerId !== null) {
        const columns = accountColumns(sub.accountKey);
        await tx.sql`
          insert into billing.customers (organisation_id, user_id, provider, provider_customer_id)
          values (${columns.organisation_id}, ${columns.user_id}, 'STRIPE', ${sub.customerId})
          on conflict do nothing`;
      }

      const keeps =
        event.type !== "customer.subscription.deleted" &&
        KEEPS_PLAN.has(sub.status) &&
        planId !== null;
      const current = await tx.sql<
        {
          id: string;
          plan_id: string;
          provider_subscription_id: string | null;
          ends_at: Date | null;
        }[]
      >`
        select id, plan_id, provider_subscription_id, ends_at
          from billing.plan_assignments
         where account_key = ${sub.accountKey} and superseded_at is null
         for update`;
      const row = current[0];
      if (keeps && planId !== null) {
        if (
          row !== undefined &&
          row.provider_subscription_id === sub.id &&
          row.plan_id === planId
        ) {
          // Same subscription and plan: only a scheduled end may move.
          await tx.sql`
            update billing.plan_assignments set ends_at = ${sub.cancelAt}
             where id = ${row.id} and ends_at is distinct from ${sub.cancelAt}`;
          return "APPLIED";
        }
        if (row !== undefined) {
          await tx.sql`
            update billing.plan_assignments set superseded_at = clock_timestamp()
             where id = ${row.id}`;
        }
        const columns = accountColumns(sub.accountKey);
        await tx.sql`
          insert into billing.plan_assignments
            (organisation_id, user_id, plan_id, source, ends_at, provider_subscription_id)
          values (${columns.organisation_id}, ${columns.user_id}, ${planId}, 'STRIPE',
                  ${sub.cancelAt}, ${sub.id})`;
        return "APPLIED";
      }
      // Ended, unpaid or unknown price: this subscription's plan stops now.
      if (row !== undefined && row.provider_subscription_id === sub.id) {
        await tx.sql`
          update billing.plan_assignments set superseded_at = clock_timestamp()
           where id = ${row.id}`;
      }
      return "APPLIED";
    });
  };
}

function handles(type: string): boolean {
  return (
    type === "checkout.session.completed" ||
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  );
}
