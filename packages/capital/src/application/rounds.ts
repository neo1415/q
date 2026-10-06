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
  CapitalRoundEventDto,
  CapitalRoundEventType,
  CapitalRoundStep,
  CapitalRoundTerms,
  CapitalRoundTermsInput,
  CloseCapitalRoundRequest,
  CorrelationId,
  InvestorRoundViewDto,
  OpenCapitalRoundRequest,
  RecordCapitalRoundStepRequest,
  ReviseCapitalRoundRequest,
} from "@capital-q/contracts";
import {
  DatabaseError,
  type DatabaseExecutor,
  type TransactionContext,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { CapitalObjectiveNotFoundError } from "../domain/errors.js";
import {
  checkRoundTerms,
  EMPTY_TERMS,
  nextRoundStatus,
  roundChanges,
  type RoundFacts,
  type StepRefusal,
  type TermsRefusal,
} from "../domain/rounds.js";
import type { CapitalServiceDependencies } from "./dependencies.js";
import {
  CAPITAL_OBJECTIVE_CLOSE,
  CAPITAL_OBJECTIVE_EDIT,
  CAPITAL_OBJECTIVE_VIEW,
  companyScope,
  visibleCompany,
} from "./use-cases.js";

/**
 * Capital rounds (founder direction 2026-10-04; full lifecycle P8,
 * 2026-10-06): the company's financing rounds -- past, current and planned
 * -- each with a target, an instrument, terms, closes and tranches, and a
 * status PLANNED -> OPEN -> FIRST_CLOSED -> CLOSED (or CANCELLED; a closed
 * round can reopen). At most one is current.
 *
 * A round never stores what it raised on Capital Q: that is the sum of
 * RECEIVED commitments, read from Network. A past round's raised amount
 * outside Capital Q is the company's own word (reported, USER_CLAIM).
 * Every change appends to core.capital_round_events with the previous
 * values: corrections create history, nothing is overwritten silently.
 * Edits carry the revision they read. The raise's own capabilities govern
 * it (view / edit / close) through the enumeration-safe company lookup; Q
 * has no write path other than the declared, human-approved actions.
 */

export class CapitalRoundNotFoundError extends Error {
  constructor() {
    super("We couldn't find that round.");
    this.name = "CapitalRoundNotFoundError";
  }
}

export class CapitalRoundClosedError extends Error {
  constructor() {
    super("This round is already closed.");
    this.name = "CapitalRoundClosedError";
  }
}

export class CapitalRoundRevisionConflictError extends Error {
  constructor() {
    super(
      "Someone changed this round while you were editing. Refresh to see the latest.",
    );
    this.name = "CapitalRoundRevisionConflictError";
  }
}

const STEP_REFUSALS: Readonly<
  Record<StepRefusal | "DATE_BEFORE_OPEN", string>
> = {
  NOT_FROM_THIS_STATUS: "That step doesn't apply to this round right now.",
  MONEY_HAS_CLOSED:
    "Money has already closed in this round, so it can't be cancelled. Record a final close instead.",
  DATE_BEFORE_OPEN: "That date is before the round opened.",
};

export class CapitalRoundStepRefusedError extends Error {
  readonly refusal: StepRefusal | "DATE_BEFORE_OPEN";
  constructor(refusal: StepRefusal | "DATE_BEFORE_OPEN") {
    super(STEP_REFUSALS[refusal]);
    this.name = "CapitalRoundStepRefusedError";
    this.refusal = refusal;
  }
}

const TERMS_REFUSALS: Readonly<
  Record<TermsRefusal | "EXTENDS_UNKNOWN" | "LEAD_UNKNOWN", string>
> = {
  HARD_CAP_BELOW_TARGET: "The hard cap can't be below the target.",
  CLOSE_DATE_BEFORE_OPEN: "The target close date is before the round opened.",
  EXTENDS_ITSELF: "A round can't extend itself.",
  EXTENDS_UNKNOWN: "Pick one of your own earlier rounds to extend.",
  LEAD_UNKNOWN: "Pick the lead from your investor relationships.",
};

export class CapitalRoundTermsError extends Error {
  readonly refusal: keyof typeof TERMS_REFUSALS;
  constructor(refusal: keyof typeof TERMS_REFUSALS) {
    super(TERMS_REFUSALS[refusal]);
    this.name = "CapitalRoundTermsError";
    this.refusal = refusal;
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
  first_closed_on: string | null;
  closed_on: string | null;
  cancelled_on: string | null;
  cancelled_reason: string | null;
  target_close_on: string | null;
  valuation_amount: string | null;
  valuation_basis: "PRE_MONEY" | "POST_MONEY" | null;
  valuation_cap_amount: string | null;
  discount_percent: string | null;
  hard_cap_amount: string | null;
  pro_rata_rights: CapitalRoundTerms["proRataRights"];
  lead_relationship_id: string | null;
  lead_investor_name: string | null;
  extends_round_id: string | null;
  reported_raised_amount: string | null;
  revision: number;
  created_at: Date;
};

type EventRow = {
  round_id: string;
  revision: number;
  event_type: CapitalRoundEventType;
  occurred_on: string;
  amount: string | null;
  currency_code: string | null;
  label: string | null;
  note: string | null;
  payload: unknown;
  actor_user_id: string;
  created_at: Date;
};

/** The round's columns as a static fragment (no parameters). */
const columns = (executor: TransactionContext["sql"] | DatabaseExecutor) =>
  executor`id, name, target_amount::text as target_amount, currency_code,
    instrument, status, is_current, opened_on::text as opened_on,
    first_closed_on::text as first_closed_on, closed_on::text as closed_on,
    cancelled_on::text as cancelled_on, cancelled_reason,
    target_close_on::text as target_close_on,
    valuation_amount::text as valuation_amount, valuation_basis,
    valuation_cap_amount::text as valuation_cap_amount,
    discount_percent::text as discount_percent,
    hard_cap_amount::text as hard_cap_amount, pro_rata_rights,
    lead_relationship_id, lead_investor_name, extends_round_id,
    reported_raised_amount::text as reported_raised_amount, revision, created_at`;

const RESOURCE = AuditResourceTypeSchema.parse("capital_round");
const AUDIT = {
  OPENED: AuditActionTypeSchema.parse("capital_round.opened"),
  CLOSED: AuditActionTypeSchema.parse("capital_round.closed"),
  REVISED: AuditActionTypeSchema.parse("capital_round.revised"),
  STEP: AuditActionTypeSchema.parse("capital_round.step_recorded"),
} as const;

const STEP_EVENT: Readonly<Record<CapitalRoundStep, CapitalRoundEventType>> = {
  OPEN: "OPENED",
  CLOSE: "CLOSE_RECORDED",
  TRANCHE: "TRANCHE_RECORDED",
  FINAL_CLOSE: "FINAL_CLOSED",
  REOPEN: "REOPENED",
  CANCEL: "CANCELLED",
};

/** numeric::text can carry trailing zeros ("20.00"); amounts read plainly. */
function plain(value: string | null): string | null {
  if (value === null || !value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

function termsOf(row: RoundRow): CapitalRoundTerms {
  return {
    targetCloseOn: row.target_close_on,
    valuation:
      row.valuation_amount === null || row.valuation_basis === null
        ? null
        : {
            amount: plain(row.valuation_amount) ?? "0",
            basis: row.valuation_basis,
          },
    valuationCap: plain(row.valuation_cap_amount),
    discountPercent: plain(row.discount_percent),
    hardCap: plain(row.hard_cap_amount),
    proRataRights: row.pro_rata_rights,
    lead:
      row.lead_relationship_id !== null
        ? { kind: "RELATIONSHIP", relationshipId: row.lead_relationship_id }
        : row.lead_investor_name !== null
          ? { kind: "NAMED", name: row.lead_investor_name }
          : null,
    extendsRoundId: row.extends_round_id,
    reportedRaised: plain(row.reported_raised_amount),
  };
}

function factsOf(row: RoundRow): RoundFacts {
  return {
    name: row.name,
    target: plain(row.target_amount) ?? "0",
    currency: row.currency_code,
    instrument: row.instrument,
    openedOn: row.opened_on,
    terms: termsOf(row),
  };
}

function toRound(row: RoundRow, events: readonly EventRow[]): CapitalRoundDto {
  const own = events.filter((event) => event.round_id === row.id);
  return {
    id: row.id,
    name: row.name,
    target: { amount: row.target_amount, currency: row.currency_code },
    instrument: row.instrument,
    status: row.status,
    isCurrent: row.is_current,
    openedOn: row.opened_on,
    firstClosedOn: row.first_closed_on,
    closedOn: row.closed_on,
    cancelledOn: row.cancelled_on,
    cancelledReason: row.cancelled_reason,
    terms: termsOf(row),
    closes: own
      .filter(
        (event) =>
          event.event_type === "CLOSE_RECORDED" ||
          event.event_type === "TRANCHE_RECORDED" ||
          event.event_type === "FINAL_CLOSED",
      )
      .slice(-50)
      .map((event) => ({
        kind:
          event.event_type === "CLOSE_RECORDED"
            ? ("CLOSE" as const)
            : event.event_type === "TRANCHE_RECORDED"
              ? ("TRANCHE" as const)
              : ("FINAL_CLOSE" as const),
        on: event.occurred_on,
        amount: plain(event.amount),
        label: event.label,
      })),
    corrections: own.filter((event) => event.event_type === "TERMS_REVISED")
      .length,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Today as a calendar date (UTC), for a step taken now. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The terms columns, merged: given fields replace, absent ones stay. */
function mergeTerms(
  base: CapitalRoundTerms,
  input: CapitalRoundTermsInput | undefined,
): CapitalRoundTerms {
  if (input === undefined) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as CapitalRoundTerms;
}

type Scoped = { readonly actor: ActorContext; readonly companyId: CompanyId };
type Command = Scoped & { readonly correlationId: CorrelationId };

export type CapitalRoundService = {
  readonly listRounds: (query: Scoped) => Promise<readonly CapitalRoundDto[]>;
  readonly currentRound: (query: Scoped) => Promise<CapitalRoundDto | null>;
  readonly openRound: (
    command: Command & {
      readonly input: OpenCapitalRoundRequest;
      readonly idempotencyKey: string;
    },
  ) => Promise<CapitalRoundDto>;
  readonly closeRound: (
    command: Command & {
      readonly roundId: string;
      readonly input: CloseCapitalRoundRequest;
    },
  ) => Promise<CapitalRoundDto>;
  readonly reviseRound: (
    command: Command & {
      readonly roundId: string;
      readonly input: ReviseCapitalRoundRequest;
    },
  ) => Promise<CapitalRoundDto>;
  readonly recordStep: (
    command: Command & {
      readonly roundId: string;
      readonly input: RecordCapitalRoundStepRequest;
      readonly idempotencyKey: string;
    },
  ) => Promise<CapitalRoundDto>;
  readonly roundHistory: (
    query: Scoped & { readonly roundId: string },
  ) => Promise<readonly CapitalRoundEventDto[]>;
  /**
   * An investor's view of the rounds their own confirmed commitments count
   * toward. The caller passes only round ids taken from the investor's own
   * Network ledger (Network decided they are a party); no target, totals or
   * other investors leave here. Ownership is computed by the caller.
   */
  readonly roundsForInvestorCommitments: (
    roundIds: readonly string[],
  ) => Promise<
    ReadonlyMap<
      string,
      Omit<InvestorRoundViewDto, "ownershipEstimate"> & {
        readonly currency: string;
      }
    >
  >;
};

export type CapitalRoundDependencies = Pick<
  CapitalServiceDependencies,
  "sql" | "transactions" | "authorization" | "companies" | "audit"
> & {
  /**
   * Whether money has been RECEIVED in this round on Capital Q (Network's
   * ledger, composed by the app). Absent: only recorded closes count.
   */
  readonly moneyReceivedInRound?:
    | ((query: Scoped & { readonly roundId: string }) => Promise<boolean>)
    | undefined;
};

export function createCapitalRoundService(
  dependencies: CapitalRoundDependencies,
): CapitalRoundService {
  const { sql, transactions, authorization, audit } = dependencies;

  async function authorised(
    actor: ActorContext,
    companyId: CompanyId,
    capability: typeof CAPITAL_OBJECTIVE_VIEW,
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

  type Executor = TransactionContext["sql"] | typeof sql;

  async function rows(
    executor: Executor,
    companyId: string,
  ): Promise<RoundRow[]> {
    return executor<RoundRow[]>`
      select ${columns(executor)}
        from core.capital_rounds
       where company_id = ${companyId}
       order by is_current desc, coalesce(opened_on, created_at::date) desc, created_at desc
       limit 50`;
  }

  async function events(
    executor: Executor,
    companyId: string,
    roundId?: string,
  ): Promise<EventRow[]> {
    return executor<EventRow[]>`
      select round_id, revision, event_type, occurred_on::text as occurred_on,
             amount::text as amount, currency_code, label, note, payload,
             actor_user_id, created_at
        from core.capital_round_events
       where company_id = ${companyId}
         ${roundId === undefined ? executor`` : executor`and round_id = ${roundId}`}
       order by created_at, revision
       limit 500`;
  }

  async function read(executor: Executor, companyId: string, roundId: string) {
    const all = await rows(executor, companyId);
    const round = all.find((row) => row.id === roundId);
    if (round === undefined) throw new CapitalRoundNotFoundError();
    return { all, round };
  }

  async function dto(executor: Executor, companyId: string, roundId: string) {
    const { round } = await read(executor, companyId, roundId);
    return toRound(round, await events(executor, companyId, roundId));
  }

  async function record(
    tx: TransactionContext,
    actor: ActorContext,
    action: (typeof AUDIT)[keyof typeof AUDIT],
    roundId: string,
    companyId: string,
    correlationId: CorrelationId,
    metadata: Record<string, string> = {},
  ) {
    await audit.record(tx, {
      ...auditActorFromContext(actor),
      auditEventId: createAuditEventId(),
      actionType: action,
      resourceType: RESOURCE,
      resourceId: roundId,
      occurredAt: occurredNow(),
      outcome: "SUCCEEDED",
      metadata: { companyId, ...metadata },
      correlationId,
    });
  }

  async function appendEvent(
    tx: TransactionContext,
    actor: ActorContext,
    companyId: string,
    roundId: string,
    entry: {
      readonly revision: number;
      readonly type: CapitalRoundEventType;
      readonly on: string;
      readonly amount?: string | undefined;
      readonly currency?: string | undefined;
      readonly label?: string | undefined;
      readonly note?: string | undefined;
      readonly payload?: Record<string, unknown> | undefined;
      readonly idempotencyKey?: string | undefined;
    },
  ) {
    const withAmount = entry.amount !== undefined;
    await tx.sql`
      insert into core.capital_round_events
        (tenant_id, company_id, round_id, revision, event_type, occurred_on,
         amount, currency_code, label, note, payload, actor_user_id, idempotency_key)
      values (${actor.tenantId}, ${companyId}, ${roundId}, ${entry.revision},
              ${entry.type}, ${entry.on}::date,
              ${withAmount ? (entry.amount ?? null) : null}::numeric,
              ${withAmount ? (entry.currency ?? null) : null},
              ${entry.label ?? null}, ${entry.note ?? null},
              ${JSON.stringify(entry.payload ?? {})}::text::jsonb,
              ${actor.userId}, ${entry.idempotencyKey ?? null})`;
  }

  /** "Current" passes to the newest round still raising, else planned. */
  async function handOverCurrent(
    tx: TransactionContext,
    companyId: string,
    leaving: string,
    all: readonly RoundRow[],
  ) {
    const rank = (row: RoundRow) =>
      row.status === "OPEN" || row.status === "FIRST_CLOSED"
        ? 2
        : row.status === "PLANNED"
          ? 1
          : 0;
    const next = all
      .filter((row) => row.id !== leaving && rank(row) > 0)
      .sort(
        (a, b) =>
          rank(b) - rank(a) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];
    if (next !== undefined) {
      await tx.sql`
        update core.capital_rounds
           set is_current = true, updated_at = clock_timestamp()
         where id = ${next.id} and company_id = ${companyId}`;
    }
  }

  /** Make this round current, taking "current" from whichever had it. */
  async function takeCurrent(
    tx: TransactionContext,
    companyId: string,
    roundId: string,
  ) {
    await tx.sql`
      update core.capital_rounds
         set is_current = false, updated_at = clock_timestamp()
       where company_id = ${companyId} and is_current and id <> ${roundId}`;
    await tx.sql`
      update core.capital_rounds
         set is_current = true, updated_at = clock_timestamp()
       where id = ${roundId} and company_id = ${companyId}`;
  }

  function validateTerms(
    all: readonly RoundRow[],
    input: {
      readonly id: string | null;
      readonly target: string;
      readonly openedOn: string | null;
      readonly terms: CapitalRoundTerms;
    },
  ) {
    const refusal = checkRoundTerms(input);
    if (refusal !== null) throw new CapitalRoundTermsError(refusal);
    if (
      input.terms.extendsRoundId !== null &&
      !all.some((row) => row.id === input.terms.extendsRoundId)
    ) {
      throw new CapitalRoundTermsError("EXTENDS_UNKNOWN");
    }
  }

  /** The lead trigger (23514) is the one database refusal a person can cause. */
  async function guarded<T>(
    terms: CapitalRoundTermsInput | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (
        error instanceof DatabaseError &&
        error.sqlState === "23514" &&
        terms?.lead?.kind === "RELATIONSHIP"
      ) {
        throw new CapitalRoundTermsError("LEAD_UNKNOWN");
      }
      throw error;
    }
  }

  async function setTerms(
    tx: TransactionContext,
    roundId: string,
    terms: CapitalRoundTerms,
  ) {
    await tx.sql`
      update core.capital_rounds
         set target_close_on = ${terms.targetCloseOn}::date,
             valuation_amount = ${terms.valuation?.amount ?? null}::numeric,
             valuation_basis = ${terms.valuation?.basis ?? null},
             valuation_cap_amount = ${terms.valuationCap}::numeric,
             discount_percent = ${terms.discountPercent}::numeric,
             hard_cap_amount = ${terms.hardCap}::numeric,
             pro_rata_rights = ${terms.proRataRights},
             lead_relationship_id = ${terms.lead?.kind === "RELATIONSHIP" ? terms.lead.relationshipId : null},
             lead_investor_name = ${terms.lead?.kind === "NAMED" ? terms.lead.name : null},
             extends_round_id = ${terms.extendsRoundId},
             reported_raised_amount = ${terms.reportedRaised}::numeric,
             updated_at = clock_timestamp()
       where id = ${roundId}`;
  }

  async function recordStepIn(
    tx: TransactionContext,
    actor: ActorContext,
    companyId: CompanyId,
    roundId: string,
    input: RecordCapitalRoundStepRequest,
    idempotencyKey: string | undefined,
    correlationId: CorrelationId,
  ): Promise<void> {
    const { all, round } = await read(tx.sql, companyId, roundId);
    if (round.revision !== input.expectedRevision) {
      throw new CapitalRoundRevisionConflictError();
    }
    const on = input.on ?? today();
    const recordedMoney = (await events(tx.sql, companyId, roundId)).some(
      (event) =>
        event.amount !== null &&
        (event.event_type === "CLOSE_RECORDED" ||
          event.event_type === "TRANCHE_RECORDED"),
    );
    const moneyHasClosed =
      recordedMoney ||
      (input.step === "CANCEL" &&
        ((await dependencies.moneyReceivedInRound?.({
          actor,
          companyId,
          roundId,
        })) ??
          false));
    const outcome = nextRoundStatus(round.status, input.step, {
      moneyHasClosed,
    });
    if (!outcome.ok) {
      if (input.step === "FINAL_CLOSE" && round.status === "CLOSED") {
        throw new CapitalRoundClosedError();
      }
      throw new CapitalRoundStepRefusedError(outcome.refusal);
    }
    const closing =
      input.step === "CLOSE" ||
      input.step === "TRANCHE" ||
      input.step === "FINAL_CLOSE";
    if (closing && round.opened_on !== null && on < round.opened_on) {
      throw new CapitalRoundStepRefusedError("DATE_BEFORE_OPEN");
    }
    const revision = round.revision + 1;
    const status = outcome.status;
    switch (input.step) {
      case "OPEN":
        await tx.sql`
          update core.capital_rounds
             set status = ${status}, opened_on = coalesce(opened_on, ${on}::date),
                 revision = ${revision}, updated_at = clock_timestamp()
           where id = ${roundId}`;
        await takeCurrent(tx, companyId, roundId);
        break;
      case "CLOSE":
      case "TRANCHE":
        await tx.sql`
          update core.capital_rounds
             set status = ${status},
                 opened_on = coalesce(opened_on, ${on}::date),
                 first_closed_on = case when ${status} = 'FIRST_CLOSED'
                                        then coalesce(first_closed_on, ${on}::date)
                                        else first_closed_on end,
                 revision = ${revision}, updated_at = clock_timestamp()
           where id = ${roundId}`;
        break;
      case "FINAL_CLOSE":
        await tx.sql`
          update core.capital_rounds
             set status = 'CLOSED', is_current = false,
                 opened_on = coalesce(opened_on, ${on}::date),
                 closed_on = ${on}::date, closed_by_user_id = ${actor.userId},
                 revision = ${revision}, updated_at = clock_timestamp()
           where id = ${roundId}`;
        if (round.is_current)
          await handOverCurrent(tx, companyId, roundId, all);
        break;
      case "REOPEN":
        await tx.sql`
          update core.capital_rounds
             set status = ${status},
                 first_closed_on = case when ${status} = 'FIRST_CLOSED'
                                        then coalesce(first_closed_on, closed_on)
                                        else first_closed_on end,
                 opened_on = coalesce(opened_on, ${on}::date),
                 closed_on = null, closed_by_user_id = null,
                 cancelled_on = null, cancelled_reason = null,
                 revision = ${revision}, updated_at = clock_timestamp()
           where id = ${roundId}`;
        if (!all.some((row) => row.is_current && row.id !== roundId)) {
          await takeCurrent(tx, companyId, roundId);
        }
        break;
      case "CANCEL":
        await tx.sql`
          update core.capital_rounds
             set status = 'CANCELLED', is_current = false,
                 cancelled_on = ${on}::date, cancelled_reason = ${input.note ?? null},
                 revision = ${revision}, updated_at = clock_timestamp()
           where id = ${roundId}`;
        if (round.is_current)
          await handOverCurrent(tx, companyId, roundId, all);
        break;
    }
    await appendEvent(tx, actor, companyId, roundId, {
      revision,
      type: STEP_EVENT[input.step],
      on,
      amount: closing ? input.amount : undefined,
      currency: closing ? round.currency_code : undefined,
      label: input.label,
      note: input.note,
      payload: { from: round.status, to: status },
      idempotencyKey,
    });
    await record(
      tx,
      actor,
      input.step === "FINAL_CLOSE" ? AUDIT.CLOSED : AUDIT.STEP,
      roundId,
      companyId,
      correlationId,
      { step: input.step },
    );
  }

  return {
    listRounds: async ({ actor, companyId }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_VIEW,
      );
      const [all, history] = await Promise.all([
        rows(sql, company.id),
        events(sql, company.id),
      ]);
      return all.map((row) => toRound(row, history));
    },

    currentRound: async ({ actor, companyId }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_VIEW,
      );
      const found = (await rows(sql, company.id)).find((row) => row.is_current);
      return found === undefined
        ? null
        : toRound(found, await events(sql, company.id, found.id));
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
      return guarded(input.terms, () =>
        transactions.run(async (tx) => {
          // One writer per company at a time: "current" moves atomically.
          await tx.sql`select id from core.companies where id = ${company.id} for update`;
          const replay = await tx.sql<{ id: string }[]>`
            select id from core.capital_rounds
             where created_by_user_id = ${actor.userId}
               and idempotency_key = ${idempotencyKey}
               and company_id = ${company.id}`;
          if (replay[0] !== undefined)
            return dto(tx.sql, company.id, replay[0].id);
          const existing = await rows(tx.sql, company.id);
          const terms = mergeTerms(EMPTY_TERMS, input.terms);
          const openedOn =
            status === "PLANNED"
              ? (input.openedOn ?? null)
              : (input.openedOn ?? today());
          const closedOn =
            status === "CLOSED" ? (input.closedOn ?? today()) : null;
          if (closedOn !== null && openedOn !== null && closedOn < openedOn) {
            throw new CapitalRoundStepRefusedError("DATE_BEFORE_OPEN");
          }
          validateTerms(existing, {
            id: null,
            target: input.target.amount,
            openedOn,
            terms,
          });
          const hasCurrent = existing.some((row) => row.is_current);
          // An open round becomes current; a planned one only when none is;
          // a past (closed) one never.
          const current =
            status === "OPEN" || (status === "PLANNED" && !hasCurrent);
          if (current && hasCurrent && status === "OPEN") {
            await tx.sql`
              update core.capital_rounds
                 set is_current = false, updated_at = clock_timestamp()
               where company_id = ${company.id} and is_current`;
          }
          const revision = status === "CLOSED" ? 2 : 1;
          const inserted = await tx.sql<{ id: string }[]>`
            insert into core.capital_rounds
              (tenant_id, company_id, name, target_amount, currency_code, instrument,
               status, is_current, opened_on, closed_on, closed_by_user_id,
               revision, created_by_user_id, idempotency_key)
            values (${actor.tenantId}, ${company.id}, ${input.name.trim()},
                    ${input.target.amount}::numeric, ${input.target.currency},
                    ${input.instrument}, ${status}, ${current},
                    ${openedOn}::date, ${closedOn}::date,
                    ${closedOn === null ? null : actor.userId},
                    ${revision}, ${actor.userId}, ${idempotencyKey})
            returning id`;
          const id = inserted[0]?.id;
          if (id === undefined) throw new CapitalRoundNotFoundError();
          await setTerms(tx, id, terms);
          await appendEvent(tx, actor, company.id, id, {
            revision: 1,
            type: "CREATED",
            on: openedOn ?? today(),
            payload: { status },
          });
          if (closedOn !== null) {
            await appendEvent(tx, actor, company.id, id, {
              revision: 2,
              type: "FINAL_CLOSED",
              on: closedOn,
              label: "Recorded as a past round",
            });
          }
          await record(tx, actor, AUDIT.OPENED, id, company.id, correlationId, {
            status,
          });
          return dto(tx.sql, company.id, id);
        }),
      );
    },

    closeRound: async ({ actor, companyId, roundId, input, correlationId }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_CLOSE,
      );
      return transactions.run(async (tx) => {
        await tx.sql`select id from core.companies where id = ${company.id} for update`;
        const { round } = await read(tx.sql, company.id, roundId);
        if (round.status === "CLOSED") throw new CapitalRoundClosedError();
        await recordStepIn(
          tx,
          actor,
          company.id,
          roundId,
          {
            expectedRevision: round.revision,
            step: "FINAL_CLOSE",
            ...(input.closedOn === undefined
              ? {}
              : {
                  on:
                    round.opened_on !== null && input.closedOn < round.opened_on
                      ? round.opened_on
                      : input.closedOn,
                }),
          },
          undefined,
          correlationId,
        );
        return dto(tx.sql, company.id, roundId);
      });
    },

    reviseRound: async ({
      actor,
      companyId,
      roundId,
      input,
      correlationId,
    }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_EDIT,
      );
      return guarded(input.terms, () =>
        transactions.run(async (tx) => {
          await tx.sql`select id from core.companies where id = ${company.id} for update`;
          const { all, round } = await read(tx.sql, company.id, roundId);
          if (round.revision !== input.expectedRevision) {
            throw new CapitalRoundRevisionConflictError();
          }
          const before = factsOf(round);
          const after: RoundFacts = {
            name: input.name?.trim() ?? before.name,
            target: input.target?.amount ?? before.target,
            currency: input.target?.currency ?? before.currency,
            instrument: input.instrument ?? before.instrument,
            openedOn: input.openedOn ?? before.openedOn,
            terms: mergeTerms(before.terms, input.terms),
          };
          validateTerms(all, {
            id: roundId,
            target: after.target,
            openedOn: after.openedOn,
            terms: after.terms,
          });
          const changes = roundChanges(before, after);
          if (changes.length === 0) return dto(tx.sql, company.id, roundId);
          const revision = round.revision + 1;
          await tx.sql`
            update core.capital_rounds
               set name = ${after.name}, target_amount = ${after.target}::numeric,
                   currency_code = ${after.currency}, instrument = ${after.instrument},
                   opened_on = ${after.openedOn}::date, revision = ${revision},
                   updated_at = clock_timestamp()
             where id = ${roundId}`;
          await setTerms(tx, roundId, after.terms);
          await appendEvent(tx, actor, company.id, roundId, {
            revision,
            type: "TERMS_REVISED",
            on: today(),
            note: input.note,
            payload: { changes },
          });
          await record(
            tx,
            actor,
            AUDIT.REVISED,
            roundId,
            company.id,
            correlationId,
            {
              fields: changes.map((change) => change.field).join(","),
            },
          );
          return dto(tx.sql, company.id, roundId);
        }),
      );
    },

    recordStep: async ({
      actor,
      companyId,
      roundId,
      input,
      idempotencyKey,
      correlationId,
    }) => {
      const capability =
        input.step === "FINAL_CLOSE" || input.step === "CANCEL"
          ? CAPITAL_OBJECTIVE_CLOSE
          : CAPITAL_OBJECTIVE_EDIT;
      const company = await authorised(actor, companyId, capability);
      return transactions.run(async (tx) => {
        await tx.sql`select id from core.companies where id = ${company.id} for update`;
        const replay = await tx.sql<{ round_id: string }[]>`
          select round_id from core.capital_round_events
           where actor_user_id = ${actor.userId}
             and idempotency_key = ${idempotencyKey}
             and company_id = ${company.id}`;
        if (replay[0] !== undefined) {
          if (replay[0].round_id !== roundId)
            throw new CapitalRoundNotFoundError();
          return dto(tx.sql, company.id, roundId);
        }
        await recordStepIn(
          tx,
          actor,
          company.id,
          roundId,
          input,
          idempotencyKey,
          correlationId,
        );
        return dto(tx.sql, company.id, roundId);
      });
    },

    roundHistory: async ({ actor, companyId, roundId }) => {
      const company = await authorised(
        actor,
        companyId,
        CAPITAL_OBJECTIVE_VIEW,
      );
      await read(sql, company.id, roundId);
      const history = await events(sql, company.id, roundId);
      return history.map((event) => {
        const payload =
          typeof event.payload === "object" && event.payload !== null
            ? (event.payload as { changes?: unknown })
            : {};
        const changes = Array.isArray(payload.changes)
          ? payload.changes
              .filter(
                (
                  change,
                ): change is {
                  field: string;
                  from: string | null;
                  to: string | null;
                } =>
                  typeof change === "object" &&
                  change !== null &&
                  typeof (change as { field?: unknown }).field === "string",
              )
              .slice(0, 20)
              .map((change) => ({
                field: change.field,
                from: typeof change.from === "string" ? change.from : null,
                to: typeof change.to === "string" ? change.to : null,
              }))
          : [];
        return {
          revision: event.revision,
          type: event.event_type,
          on: event.occurred_on,
          amount: plain(event.amount),
          currencyCode: event.currency_code,
          label: event.label,
          note: event.note,
          changes,
          byYou: event.actor_user_id === actor.userId,
          at: new Date(event.created_at).toISOString(),
        };
      });
    },

    roundsForInvestorCommitments: async (roundIds) => {
      const ids = [...new Set(roundIds)].slice(0, 200);
      if (ids.length === 0) return new Map();
      const found = await sql<RoundRow[]>`
        select ${columns(sql)}
          from core.capital_rounds
         where id = any(${ids}::uuid[])`;
      return new Map(
        found.map((row) => {
          const terms = termsOf(row);
          return [
            row.id,
            {
              id: row.id,
              name: row.name,
              instrument: row.instrument,
              status: row.status,
              valuation: terms.valuation,
              valuationCap: terms.valuationCap,
              discountPercent: terms.discountPercent,
              proRataRights: terms.proRataRights,
              currency: row.currency_code,
            },
          ];
        }),
      );
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
