import type { FeeEntryDto, FeeLedgerDto } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

/**
 * The facilitation-fee ledger (founder direction 2026-09-29; PADL amendment
 * and a legal opinion are pending, ADR 0034). Deterministic: one entry per
 * CONFIRMED commitment at a level the current schedule accrues -- confirmed
 * means the OTHER side confirmed it on Capital Q (Spec 6.6.14), so nothing
 * one side typed or a call mentioned is ever billed. No rate set: the entry
 * is RATE_NOT_SET with no fee. A commitment that stops being current
 * before invoicing voids its entry. Capital Q records and exports; it never
 * holds or moves investment money (doc 10 §14).
 *
 * Reads network.commitments as the operator's read model, the same way the
 * attribution ledger does (packages/platform-admin); it never writes there.
 * The fee is exact decimal arithmetic in SQL numeric: amount × bps / 10 000,
 * rounded to 2 places -- never a float.
 */

type Schedule = {
  id: string;
  version: number;
  rate_bps: number | null;
  accrue_levels: string[];
  payer_side: "COMPANY" | "INVESTOR";
  effective_from: Date;
};

export function createFeeLedger(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}) {
  const { sql, transactions } = options;

  async function currentSchedule(
    executor: DatabaseExecutor = sql,
  ): Promise<Schedule> {
    const rows = await executor<Schedule[]>`
      select id, version, rate_bps, accrue_levels, payer_side, effective_from
        from billing.fee_schedules
       order by version desc
       limit 1`;
    const schedule = rows[0];
    if (schedule === undefined) throw new Error("billing: no fee schedule");
    return schedule;
  }

  /** Bring the ledger up to date with the commitments. Safe to repeat. */
  async function accrue(): Promise<{
    readonly added: number;
    readonly priced: number;
    readonly voided: number;
  }> {
    return transactions.run(async (tx) => {
      // One accrual at a time; a second waits and then finds nothing to do.
      await tx.sql`select pg_advisory_xact_lock(hashtextextended('billing.fees.accrue', 0))`;
      const schedule = await currentSchedule(tx.sql);
      const added = await tx.sql<{ id: string }[]>`
        insert into billing.fee_entries
          (commitment_id, relationship_id, tenant_id, amount, currency_code, level,
           confirmed_at, schedule_id, rate_bps, fee_amount, payer_side, status)
        select m.id, m.relationship_id, m.tenant_id, m.amount, m.currency_code, m.level,
               m.confirmed_at, ${schedule.id}, ${schedule.rate_bps}::int,
               case when ${schedule.rate_bps}::int is null then null
                    else round(m.amount * ${schedule.rate_bps}::int / 10000.0, 2) end,
               ${schedule.payer_side},
               case when ${schedule.rate_bps}::int is null then 'RATE_NOT_SET' else 'ACCRUED' end
          from network.commitments m
         where m.status = 'CONFIRMED'
           and m.confirmed_at is not null
           and m.level = any(${schedule.accrue_levels}::text[])
           and not exists (select 1 from billing.fee_entries e where e.commitment_id = m.id)
        returning id`;
      const priced =
        schedule.rate_bps === null
          ? []
          : await tx.sql<{ id: string }[]>`
              update billing.fee_entries
                 set status = 'ACCRUED', schedule_id = ${schedule.id},
                     rate_bps = ${schedule.rate_bps}::int,
                     fee_amount = round(amount * ${schedule.rate_bps}::int / 10000.0, 2),
                     payer_side = ${schedule.payer_side},
                     computed_at = clock_timestamp(), status_changed_at = clock_timestamp()
               where status = 'RATE_NOT_SET'
                 and level = any(${schedule.accrue_levels}::text[])
              returning id`;
      const voided = await tx.sql<{ id: string }[]>`
        update billing.fee_entries e
           set status = 'VOID', void_reason = 'The commitment is no longer confirmed and current.',
               status_changed_at = clock_timestamp()
          from network.commitments m
         where m.id = e.commitment_id
           and e.status in ('RATE_NOT_SET', 'ACCRUED')
           and m.status <> 'CONFIRMED'
        returning e.id`;
      return {
        added: added.length,
        priced: priced.length,
        voided: voided.length,
      };
    });
  }

  async function list(limit = 500): Promise<FeeLedgerDto> {
    const schedule = await currentSchedule();
    const rows = await sql<
      {
        id: string;
        commitment_id: string;
        relationship_id: string;
        company_name: string;
        investor_name: string;
        level: "SOFT" | "FIRM" | "INVESTED";
        amount: string;
        currency_code: string;
        confirmed_at: Date;
        rate_bps: number | null;
        fee_amount: string | null;
        payer_side: "COMPANY" | "INVESTOR";
        status: "RATE_NOT_SET" | "ACCRUED" | "INVOICED" | "VOID";
        schedule_version: number;
      }[]
    >`
      select e.id, e.commitment_id, e.relationship_id, c.canonical_name as company_name,
             io.display_name as investor_name, e.level, e.amount::text as amount,
             e.currency_code, e.confirmed_at, e.rate_bps, e.fee_amount::text as fee_amount,
             e.payer_side, e.status, s.version as schedule_version
        from billing.fee_entries e
        join billing.fee_schedules s on s.id = e.schedule_id
        join network.relationships r on r.id = e.relationship_id
        join core.companies c on c.id = r.company_id
        join core.investor_organisations io on io.id = r.investor_organisation_id
       order by e.confirmed_at desc
       limit ${Math.min(Math.max(limit, 1), 1000)}`;
    return {
      schedule: {
        version: schedule.version,
        rateBps: schedule.rate_bps,
        accrueLevels: schedule.accrue_levels as (
          "SOFT" | "FIRM" | "INVESTED"
        )[],
        payerSide: schedule.payer_side,
        effectiveFrom: schedule.effective_from.toISOString(),
      },
      entries: rows.map((row): FeeEntryDto => ({
        id: row.id,
        commitmentId: row.commitment_id,
        relationshipId: row.relationship_id,
        companyName: row.company_name,
        investorName: row.investor_name,
        level: row.level,
        amount: row.amount,
        currencyCode: row.currency_code,
        confirmedAt: row.confirmed_at.toISOString(),
        rateBps: row.rate_bps,
        feeAmount: row.fee_amount,
        payerSide: row.payer_side,
        status: row.status,
        scheduleVersion: row.schedule_version,
      })),
    };
  }

  /** A new schedule version (platform owner, audited by the caller), then accrue. */
  async function setRate(input: {
    readonly rateBps: number;
    readonly accrueLevels: readonly ("SOFT" | "FIRM" | "INVESTED")[];
    readonly payerSide: "COMPANY" | "INVESTOR";
    readonly byUserId: string;
    readonly reason: string;
  }): Promise<{
    readonly version: number;
    readonly previousRateBps: number | null;
  }> {
    const previous = await currentSchedule();
    const rows = await sql<{ version: number }[]>`
      insert into billing.fee_schedules (version, rate_bps, accrue_levels, payer_side, set_by_user_id, reason)
      values (${previous.version + 1}, ${input.rateBps}, ${[...input.accrueLevels]}::text[],
              ${input.payerSide}, ${input.byUserId}, ${input.reason})
      returning version`;
    await accrue();
    return {
      version: rows[0]?.version ?? previous.version + 1,
      previousRateBps: previous.rate_bps,
    };
  }

  return { accrue, list, setRate };
}

export type FeeLedger = ReturnType<typeof createFeeLedger>;

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  // Neutralise spreadsheet formulas (CSV injection) and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** The founder's export: one row per entry, plain CSV. */
export function feeLedgerCsv(ledger: FeeLedgerDto): string {
  const header = [
    "entry_id",
    "confirmed_at",
    "company",
    "investor",
    "level",
    "amount",
    "currency",
    "rate_bps",
    "fee",
    "payer",
    "status",
    "schedule_version",
    "commitment_id",
    "relationship_id",
  ];
  const lines = ledger.entries.map((entry) =>
    [
      entry.id,
      entry.confirmedAt,
      entry.companyName,
      entry.investorName,
      entry.level,
      entry.amount,
      entry.currencyCode,
      entry.rateBps,
      entry.feeAmount,
      entry.payerSide,
      entry.status,
      entry.scheduleVersion,
      entry.commitmentId,
      entry.relationshipId,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
