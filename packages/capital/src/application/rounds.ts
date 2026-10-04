import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CompanyId } from "@capital-q/companies";
import type {
  CapitalRoundDto,
  CloseCapitalRoundRequest,
  CorrelationId,
  OpenCapitalRoundRequest,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { CapitalObjectiveNotFoundError } from "../domain/errors.js";
import type { CapitalServiceDependencies } from "./dependencies.js";
import {
  CAPITAL_OBJECTIVE_CLOSE,
  CAPITAL_OBJECTIVE_EDIT,
  CAPITAL_OBJECTIVE_VIEW,
  companyScope,
  visibleCompany,
} from "./use-cases.js";

/**
 * Capital rounds (founder direction 2026-10-04): the company's financing
 * rounds, each with a target, an instrument, dates and a status. At most
 * one is current; opening a round makes it current, closing the current
 * round hands "current" to the newest round still open (or planned).
 *
 * A round never stores what it raised: that is the sum of RECEIVED
 * commitments, read from Network. The raise's own capabilities govern it
 * (view / edit / close), on the same company resource, through the same
 * enumeration-safe company lookup. Q has no write path here other than the
 * declared, human-approved actions.
 */

export class CapitalRoundNotFoundError extends Error {
  constructor() {
    super("CAPITAL_ROUND_NOT_FOUND");
    this.name = "CapitalRoundNotFoundError";
  }
}

export class CapitalRoundClosedError extends Error {
  constructor() {
    super("CAPITAL_ROUND_CLOSED");
    this.name = "CapitalRoundClosedError";
  }
}

type RoundRow = {
  id: string;
  name: string;
  target_amount: string;
  currency_code: string;
  instrument: CapitalRoundDto["instrument"];
  status: CapitalRoundDto["status"];
  is_current: boolean;
  opened_on: string | null;
  closed_on: string | null;
  created_at: Date;
};

const RESOURCE = AuditResourceTypeSchema.parse("capital_round");
const OPENED = AuditActionTypeSchema.parse("capital_round.opened");
const CLOSED = AuditActionTypeSchema.parse("capital_round.closed");

function toRound(row: RoundRow): CapitalRoundDto {
  return {
    id: row.id,
    name: row.name,
    target: { amount: row.target_amount, currency: row.currency_code },
    instrument: row.instrument,
    status: row.status,
    isCurrent: row.is_current,
    openedOn: row.opened_on,
    closedOn: row.closed_on,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Today as a calendar date (UTC), for a round opened or closed now. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Scoped = { readonly actor: ActorContext; readonly companyId: CompanyId };

export type CapitalRoundService = {
  readonly listRounds: (query: Scoped) => Promise<readonly CapitalRoundDto[]>;
  readonly currentRound: (query: Scoped) => Promise<CapitalRoundDto | null>;
  readonly openRound: (
    command: Scoped & {
      readonly input: OpenCapitalRoundRequest;
      readonly idempotencyKey: string;
      readonly correlationId: CorrelationId;
    },
  ) => Promise<CapitalRoundDto>;
  readonly closeRound: (
    command: Scoped & {
      readonly roundId: string;
      readonly input: CloseCapitalRoundRequest;
      readonly correlationId: CorrelationId;
    },
  ) => Promise<CapitalRoundDto>;
};

export function createCapitalRoundService(
  dependencies: Pick<
    CapitalServiceDependencies,
    "sql" | "transactions" | "authorization" | "companies" | "audit"
  >,
): CapitalRoundService {
  const { sql, transactions, authorization, audit } = dependencies;

  async function authorised(
    actor: ActorContext,
    companyId: CompanyId,
    capability:
      | typeof CAPITAL_OBJECTIVE_VIEW
      | typeof CAPITAL_OBJECTIVE_EDIT
      | typeof CAPITAL_OBJECTIVE_CLOSE,
  ) {
    const { company, organisationId } = await visibleCompany(
      dependencies,
      actor,
      companyId,
    );
    await authorization.requireCapability({
      actor,
      capability,
      resource: companyScope(actor, organisationId, company.id),
    });
    return company;
  }

  async function rows(
    executor: TransactionContext["sql"] | typeof sql,
    companyId: string,
  ): Promise<RoundRow[]> {
    return executor<RoundRow[]>`
      select id, name, target_amount::text as target_amount, currency_code,
             instrument, status, is_current, opened_on::text as opened_on,
             closed_on::text as closed_on, created_at
        from core.capital_rounds
       where company_id = ${companyId}
       order by is_current desc, coalesce(opened_on, created_at::date) desc, created_at desc
       limit 50`;
  }

  async function record(
    tx: TransactionContext,
    actor: ActorContext,
    action: typeof OPENED | typeof CLOSED,
    roundId: string,
    companyId: string,
    correlationId: CorrelationId,
  ) {
    await audit.record(tx, {
      ...auditActorFromContext(actor),
      auditEventId: createAuditEventId(),
      actionType: action,
      resourceType: RESOURCE,
      resourceId: roundId,
      occurredAt: occurredNow(),
      outcome: "SUCCEEDED",
      metadata: { companyId },
      correlationId,
    });
  }

  return {
    listRounds: async ({ actor, companyId }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_VIEW,
      );
      return (await rows(sql, company.id)).map(toRound);
    },

    currentRound: async ({ actor, companyId }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_VIEW,
      );
      const found = (await rows(sql, company.id)).find((row) => row.is_current);
      return found === undefined ? null : toRound(found);
    },

    openRound: async ({
      actor,
      companyId,
      input,
      idempotencyKey,
      correlationId,
    }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_EDIT,
      );
      const status = input.status ?? "OPEN";
      return transactions.run(async (tx) => {
        // One writer per company at a time: "current" moves atomically.
        await tx.sql`select id from core.companies where id = ${company.id} for update`;
        const replay = await tx.sql<RoundRow[]>`
          select id, name, target_amount::text as target_amount, currency_code,
                 instrument, status, is_current, opened_on::text as opened_on,
                 closed_on::text as closed_on, created_at
            from core.capital_rounds
           where created_by_user_id = ${actor.userId}
             and idempotency_key = ${idempotencyKey}
             and company_id = ${company.id}`;
        if (replay[0] !== undefined) return toRound(replay[0]);
        const existing = await rows(tx.sql, company.id);
        const hasCurrent = existing.some((row) => row.is_current);
        // An open round becomes current; a planned one only when none is.
        const current = status === "OPEN" || !hasCurrent;
        if (current && hasCurrent) {
          await tx.sql`
            update core.capital_rounds
               set is_current = false, updated_at = clock_timestamp()
             where company_id = ${company.id} and is_current`;
        }
        const inserted = await tx.sql<RoundRow[]>`
          insert into core.capital_rounds
            (tenant_id, company_id, name, target_amount, currency_code, instrument,
             status, is_current, opened_on, created_by_user_id, idempotency_key)
          values (${actor.tenantId}, ${company.id}, ${input.name.trim()},
                  ${input.target.amount}::numeric, ${input.target.currency},
                  ${input.instrument}, ${status}, ${current},
                  ${status === "OPEN" ? (input.openedOn ?? today()) : (input.openedOn ?? null)}::date,
                  ${actor.userId}, ${idempotencyKey})
          returning id, name, target_amount::text as target_amount, currency_code,
                    instrument, status, is_current, opened_on::text as opened_on,
                    closed_on::text as closed_on, created_at`;
        const round = inserted[0];
        if (round === undefined) throw new CapitalRoundNotFoundError();
        await record(tx, actor, OPENED, round.id, company.id, correlationId);
        return toRound(round);
      });
    },

    closeRound: async ({ actor, companyId, roundId, input, correlationId }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_CLOSE,
      );
      return transactions.run(async (tx) => {
        await tx.sql`select id from core.companies where id = ${company.id} for update`;
        const existing = await rows(tx.sql, company.id);
        const round = existing.find((row) => row.id === roundId);
        if (round === undefined) throw new CapitalRoundNotFoundError();
        if (round.status === "CLOSED") throw new CapitalRoundClosedError();
        const closedOn = input.closedOn ?? today();
        const updated = await tx.sql<RoundRow[]>`
          update core.capital_rounds
             set status = 'CLOSED', is_current = false,
                 opened_on = coalesce(opened_on, ${closedOn}::date),
                 closed_on = greatest(${closedOn}::date, coalesce(opened_on, ${closedOn}::date)),
                 closed_by_user_id = ${actor.userId}, updated_at = clock_timestamp()
           where id = ${roundId} and company_id = ${company.id}
          returning id, name, target_amount::text as target_amount, currency_code,
                    instrument, status, is_current, opened_on::text as opened_on,
                    closed_on::text as closed_on, created_at`;
        const closed = updated[0];
        if (closed === undefined) throw new CapitalRoundNotFoundError();
        if (round.is_current) {
          // "Current" passes to the newest round still open, else planned.
          const next = existing
            .filter((row) => row.id !== roundId && row.status !== "CLOSED")
            .sort(
              (a, b) =>
                Number(b.status === "OPEN") - Number(a.status === "OPEN") ||
                new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime(),
            )[0];
          if (next !== undefined) {
            await tx.sql`
              update core.capital_rounds
                 set is_current = true, updated_at = clock_timestamp()
               where id = ${next.id}`;
          }
        }
        await record(tx, actor, CLOSED, roundId, company.id, correlationId);
        return toRound(closed);
      });
    },
  };
}

/** A round that is not theirs, or not there, reads as not found. */
export function isRoundNotFound(error: unknown): boolean {
  return (
    error instanceof CapitalRoundNotFoundError ||
    error instanceof CapitalObjectiveNotFoundError
  );
}
