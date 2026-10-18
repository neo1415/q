import type { DatabaseExecutor } from "@capital-q/database";

import type { BillingAccount } from "./catalogue.js";

/**
 * The credit ledger, groundwork only (lead 2026-10-03; migration
 * 20261127090000). Records signed quantities of a metered unit against an
 * account, idempotent per source event, with no rate and no money
 * (RATE_NOT_SET): Capital Q prices nothing here yet, charges nothing, and
 * calls no payment provider. A later packet feeds Stripe Billing Meters
 * from these rows through the outbox, and only the founder sets a rate.
 */

export const CREDIT_UNITS = ["MODEL_COST_USD"] as const;
export type CreditUnit = (typeof CREDIT_UNITS)[number];

export type CreditEntryInput = {
  readonly account: BillingAccount;
  readonly kind: "USAGE" | "GRANT";
  readonly unit: CreditUnit;
  /** Decimal, as text; USAGE is recorded negative, GRANT positive. */
  readonly quantity: string;
  readonly source: string;
  /** The source event's own id: one entry per event, however often recorded. */
  readonly sourceRef: string;
  readonly occurredAt: Date;
};

const DECIMAL = /^\d{1,12}(\.\d{1,8})?$/u;

export function createCreditLedger(options: {
  readonly sql: DatabaseExecutor;
}) {
  const { sql } = options;
  return {
    /** True when recorded now; false when this source event already was. */
    record: async (entry: CreditEntryInput): Promise<boolean> => {
      if (!DECIMAL.test(entry.quantity) || Number(entry.quantity) === 0) {
        throw new RangeError("a credit quantity is a positive decimal");
      }
      const signed =
        entry.kind === "USAGE" ? `-${entry.quantity}` : entry.quantity;
      const rows = await sql<{ id: string }[]>`
        insert into billing.credit_entries
          (organisation_id, user_id, kind, unit, quantity, source, source_ref, occurred_at)
        values (${entry.account.organisationId},
                ${entry.account.organisationId === null ? entry.account.userId : null},
                ${entry.kind}, ${entry.unit}, ${signed}::numeric,
                ${entry.source}, ${entry.sourceRef.slice(0, 200)}, ${entry.occurredAt})
        on conflict (source, source_ref) do nothing
        returning id::text`;
      return rows.length > 0;
    },

    /** An account's balance per unit and currency; nothing is priced yet. */
    balance: async (
      account: BillingAccount,
    ): Promise<
      readonly {
        readonly unit: string;
        readonly quantity: string;
        readonly unrated: number;
      }[]
    > =>
      sql<{ unit: string; quantity: string; unrated: number }[]>`
        select unit, sum(quantity)::text as quantity,
               count(*) filter (where rate_status = 'RATE_NOT_SET')::int as unrated
          from billing.credit_entries
         where account_key = ${
           account.organisationId === null
             ? `p:${account.userId}`
             : `o:${account.organisationId}`
         }
         group by unit
         order by unit`,
  };
}

export type CreditLedger = ReturnType<typeof createCreditLedger>;
