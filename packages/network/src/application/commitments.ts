import {
  isActiveMatchState,
  isMatchedRelationshipState,
  type CommitmentDto,
  type CorrelationId,
  type FundraisingDto,
  type StateCommitmentRequest,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { RelationshipIdSchema } from "../contracts/index.js";
import {
  RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
  RELATIONSHIP_EVENT_COMMITMENT_DETECTED,
  RELATIONSHIP_EVENT_COMMITMENT_DISPUTED,
  RELATIONSHIP_EVENT_COMMITMENT_STATED,
  RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN,
} from "../domain/event-registry.js";
import type { RelationshipEventAppender } from "./append-event.js";
import type { InterestService } from "./service.js";

/**
 * Commitments (Product Specification 6.6.14-6.6.15; founder direction
 * 2026-09-29: bookkeeping, and the facilitation record Capital Q's fee rests
 * on).
 *
 * One side states money -- soft, firm or invested -- and only the OTHER
 * side can confirm it, so nobody inflates a raise on their own and money
 * said in a call never becomes committed capital without a person on each
 * side agreeing (6.6.14). A new statement supersedes the relationship's
 * current one; each relationship counts once, in exactly one bucket
 * (6.6.15). Every change is a `commitment_*` activity on the relationship's
 * history in the same transaction; relationship state is untouched.
 *
 * Party and side are decided by Network's own per-party view, never by
 * input: a relationship the caller is not a party to, and a commitment on
 * one, are the same "not found".
 */

export type CommitmentOutcome<T> =
  | { readonly outcome: "OK"; readonly value: T }
  | {
      readonly outcome: "REFUSED";
      readonly code: "NOT_FOUND" | "NOT_CONNECTED" | "NOT_ALLOWED";
    };

type Row = {
  id: string;
  relationship_id: string;
  amount: string;
  currency_code: string;
  level: "SOFT" | "FIRM" | "INVESTED";
  status:
    | "STATED"
    | "CONFIRMED"
    | "SUPERSEDED"
    | "WITHDRAWN"
    | "DETECTED"
    | "ADOPTED"
    | "DISPUTED";
  stated_by_side: "COMPANY" | "INVESTOR" | null;
  source: "PERSON" | "Q_MEETING";
  quote: string | null;
  note: string | null;
  meeting_id: string | null;
  created_at: Date;
  confirmed_at: Date | null;
};

/** Which bucket a current commitment counts in; never both. */
export function commitmentBucket(commitment: {
  readonly level: "SOFT" | "FIRM" | "INVESTED";
  readonly status: "STATED" | "CONFIRMED";
}): "CONFIRMED" | "SOFT" {
  return commitment.status === "CONFIRMED" && commitment.level !== "SOFT"
    ? "CONFIRMED"
    : "SOFT";
}

function toDto(row: Row, side: "COMPANY" | "INVESTOR"): CommitmentDto {
  const current = row.status === "STATED" || row.status === "CONFIRMED";
  return {
    id: row.id,
    amount: row.amount,
    currencyCode: row.currency_code,
    level: row.level,
    status: row.status,
    statedByYourSide: row.stated_by_side === side,
    statedAt: new Date(row.created_at).toISOString(),
    confirmedAt:
      row.confirmed_at === null
        ? null
        : new Date(row.confirmed_at).toISOString(),
    note: row.note,
    meetingId: row.meeting_id,
    source: row.source,
    quote: row.quote,
    canConfirm: row.status === "STATED" && row.stated_by_side !== side,
    canWithdraw: current,
    canAdopt: row.status === "DETECTED",
    canDispute: row.status === "DETECTED",
  };
}

export function createCommitmentService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly interests: Pick<
    InterestService,
    "relationshipById" | "listRelationshipsForCompany"
  >;
  readonly appender: RelationshipEventAppender;
  readonly newCorrelationId: () => CorrelationId;
}) {
  const { sql, transactions, interests, appender } = dependencies;

  async function partyOf(actor: ActorContext, relationshipId: string) {
    const view = await interests
      .relationshipById({ actor, relationshipId })
      .catch(() => null);
    if (view === null || view.status === null) return null;
    return {
      side: view.side,
      // A commitment is stated in a live or paused match (relationship-
      // state.v2); an investment already made stays readable.
      connected:
        isMatchedRelationshipState(view.status.projection.state) &&
        view.status.projection.state !== "PASSED",
      tenantId: view.status.relationship.tenantId,
    };
  }

  async function rowsOf(relationshipId: string): Promise<readonly Row[]> {
    return sql<Row[]>`
      select id, relationship_id, amount::text as amount, currency_code, level,
             status, stated_by_side, source, quote, note, meeting_id, created_at,
             confirmed_at
        from network.commitments
       where relationship_id = ${relationshipId}
       order by created_at desc
       limit 20`;
  }

  async function commitmentRow(commitmentId: string): Promise<Row | null> {
    const rows = await sql<Row[]>`
      select id, relationship_id, amount::text as amount, currency_code, level,
             status, stated_by_side, source, quote, note, meeting_id, created_at,
             confirmed_at
        from network.commitments
       where id = ${commitmentId}`;
    return rows[0] ?? null;
  }

  async function record(
    tx: Parameters<Parameters<TransactionManager["run"]>[0]>[0],
    actor: ActorContext,
    relationshipId: string,
    eventType: string,
    commitmentId: string,
    /** relationship-state.v2 reads a confirmed INVESTED commitment. */
    level?: "SOFT" | "FIRM" | "INVESTED",
  ): Promise<void> {
    await appender.append(tx, {
      relationshipId: RelationshipIdSchema.parse(relationshipId),
      eventType,
      actor: { type: "HUMAN", id: actor.userId },
      source: { type: "MANUAL", id: commitmentId },
      // Both sides are parties to a commitment between them.
      visibilityScope: "relationship_shared",
      payload: level === undefined ? { commitmentId } : { commitmentId, level },
      correlationId: dependencies.newCorrelationId(),
    });
  }

  async function view(actor: ActorContext, relationshipId: string) {
    const party = await partyOf(actor, relationshipId);
    if (party === null) return null;
    const rows = await rowsOf(relationshipId);
    const current =
      rows.find(
        (row) => row.status === "STATED" || row.status === "CONFIRMED",
      ) ?? null;
    return {
      current: current === null ? null : toDto(current, party.side),
      history: rows.map((row) => toDto(row, party.side)),
      detected: rows
        .filter((row) => row.status === "DETECTED")
        .slice(0, 10)
        .map((row) => toDto(row, party.side)),
      connected: party.connected,
    };
  }

  /** A commitment a party acts on, with that party's side. */
  async function detectedFor(actor: ActorContext, commitmentId: string) {
    const row = await commitmentRow(commitmentId);
    if (row === null) return null;
    const party = await partyOf(actor, row.relationship_id);
    if (party === null) return null;
    return { row, party };
  }

  return {
    view,

    /**
     * Money Q heard in a call it recorded (founder direction 2026-09-30).
     * Filed once per signal; it never counts until a party adopts it and
     * the other side confirms. No actor: Q's record is the source, and the
     * relationship's history names Q (for this call) as the actor.
     */
    detect: async (input: {
      readonly relationshipId: string;
      readonly meetingId: string;
      readonly amount: string;
      readonly currencyCode: string;
      readonly level: "SOFT" | "FIRM";
      readonly statedBySide: "COMPANY" | "INVESTOR" | null;
      readonly quote: string;
      readonly key: string;
    }): Promise<boolean> =>
      transactions.run(async (tx) => {
        const inserted = await tx.sql<{ id: string }[]>`
          insert into network.commitments
            (tenant_id, relationship_id, amount, currency_code, level, status,
             stated_by_side, source, quote, meeting_id, idempotency_key)
          select r.tenant_id, r.id, ${input.amount}::numeric, ${input.currencyCode},
                 ${input.level}, 'DETECTED', ${input.statedBySide}, 'Q_MEETING',
                 ${input.quote.slice(0, 300)}, ${input.meetingId}, ${input.key}
            from network.relationships r
           where r.id = ${input.relationshipId}
          on conflict (relationship_id, idempotency_key) where source <> 'PERSON'
          do nothing
          returning id`;
        const id = inserted[0]?.id;
        if (id === undefined) return false;
        await appender.append(tx, {
          relationshipId: RelationshipIdSchema.parse(input.relationshipId),
          eventType: RELATIONSHIP_EVENT_COMMITMENT_DETECTED,
          actor: { type: "Q", id: input.meetingId },
          source: { type: "Q", id },
          visibilityScope: "relationship_shared",
          payload: { commitmentId: id },
          correlationId: dependencies.newCorrelationId(),
        });
        return true;
      }),

    /** A party adopts detected money as their side's statement. */
    adopt: async (
      actor: ActorContext,
      commitmentId: string,
      idempotencyKey: string,
    ): Promise<
      CommitmentOutcome<NonNullable<Awaited<ReturnType<typeof view>>>>
    > => {
      const found = await detectedFor(actor, commitmentId);
      if (found === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      const { row, party } = found;
      if (row.status !== "DETECTED") {
        return { outcome: "REFUSED", code: "NOT_ALLOWED" };
      }
      if (!party.connected) {
        return { outcome: "REFUSED", code: "NOT_CONNECTED" };
      }
      await transactions.run(async (tx) => {
        const marked = await tx.sql<{ id: string }[]>`
          update network.commitments
             set status = 'ADOPTED', updated_at = clock_timestamp()
           where id = ${commitmentId} and status = 'DETECTED'
          returning id`;
        if (marked.length === 0) return;
        // The adopted statement replaces whatever counted before it.
        await tx.sql`
          update network.commitments
             set status = 'SUPERSEDED', updated_at = clock_timestamp()
           where relationship_id = ${row.relationship_id}
             and status in ('STATED', 'CONFIRMED')`;
        const inserted = await tx.sql<{ id: string }[]>`
          insert into network.commitments
            (tenant_id, relationship_id, amount, currency_code, level,
             stated_by_side, stated_by_user_id, note, meeting_id, idempotency_key)
          values (${party.tenantId}, ${row.relationship_id}, ${row.amount}::numeric,
                  ${row.currency_code}, ${row.level}, ${party.side}, ${actor.userId},
                  'Adopted from what Q heard in a call.', ${row.meeting_id},
                  ${idempotencyKey})
          returning id`;
        const id = inserted[0]?.id;
        if (id !== undefined) {
          await record(
            tx,
            actor,
            row.relationship_id,
            RELATIONSHIP_EVENT_COMMITMENT_STATED,
            id,
          );
        }
      });
      const after = await view(actor, row.relationship_id);
      return after === null
        ? { outcome: "REFUSED", code: "NOT_FOUND" }
        : { outcome: "OK", value: after };
    },

    /** A party disputes detected money; it stays on record, disputed. */
    dispute: async (
      actor: ActorContext,
      commitmentId: string,
    ): Promise<
      CommitmentOutcome<NonNullable<Awaited<ReturnType<typeof view>>>>
    > => {
      const found = await detectedFor(actor, commitmentId);
      if (found === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      const { row } = found;
      if (row.status !== "DETECTED") {
        return { outcome: "REFUSED", code: "NOT_ALLOWED" };
      }
      await transactions.run(async (tx) => {
        const updated = await tx.sql<{ id: string }[]>`
          update network.commitments
             set status = 'DISPUTED', disputed_by_user_id = ${actor.userId},
                 disputed_at = clock_timestamp(), updated_at = clock_timestamp()
           where id = ${commitmentId} and status = 'DETECTED'
          returning id`;
        if (updated.length > 0) {
          await record(
            tx,
            actor,
            row.relationship_id,
            RELATIONSHIP_EVENT_COMMITMENT_DISPUTED,
            commitmentId,
          );
        }
      });
      const after = await view(actor, row.relationship_id);
      return after === null
        ? { outcome: "REFUSED", code: "NOT_FOUND" }
        : { outcome: "OK", value: after };
    },

    state: async (input: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly request: StateCommitmentRequest;
      readonly idempotencyKey: string;
    }): Promise<
      CommitmentOutcome<NonNullable<Awaited<ReturnType<typeof view>>>>
    > => {
      const { actor, relationshipId, request } = input;
      const party = await partyOf(actor, relationshipId);
      if (party === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      if (!party.connected) {
        return { outcome: "REFUSED", code: "NOT_CONNECTED" };
      }
      await transactions.run(async (tx) => {
        const existing = await tx.sql<{ id: string }[]>`
          select id from network.commitments
           where stated_by_user_id = ${actor.userId}
             and idempotency_key = ${input.idempotencyKey}`;
        if (existing.length > 0) return;
        // The new statement replaces whatever counted before it.
        await tx.sql`
          update network.commitments
             set status = 'SUPERSEDED', updated_at = clock_timestamp()
           where relationship_id = ${relationshipId}
             and status in ('STATED', 'CONFIRMED')`;
        const inserted = await tx.sql<{ id: string }[]>`
          insert into network.commitments
            (tenant_id, relationship_id, amount, currency_code, level,
             stated_by_side, stated_by_user_id, note, meeting_id, idempotency_key)
          values (${party.tenantId}, ${relationshipId}, ${request.amount}::numeric,
                  ${request.currencyCode}, ${request.level}, ${party.side},
                  ${actor.userId}, ${request.note ?? null},
                  ${request.meetingId ?? null}, ${input.idempotencyKey})
          returning id`;
        const id = inserted[0]?.id;
        if (id !== undefined) {
          await record(
            tx,
            actor,
            relationshipId,
            RELATIONSHIP_EVENT_COMMITMENT_STATED,
            id,
          );
        }
      });
      const after = await view(actor, relationshipId);
      return after === null
        ? { outcome: "REFUSED", code: "NOT_FOUND" }
        : { outcome: "OK", value: after };
    },

    confirm: async (
      actor: ActorContext,
      commitmentId: string,
    ): Promise<
      CommitmentOutcome<NonNullable<Awaited<ReturnType<typeof view>>>>
    > => {
      const row = await commitmentRow(commitmentId);
      if (row === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      const party = await partyOf(actor, row.relationship_id);
      if (party === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      // Only the other side confirms, and only what still counts.
      if (row.status !== "STATED" || row.stated_by_side === party.side) {
        return { outcome: "REFUSED", code: "NOT_ALLOWED" };
      }
      await transactions.run(async (tx) => {
        const updated = await tx.sql<{ id: string }[]>`
          update network.commitments
             set status = 'CONFIRMED', confirmed_by_user_id = ${actor.userId},
                 confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
           where id = ${commitmentId} and status = 'STATED'
          returning id`;
        if (updated.length > 0) {
          await record(
            tx,
            actor,
            row.relationship_id,
            RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
            commitmentId,
            row.level,
          );
        }
      });
      const after = await view(actor, row.relationship_id);
      return after === null
        ? { outcome: "REFUSED", code: "NOT_FOUND" }
        : { outcome: "OK", value: after };
    },

    withdraw: async (
      actor: ActorContext,
      commitmentId: string,
    ): Promise<
      CommitmentOutcome<NonNullable<Awaited<ReturnType<typeof view>>>>
    > => {
      const row = await commitmentRow(commitmentId);
      if (row === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      const party = await partyOf(actor, row.relationship_id);
      if (party === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      if (row.status !== "STATED" && row.status !== "CONFIRMED") {
        return { outcome: "REFUSED", code: "NOT_ALLOWED" };
      }
      await transactions.run(async (tx) => {
        const updated = await tx.sql<{ id: string }[]>`
          update network.commitments
             set status = 'WITHDRAWN', withdrawn_by_user_id = ${actor.userId},
                 withdrawn_at = clock_timestamp(), updated_at = clock_timestamp()
           where id = ${commitmentId} and status in ('STATED', 'CONFIRMED')
          returning id`;
        if (updated.length > 0) {
          await record(
            tx,
            actor,
            row.relationship_id,
            RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN,
            commitmentId,
            row.level,
          );
        }
      });
      const after = await view(actor, row.relationship_id);
      return after === null
        ? { outcome: "REFUSED", code: "NOT_FOUND" }
        : { outcome: "OK", value: after };
    },

    /**
     * The company's raise (6.6.15): confirmed, soft, the connected pipeline
     * and what remains of the target, each relationship counted once.
     * Access is the company's own relationship listing; sums are Postgres
     * numeric, never float.
     */
    fundraising: async (input: {
      readonly actor: ActorContext;
      readonly companyId: string;
      readonly target: {
        readonly amount: string;
        readonly currencyCode: string;
      } | null;
    }): Promise<FundraisingDto> => {
      const listing = await interests.listRelationshipsForCompany({
        actor: input.actor,
        companyId: input.companyId,
      });
      const ids = listing.map((item) => item.relationship.id);
      const rows =
        ids.length === 0
          ? []
          : await sql<(Row & { investor_organisation_id: string })[]>`
              select c.id, c.relationship_id, c.amount::text as amount,
                     c.currency_code, c.level, c.status, c.stated_by_side,
                     c.note, c.meeting_id, c.created_at, c.confirmed_at,
                     r.investor_organisation_id
                from network.commitments c
                join network.relationships r on r.id = c.relationship_id
               where c.relationship_id = any(${ids}::uuid[])
                 and c.status in ('STATED', 'CONFIRMED')`;
      const nameOf = new Map<string, string>(
        listing.map((item) => [item.relationship.id, item.counterpartName]),
      );
      const investors = rows.map((row) => ({
        relationshipId: row.relationship_id,
        investorOrganisationId: row.investor_organisation_id,
        investorName: nameOf.get(row.relationship_id) ?? "An investor",
        amount: row.amount,
        currencyCode: row.currency_code,
        level: row.level,
        bucket: commitmentBucket({
          level: row.level,
          status: row.status === "CONFIRMED" ? "CONFIRMED" : "STATED",
        }),
      }));
      const committed = new Set(rows.map((row) => row.relationship_id));
      const pipeline = listing.filter(
        (item) =>
          isActiveMatchState(item.projection.state) &&
          !committed.has(item.relationship.id),
      ).length;

      // Exact sums per currency and bucket, in the database.
      const confirmedIds = investors
        .filter((item) => item.bucket === "CONFIRMED")
        .map((item) => item.relationshipId);
      const totals =
        rows.length === 0
          ? []
          : await sql<
              { currency_code: string; confirmed: string; soft: string }[]
            >`
              select currency_code,
                     coalesce(sum(amount) filter (where relationship_id = any(${confirmedIds}::uuid[])), 0)::text as confirmed,
                     coalesce(sum(amount) filter (where not (relationship_id = any(${confirmedIds}::uuid[]))), 0)::text as soft
                from network.commitments
               where relationship_id = any(${ids}::uuid[])
                 and status in ('STATED', 'CONFIRMED')
               group by currency_code
               order by currency_code`;
      let remaining: string | null = null;
      if (input.target !== null) {
        const inTarget = totals.find(
          (row) => row.currency_code === input.target?.currencyCode,
        );
        const left = await sql<{ remaining: string }[]>`
          select greatest(${input.target.amount}::numeric - ${inTarget?.confirmed ?? "0"}::numeric, 0)::text as remaining`;
        remaining = left[0]?.remaining ?? null;
      }
      return {
        target: input.target,
        totals: totals.map((row) => ({
          currencyCode: row.currency_code,
          confirmed: row.confirmed,
          soft: row.soft,
        })),
        remaining,
        pipeline,
        investors,
      };
    },
  };
}

export type CommitmentService = ReturnType<typeof createCommitmentService>;
