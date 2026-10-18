import {
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type {
  CorrelationId,
  DealViewDto,
  RecordDealTermsRequest,
  RelationshipReportContent,
  RelationshipReportDto,
  RelationshipReportKind,
  RelationshipReportSummaryDto,
} from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { ActorContext } from "@capital-q/security";

import { RelationshipIdSchema } from "../contracts/index.js";
import {
  compileReport,
  DEAL_REPORT_COMPILER,
  REPORT_POLICY,
  reportDigest,
  type ReportFacts,
} from "../domain/deal-reports.js";
import {
  CLOSE_CHECKLIST,
  dealNextSteps,
  DEAL_STAGES,
  draftPassNote,
  projectDealStage,
  postCloseCadence,
  type DealStageProjection,
} from "../domain/deal-stage.js";
import {
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
  RELATIONSHIP_EVENT_DEAL_CLOSED,
  RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED,
  RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED,
  RELATIONSHIP_EVENT_DOCUMENT_SHARED,
} from "../domain/event-registry.js";
import {
  visibleToParty,
  type ProjectableEvent,
  type RelationshipParty,
} from "../domain/state-projector.js";

/** The party's view of history rows, keeping each row's own fields. */
const visibleAs = <T extends ProjectableEvent>(
  events: readonly T[],
  party: RelationshipParty,
): readonly T[] => visibleToParty(events, party) as readonly T[];
import { relationshipOutcomeRecordedEvent } from "../events/index.js";
import type { RelationshipEventAppender } from "./append-event.js";
import type { RelationshipOutcomeService } from "./outcomes.js";
import type { InterestService } from "./service.js";

/**
 * Deal close (founder, 2026-10-08): after the meeting, to a clean end, on
 * the ONE canonical relationship. No deal record: terms, signature and
 * close are rows the relationship's history references, and the stage
 * strip is deal-stage.v1's fold of that history. Money stays with the
 * commitment service (soft commit, sent, received; spec 6.6.14).
 *
 * Every step is consequential (ADR 0043: TERMS / MONEY): its app action is
 * CONSEQUENTIAL, so Q only ever prepares it and a person approves exactly
 * the card. Each write is one transaction -- row, history event, audit
 * record, outbox announcement -- keyed by the person's idempotency key, so
 * a retried press records once. Party and side come from Network's own
 * per-party view, never from input.
 *
 * Reports are compiled from the record at the moment they are asked for,
 * stored versioned and append-only with an explicit visibility, and listed
 * to whoever may read them. A shared report is compiled only from history
 * both sides may read.
 */

export type DealRefusal =
  | "NOT_FOUND"
  | "NOT_ALLOWED"
  | "NOT_IN_STAGE"
  | "DOCUMENT_NOT_SHARED"
  | "TERMS_CHANGED"
  | "UNKNOWN_ITEM";

export type DealResult =
  | {
      readonly outcome: "OK";
      readonly relationshipId: string;
      readonly deduplicated: boolean;
    }
  | { readonly outcome: "REFUSED"; readonly code: DealRefusal };

export type ReportResult =
  | {
      readonly outcome: "OK";
      readonly report: RelationshipReportSummaryDto;
      readonly deduplicated: boolean;
    }
  | { readonly outcome: "REFUSED"; readonly code: DealRefusal };

/** A recorded meeting as the asking party may read it. */
export type DealMeetingNote = {
  readonly heldAt: string;
  readonly title: string | null;
  readonly summary: string | null;
};

const ACTION_TERMS = AuditActionTypeSchema.parse(
  "relationship.deal_terms_recorded",
);
const ACTION_SIGNED = AuditActionTypeSchema.parse(
  "relationship.deal_terms_signed",
);
const ACTION_CLOSED = AuditActionTypeSchema.parse("relationship.deal_closed");
const ACTION_REPORT = AuditActionTypeSchema.parse(
  "relationship.report_generated",
);
const RESOURCE_TERMS = AuditResourceTypeSchema.parse("deal_terms");
const RESOURCE_CLOSE = AuditResourceTypeSchema.parse("deal_close");
const RESOURCE_REPORT = AuditResourceTypeSchema.parse("relationship_report");

type Tx = TransactionContext;
type Executor = DatabaseExecutor | TransactionContext["sql"];

type TermsRow = {
  id: string;
  version: number;
  status: "RECORDED" | "SIGNED" | "SUPERSEDED";
  instrument: "SAFE" | "CONVERTIBLE_NOTE" | "PRICED_EQUITY" | "OTHER";
  amount: string;
  currency_code: string;
  valuation_cap: string | null;
  valuation_basis: "PRE_MONEY" | "POST_MONEY" | null;
  pre_money_valuation: string | null;
  discount_percent: string | null;
  pro_rata: boolean | null;
  other_terms: string | null;
  terms_document_id: string | null;
  recorded_by_side: "INVESTOR" | "COMPANY";
  recorded_by: string | null;
  created_at: Date;
  signed_document_id: string | null;
  signed_by: string | null;
  signed_at: Date | null;
};

export function createDealCloseService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly interests: Pick<InterestService, "relationshipById">;
  readonly appender: RelationshipEventAppender;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  /** The investor's own pass, for the pass report (investor side only). */
  readonly outcomes?:
    Pick<RelationshipOutcomeService, "latestPass"> | undefined;
  /** The two names on a report; absent: plain words stand in. */
  readonly names?:
    | ((relationship: {
        readonly companyId: string;
        readonly investorOrganisationId: string;
      }) => Promise<{
        readonly company: string | null;
        readonly investor: string | null;
      }>)
    | undefined;
  /** The relationship's recorded meetings, read as the asking person. */
  readonly meetings?:
    | ((
        actor: ActorContext,
        relationshipId: string,
      ) => Promise<readonly DealMeetingNote[]>)
    | undefined;
  readonly newCorrelationId: () => CorrelationId;
  /** Today's date (UTC, YYYY-MM-DD) for a close; injectable for tests. */
  readonly today?: (() => string) | undefined;
  readonly now?: (() => Date) | undefined;
}) {
  const { sql, transactions, interests, appender, outbox, audit } =
    dependencies;
  const now = dependencies.now ?? (() => new Date());
  const today = dependencies.today ?? (() => now().toISOString().slice(0, 10));

  async function partyOf(actor: ActorContext, relationshipId: string) {
    const parsed = RelationshipIdSchema.safeParse(relationshipId);
    if (!parsed.success) return null;
    const view = await interests
      .relationshipById({ actor, relationshipId: parsed.data })
      .catch(() => null);
    if (view === null || view.status === null) return null;
    const relationship = view.status.relationship;
    return {
      relationshipId: parsed.data,
      side: view.side,
      state: view.status.projection.state as string,
      tenantId: relationship.tenantId as string,
      companyId: relationship.companyId as string,
      investorOrganisationId: relationship.investorOrganisationId as string,
    };
  }
  type Party = NonNullable<Awaited<ReturnType<typeof partyOf>>>;

  async function history(
    executor: Executor,
    relationshipId: string,
  ): Promise<(ProjectableEvent & { actorId: string; actor: string | null })[]> {
    const rows = await executor<
      {
        sequence: string;
        event_type: string;
        occurred_at: Date;
        visibility_scope: ProjectableEvent["visibilityScope"];
        payload: Record<string, unknown>;
        actor_id: string;
        actor_name: string | null;
      }[]
    >`
      select e.sequence, e.event_type, e.occurred_at, e.visibility_scope,
             e.payload, e.actor_id, coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(concat_ws(' ', u.given_name, u.family_name)), '')) as actor_name
        from network.relationship_events e
        left join identity.user_profiles u on u.id = e.actor_id
       where e.relationship_id = ${relationshipId}
       order by e.sequence`;
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString(),
      visibilityScope: row.visibility_scope,
      payload: row.payload,
      actorId: row.actor_id,
      actor: row.actor_name,
    }));
  }

  /** History both sides may read: what a shared report is compiled from. */
  const sharedOnly = <T extends ProjectableEvent>(events: readonly T[]) =>
    visibleAs(visibleAs(events, "INVESTOR"), "COMPANY");

  async function termsOf(executor: Executor, relationshipId: string) {
    return executor<TermsRow[]>`
      select t.id, t.version, t.status, t.instrument, t.amount::text as amount,
             t.currency_code, t.valuation_cap::text as valuation_cap,
             t.valuation_basis, t.pre_money_valuation::text as pre_money_valuation,
             t.discount_percent::text as discount_percent, t.pro_rata,
             t.other_terms, t.terms_document_id, t.recorded_by_side,
             coalesce(nullif(btrim(r.display_name), ''), nullif(btrim(concat_ws(' ', r.given_name, r.family_name)), '')) as recorded_by, t.created_at,
             t.signed_document_id, coalesce(nullif(btrim(s.display_name), ''), nullif(btrim(concat_ws(' ', s.given_name, s.family_name)), '')) as signed_by,
             t.signed_at
        from network.deal_terms t
        left join identity.user_profiles r on r.id = t.recorded_by_user_id
        left join identity.user_profiles s on s.id = t.signed_by_user_id
       where t.relationship_id = ${relationshipId}
       order by t.version desc`;
  }

  /** Documents the company shared with this relationship (history ids only). */
  function sharedDocumentIds(events: readonly ProjectableEvent[]): string[] {
    const ids = new Set<string>();
    for (const event of events) {
      if (event.eventType === RELATIONSHIP_EVENT_DOCUMENT_SHARED) {
        const id = event.payload?.["documentId"];
        if (typeof id === "string") ids.add(id);
      }
      if (event.eventType === RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED) {
        const list = event.payload?.["documentIds"];
        if (Array.isArray(list)) {
          for (const id of list) if (typeof id === "string") ids.add(id);
        }
      }
    }
    return [...ids].sort();
  }

  function auditActor(actor: ActorContext) {
    return actor.actorType === "HUMAN"
      ? auditActorFromContext(actor)
      : {
          tenantId: actor.tenantId,
          actorType: "Q" as const,
          authorityUserId: actor.userId,
          organisationId: actor.organisationId,
        };
  }

  async function recordAudit(
    tx: Tx,
    actor: ActorContext,
    party: Party,
    input: {
      readonly actionType: typeof ACTION_TERMS;
      readonly resourceType: typeof RESOURCE_TERMS;
      readonly resourceId: string;
      readonly metadata: Record<string, string | number | boolean | null>;
      readonly correlationId: CorrelationId;
    },
  ) {
    await audit.record(tx, {
      ...auditActor(actor),
      auditEventId: createAuditEventId(),
      actionType: input.actionType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      relationshipId: party.relationshipId,
      occurredAt: occurredNow(),
      outcome: "SUCCEEDED",
      metadata: { side: party.side, ...input.metadata },
      correlationId: input.correlationId,
    });
  }

  async function announce(
    tx: Tx,
    actor: ActorContext,
    party: Party,
    outcome: "TERMS_RECORDED" | "TERMS_SIGNED" | "CLOSED",
    correlationId: CorrelationId,
  ) {
    await outbox.enqueue(
      tx,
      relationshipOutcomeRecordedEvent({
        tenantId: party.tenantId,
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        correlationId,
        relationshipId: party.relationshipId,
        companyId: party.companyId,
        investorOrganisationId: party.investorOrganisationId,
        outcome,
        side: party.side,
      }),
    );
  }

  async function lock(tx: Tx, relationshipId: string) {
    await tx.sql`select id from network.relationships where id = ${relationshipId} for update`;
  }

  const ok = (relationshipId: string, deduplicated: boolean): DealResult => ({
    outcome: "OK",
    relationshipId,
    deduplicated,
  });
  const refused = (code: DealRefusal) =>
    ({ outcome: "REFUSED", code }) as const;

  async function currentCommitment(executor: Executor, relationshipId: string) {
    const rows = await executor<
      {
        id: string;
        amount: string;
        currency_code: string;
        level: string;
        status: string;
        stated_by: string | null;
        created_at: Date;
        confirmed_by: string | null;
        confirmed_at: Date | null;
        received_by: string | null;
        received_at: Date | null;
      }[]
    >`
      select c.id, c.amount::text as amount, c.currency_code, c.level, c.status,
             coalesce(nullif(btrim(s.display_name), ''), nullif(btrim(concat_ws(' ', s.given_name, s.family_name)), '')) as stated_by, c.created_at,
             coalesce(nullif(btrim(k.display_name), ''), nullif(btrim(concat_ws(' ', k.given_name, k.family_name)), '')) as confirmed_by, c.confirmed_at,
             coalesce(nullif(btrim(r.display_name), ''), nullif(btrim(concat_ws(' ', r.given_name, r.family_name)), '')) as received_by, c.received_at
        from network.commitments c
        left join identity.user_profiles s on s.id = c.stated_by_user_id
        left join identity.user_profiles k on k.id = c.confirmed_by_user_id
        left join identity.user_profiles r on r.id = c.received_by_user_id
       where c.relationship_id = ${relationshipId}
         and c.status in ('STATED', 'CONFIRMED', 'TRANSFER_SENT', 'RECEIVED')
       order by c.created_at desc
       limit 1`;
    return rows[0] ?? null;
  }

  const termsDto = (row: TermsRow) => ({
    termsId: row.id,
    version: row.version,
    status: row.status,
    instrument: row.instrument,
    amount: row.amount,
    currencyCode: row.currency_code,
    valuationCap: row.valuation_cap,
    valuationBasis: row.valuation_basis,
    preMoneyValuation: row.pre_money_valuation,
    discountPercent: row.discount_percent,
    proRata: row.pro_rata,
    otherTerms: row.other_terms,
    termsDocumentId: row.terms_document_id,
    recordedBySide: row.recorded_by_side,
    recordedBy: row.recorded_by,
    recordedAt: row.created_at.toISOString(),
    signedDocumentId: row.signed_document_id,
    signedBy: row.signed_by,
    signedAt: row.signed_at?.toISOString() ?? null,
  });

  async function reportsFor(
    party: Party,
  ): Promise<RelationshipReportSummaryDto[]> {
    // Visibility before anything is listed: shared ones, and this side's own.
    const ownPrivate =
      party.side === "INVESTOR" ? "investor_private" : "founder_private";
    const rows = await sql<
      {
        id: string;
        kind: RelationshipReportKind;
        version: number;
        title: string;
        visibility_scope:
          "investor_private" | "founder_private" | "relationship_shared";
        owner_side: "INVESTOR" | "COMPANY";
        generated_by: string | null;
        created_at: Date;
        content_sha256: string;
      }[]
    >`
      select p.id, p.kind, p.version, p.title, p.visibility_scope, p.owner_side,
             coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(concat_ws(' ', u.given_name, u.family_name)), '')) as generated_by, p.created_at, p.content_sha256
        from network.relationship_reports p
        left join identity.user_profiles u on u.id = p.generated_by_user_id
       where p.relationship_id = ${party.relationshipId}
         and (p.visibility_scope = 'relationship_shared'
              or (p.visibility_scope = ${ownPrivate} and p.owner_side = ${party.side}))
       order by p.created_at desc, p.version desc`;
    return rows.map((row) => ({
      reportId: row.id,
      kind: row.kind,
      version: row.version,
      title: row.title,
      visibility: row.visibility_scope,
      ownerSide: row.owner_side,
      generatedBy: row.generated_by,
      createdAt: row.created_at.toISOString(),
      contentSha256: row.content_sha256,
    }));
  }

  async function view(
    actor: ActorContext,
    relationshipId: string,
  ): Promise<DealViewDto | null> {
    const party = await partyOf(actor, relationshipId);
    if (party === null) return null;
    const events = visibleAs(
      await history(sql, party.relationshipId),
      party.side,
    );
    const projection = projectDealStage(events);
    const terms = await termsOf(sql, party.relationshipId);
    const closes = await sql<
      {
        closed_on: string;
        closed_by_side: "INVESTOR" | "COMPANY";
        closed_by: string | null;
        note: string | null;
      }[]
    >`
      select d.closed_on::text as closed_on, d.closed_by_side,
             coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(concat_ws(' ', u.given_name, u.family_name)), '')) as closed_by, d.note
        from network.deal_closes d
        left join identity.user_profiles u on u.id = d.closed_by_user_id
       where d.relationship_id = ${party.relationshipId}`;
    const ticks = await sql<{ item_code: string; done_at: Date }[]>`
      select item_code, done_at from network.deal_close_checklist
       where relationship_id = ${party.relationshipId} and side = ${party.side}`;
    const closed = projection.end?.kind === "CLOSED";
    const checklist = closed
      ? CLOSE_CHECKLIST[party.side].map((item) => {
          const tick = ticks.find((row) => row.item_code === item.code);
          const fromRecord =
            item.fromRecord !== undefined &&
            projection.reached[item.fromRecord] !== null;
          return {
            code: item.code,
            label: item.label,
            done: fromRecord || tick !== undefined,
            doneAt: fromRecord
              ? (projection.reached[item.fromRecord ?? "CLOSED"] ?? null)
              : (tick?.done_at.toISOString() ?? null),
            fromRecord,
          };
        })
      : [];
    const steps = dealNextSteps({
      projection,
      relationshipState: party.state,
      side: party.side,
    });
    const close = closes[0];
    let passNoteDraft: string | null = null;
    if (steps.includes("PASS")) {
      // The reason is the investor's to choose; the page fills it in.
      const names = await namesOf(party);
      passNoteDraft = draftPassNote({
        companyName: names.company,
        reasonCode: null,
      });
    }
    return {
      relationshipId: party.relationshipId,
      side: party.side,
      stageVersion: projection.version,
      stages: DEAL_STAGES.map((stage) => ({
        stage,
        reachedAt: projection.reached[stage],
      })),
      current: projection.current,
      end: projection.end,
      nextSteps: [...steps],
      terms: (() => {
        const current = terms.find((row) => row.status !== "SUPERSEDED");
        return current === undefined ? null : termsDto(current);
      })(),
      termsHistory: terms.map(termsDto),
      close:
        close === undefined
          ? null
          : {
              closedOn: close.closed_on,
              closedBySide: close.closed_by_side,
              closedBy: close.closed_by,
              note: close.note,
            },
      checklist,
      updateCadence: closed ? postCloseCadence().sentence : null,
      passNoteDraft,
      sharedDocumentIds: sharedDocumentIds(events),
      reports: await reportsFor(party),
    };
  }

  async function namesOf(party: Party) {
    const found =
      dependencies.names === undefined
        ? null
        : await dependencies
            .names({
              companyId: party.companyId,
              investorOrganisationId: party.investorOrganisationId,
            })
            .catch(() => null);
    return {
      company: found?.company ?? "the company",
      investor: found?.investor ?? "the investor",
    };
  }

  return {
    view,

    /** Terms both sides see; a revision supersedes the current version. */
    recordTerms: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly terms: RecordDealTermsRequest;
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DealResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      const replay = await sql<{ id: string }[]>`
        select id from network.deal_terms
         where recorded_by_user_id = ${command.actor.userId}
           and idempotency_key = ${command.idempotencyKey}`;
      if (replay[0] !== undefined) return ok(party.relationshipId, true);
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const terms = command.terms;
      return transactions.run(async (tx) => {
        await lock(tx, party.relationshipId);
        const events = visibleAs(
          await history(tx.sql, party.relationshipId),
          party.side,
        );
        const projection = projectDealStage(events);
        if (
          projection.end !== null ||
          projection.reached.SOFT_COMMIT === null ||
          projection.reached.SIGNED !== null
        ) {
          return refused("NOT_IN_STAGE");
        }
        if (
          terms.termsDocumentId !== undefined &&
          !sharedDocumentIds(events).includes(terms.termsDocumentId)
        ) {
          return refused("DOCUMENT_NOT_SHARED");
        }
        const previous = await tx.sql<{ id: string; version: number }[]>`
          select id, version from network.deal_terms
           where relationship_id = ${party.relationshipId}
           order by version desc limit 1`;
        const version = (previous[0]?.version ?? 0) + 1;
        await tx.sql`
          update network.deal_terms set status = 'SUPERSEDED'
           where relationship_id = ${party.relationshipId} and status = 'RECORDED'`;
        const made = await tx.sql<{ id: string }[]>`
          insert into network.deal_terms
            (tenant_id, relationship_id, version, instrument, amount, currency_code,
             valuation_cap, valuation_basis, pre_money_valuation, discount_percent,
             pro_rata, other_terms, terms_document_id, recorded_by_side,
             recorded_by_user_id, idempotency_key)
          values (${party.tenantId}, ${party.relationshipId}, ${version}, ${terms.instrument},
                  ${terms.amount}::numeric, ${terms.currencyCode},
                  ${terms.valuationCap ?? null}::numeric, ${terms.valuationBasis ?? null},
                  ${terms.preMoneyValuation ?? null}::numeric, ${terms.discountPercent ?? null}::numeric,
                  ${terms.proRata ?? null}, ${terms.otherTerms ?? null},
                  ${terms.termsDocumentId ?? null}, ${party.side},
                  ${command.actor.userId}, ${command.idempotencyKey})
          returning id`;
        const termsId = made[0]?.id;
        if (termsId === undefined)
          throw new Error("deal terms insert returned no row");
        await appender.append(tx, {
          relationshipId: party.relationshipId,
          eventType: RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED,
          actor: { type: "HUMAN", id: command.actor.userId },
          source: { type: "MANUAL", id: termsId },
          visibilityScope: "relationship_shared",
          payload: { termsId, version, side: party.side },
          correlationId,
        });
        await recordAudit(tx, command.actor, party, {
          actionType: ACTION_TERMS,
          resourceType: RESOURCE_TERMS,
          resourceId: termsId,
          metadata: {
            version,
            instrument: terms.instrument,
            currencyCode: terms.currencyCode,
          },
          correlationId,
        });
        await announce(
          tx,
          command.actor,
          party,
          "TERMS_RECORDED",
          correlationId,
        );
        return ok(party.relationshipId, false);
      });
    },

    /** The current terms recorded as signed, against the signed copy. */
    markSigned: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly termsId: string;
      readonly signedDocumentId: string;
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DealResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      return transactions.run(async (tx) => {
        await lock(tx, party.relationshipId);
        const current = await tx.sql<
          { id: string; status: string; signed_document_id: string | null }[]
        >`
          select id, status, signed_document_id from network.deal_terms
           where relationship_id = ${party.relationshipId} and status in ('RECORDED', 'SIGNED')`;
        const row = current[0];
        if (row === undefined) return refused("NOT_IN_STAGE");
        // Approval binds to the exact terms version: a revision since the
        // card was prepared means the person approved something else.
        if (row.id !== command.termsId) return refused("TERMS_CHANGED");
        if (row.status === "SIGNED") {
          return row.signed_document_id === command.signedDocumentId
            ? ok(party.relationshipId, true)
            : refused("NOT_IN_STAGE");
        }
        const events = visibleAs(
          await history(tx.sql, party.relationshipId),
          party.side,
        );
        if (projectDealStage(events).end !== null)
          return refused("NOT_IN_STAGE");
        if (!sharedDocumentIds(events).includes(command.signedDocumentId)) {
          return refused("DOCUMENT_NOT_SHARED");
        }
        await tx.sql`
          update network.deal_terms
             set status = 'SIGNED', signed_document_id = ${command.signedDocumentId},
                 signed_by_user_id = ${command.actor.userId}, signed_at = clock_timestamp()
           where id = ${row.id}`;
        await appender.append(tx, {
          relationshipId: party.relationshipId,
          eventType: RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED,
          actor: { type: "HUMAN", id: command.actor.userId },
          source: { type: "MANUAL", id: row.id },
          visibilityScope: "relationship_shared",
          payload: {
            termsId: row.id,
            signedDocumentId: command.signedDocumentId,
            side: party.side,
          },
          correlationId,
        });
        await recordAudit(tx, command.actor, party, {
          actionType: ACTION_SIGNED,
          resourceType: RESOURCE_TERMS,
          resourceId: row.id,
          metadata: {
            signedDocumentId: command.signedDocumentId,
            idempotencyKey: command.idempotencyKey,
          },
          correlationId,
        });
        await announce(tx, command.actor, party, "TERMS_SIGNED", correlationId);
        return ok(party.relationshipId, false);
      });
    },

    /** The clean end: signed terms and received money, closed once. */
    close: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly note?: string | undefined;
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DealResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const result = await transactions.run(async (tx): Promise<DealResult> => {
        await lock(tx, party.relationshipId);
        const existing = await tx.sql<{ id: string }[]>`
          select id from network.deal_closes where relationship_id = ${party.relationshipId}`;
        if (existing[0] !== undefined) return ok(party.relationshipId, true);
        const events = visibleAs(
          await history(tx.sql, party.relationshipId),
          party.side,
        );
        const projection = projectDealStage(events);
        if (
          projection.end !== null ||
          projection.reached.SIGNED === null ||
          projection.reached.FUNDS_RECEIVED === null ||
          projection.termsId === null ||
          projection.commitmentId === null
        ) {
          return refused("NOT_IN_STAGE");
        }
        const made = await tx.sql<{ id: string }[]>`
          insert into network.deal_closes
            (tenant_id, relationship_id, terms_id, commitment_id, closed_by_side,
             closed_by_user_id, closed_on, note, idempotency_key)
          values (${party.tenantId}, ${party.relationshipId}, ${projection.termsId},
                  ${projection.commitmentId}, ${party.side}, ${command.actor.userId},
                  ${today()}::date, ${command.note ?? null}, ${command.idempotencyKey})
          returning id`;
        const closeId = made[0]?.id;
        if (closeId === undefined)
          throw new Error("deal close insert returned no row");
        await appender.append(tx, {
          relationshipId: party.relationshipId,
          eventType: RELATIONSHIP_EVENT_DEAL_CLOSED,
          actor: { type: "HUMAN", id: command.actor.userId },
          source: { type: "MANUAL", id: closeId },
          visibilityScope: "relationship_shared",
          payload: {
            closeId,
            termsId: projection.termsId,
            commitmentId: projection.commitmentId,
            side: party.side,
          },
          correlationId,
        });
        await recordAudit(tx, command.actor, party, {
          actionType: ACTION_CLOSED,
          resourceType: RESOURCE_CLOSE,
          resourceId: closeId,
          metadata: {
            termsId: projection.termsId,
            commitmentId: projection.commitmentId,
          },
          correlationId,
        });
        await announce(tx, command.actor, party, "CLOSED", correlationId);
        return ok(party.relationshipId, false);
      });
      return result;
    },

    /** A post-close checklist tick for this side. Once; a repeat is a no-op. */
    tick: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly item: string;
    }): Promise<DealResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      if (
        !CLOSE_CHECKLIST[party.side].some((item) => item.code === command.item)
      ) {
        return refused("UNKNOWN_ITEM");
      }
      const events = visibleAs(
        await history(sql, party.relationshipId),
        party.side,
      );
      if (projectDealStage(events).end?.kind !== "CLOSED")
        return refused("NOT_IN_STAGE");
      const made = await sql<{ item_code: string }[]>`
        insert into network.deal_close_checklist
          (relationship_id, tenant_id, side, item_code, done_by_user_id)
        values (${party.relationshipId}, ${party.tenantId}, ${party.side},
                ${command.item}, ${command.actor.userId})
        on conflict do nothing
        returning item_code`;
      return ok(party.relationshipId, made.length === 0);
    },

    /**
     * Compile a report from the record now and store it as the next
     * version. The same person's key replays the same report.
     */
    generateReport: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly kind: RelationshipReportKind;
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<ReportResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      const policy = REPORT_POLICY[command.kind];
      if (!policy.sides.includes(party.side)) return refused("NOT_ALLOWED");
      const replay = await sql<{ id: string }[]>`
        select id from network.relationship_reports
         where generated_by_user_id = ${command.actor.userId}
           and idempotency_key = ${command.idempotencyKey}`;
      if (replay[0] !== undefined) {
        const listed = (await reportsFor(party)).find(
          (report) => report.reportId === replay[0]?.id,
        );
        if (listed !== undefined)
          return { outcome: "OK", report: listed, deduplicated: true };
      }
      const all = await history(sql, party.relationshipId);
      const ownView = visibleAs(all, party.side);
      const projection = projectDealStage(ownView);
      if (command.kind === "CLOSING" && projection.end?.kind !== "CLOSED")
        return refused("NOT_IN_STAGE");
      if (command.kind === "PASS" && projection.end?.kind !== "PASSED")
        return refused("NOT_IN_STAGE");
      // Context Firewall: a shared report reads only what both sides may.
      const audience =
        policy.visibility === "relationship_shared" ? sharedOnly(all) : ownView;
      const facts = await factsFor(
        command.actor,
        party,
        audience,
        projectDealStage(audience),
        policy.visibility,
      );
      const content = compileReport(command.kind, facts);
      const digest = reportDigest(content);
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const tenantId =
        policy.visibility === "investor_private"
          ? command.actor.tenantId
          : party.tenantId;
      const throughSequence = all.reduce(
        (max, event) => Math.max(max, event.sequence),
        0,
      );
      const reportId = await transactions.run(async (tx) => {
        await lock(tx, party.relationshipId);
        const last = await tx.sql<{ version: number }[]>`
          select version from network.relationship_reports
           where relationship_id = ${party.relationshipId} and kind = ${command.kind}
             and owner_side = ${party.side}
           order by version desc limit 1`;
        const made = await tx.sql<{ id: string }[]>`
          insert into network.relationship_reports
            (tenant_id, relationship_id, kind, owner_side, visibility_scope, version,
             title, content, content_sha256, through_sequence, compiler_version,
             generated_by_user_id, idempotency_key)
          values (${tenantId}, ${party.relationshipId}, ${command.kind}, ${party.side},
                  ${policy.visibility}, ${(last[0]?.version ?? 0) + 1}, ${content.title.slice(0, 160)},
                  ${JSON.stringify(content)}::text::jsonb, ${digest}, ${throughSequence},
                  ${DEAL_REPORT_COMPILER}, ${command.actor.userId}, ${command.idempotencyKey})
          returning id`;
        const id = made[0]?.id;
        if (id === undefined) throw new Error("report insert returned no row");
        await recordAudit(tx, command.actor, party, {
          actionType: ACTION_REPORT,
          resourceType: RESOURCE_REPORT,
          resourceId: id,
          metadata: {
            kind: command.kind,
            visibility: policy.visibility,
            contentSha256: digest,
          },
          correlationId,
        });
        return id;
      });
      const listed = (await reportsFor(party)).find(
        (report) => report.reportId === reportId,
      );
      if (listed === undefined) return refused("NOT_FOUND");
      return { outcome: "OK", report: listed, deduplicated: false };
    },

    /** One report with its content, when this side may read it. */
    report: async (query: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly reportId: string;
    }): Promise<RelationshipReportDto | null> => {
      const party = await partyOf(query.actor, query.relationshipId);
      if (party === null) return null;
      const summary = (await reportsFor(party)).find(
        (report) => report.reportId === query.reportId,
      );
      if (summary === undefined) return null;
      const rows = await sql<{ content: RelationshipReportContent }[]>`
        select content from network.relationship_reports where id = ${summary.reportId}`;
      const content = rows[0]?.content;
      return content === undefined ? null : { ...summary, content };
    },

    /**
     * The relationship's audit trail as this side may read it: the history
     * rows it can see, and its own organisation's material-action records
     * for this relationship. Never the other side's private records.
     */
    auditTrail: async (query: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
    }): Promise<
      | readonly {
          readonly at: string;
          readonly kind: "HISTORY" | "AUDIT";
          readonly what: string;
          readonly who: string | null;
          readonly reference: string;
        }[]
      | null
    > => {
      const party = await partyOf(query.actor, query.relationshipId);
      if (party === null) return null;
      const events = visibleAs(
        await history(sql, party.relationshipId),
        party.side,
      );
      const own = await sql<
        {
          occurred_at: Date;
          action_type: string;
          resource_type: string;
          resource_id: string;
          who: string | null;
          outcome: string;
        }[]
      >`
        select a.occurred_at, a.action_type, a.resource_type, a.resource_id,
               coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(concat_ws(' ', u.given_name, u.family_name)), '')) as who, a.outcome
          from audit.material_actions a
          left join identity.user_profiles u on u.id = a.authority_user_id
         where a.relationship_id = ${party.relationshipId}
           and a.organisation_id = ${query.actor.organisationId ?? null}
         order by a.occurred_at, a.id`;
      const rows = [
        ...events.map((event) => ({
          at: event.occurredAt,
          kind: "HISTORY" as const,
          what: event.eventType,
          who: event.actor,
          reference: `#${String(event.sequence)}`,
        })),
        ...own.map((row) => ({
          at: row.occurred_at.toISOString(),
          kind: "AUDIT" as const,
          what: `${row.action_type} (${row.outcome.toLowerCase()})`,
          who: row.who,
          reference: `${row.resource_type}:${row.resource_id}`,
        })),
      ];
      return rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    },
  };

  async function factsFor(
    actor: ActorContext,
    party: Party,
    audience: readonly (ProjectableEvent & { actor: string | null })[],
    projection: DealStageProjection,
    visibility: "investor_private" | "founder_private" | "relationship_shared",
  ): Promise<ReportFacts> {
    const names = await namesOf(party);
    const requests = await sql<
      {
        title: string;
        created_at: Date;
        asked_by: string | null;
        fulfilled_at: Date | null;
        declined_at: Date | null;
      }[]
    >`
      select q.title, q.created_at, coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(concat_ws(' ', u.given_name, u.family_name)), '')) as asked_by,
             f.created_at as fulfilled_at, d.created_at as declined_at
        from network.diligence_requests q
        left join network.diligence_fulfilments f on f.request_id = q.id
        left join network.diligence_request_declines d on d.request_id = q.id
        left join identity.user_profiles u on u.id = q.requested_by_user_id
       where q.relationship_id = ${party.relationshipId}
       order by q.created_at`;
    const questions = await sql<
      {
        question: string;
        created_at: Date;
        asked_by: string | null;
        answer: string | null;
        answered_at: Date | null;
        evidence_status: string | null;
      }[]
    >`
      select q.question, q.created_at, coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(concat_ws(' ', u.given_name, u.family_name)), '')) as asked_by,
             a.answer, a.created_at as answered_at, a.evidence_status
        from network.diligence_questions q
        left join lateral (
          select answer, created_at, evidence_status from network.diligence_question_answers
           where question_id = q.id order by created_at desc limit 1) a on true
        left join identity.user_profiles u on u.id = q.asked_by_user_id
       where q.relationship_id = ${party.relationshipId}
       order by q.created_at, q.position`;
    const commitment = await currentCommitment(sql, party.relationshipId);
    const terms = await termsOf(sql, party.relationshipId);
    const closes = await sql<
      { closed_on: string; closed_by: string | null; note: string | null }[]
    >`
      select d.closed_on::text as closed_on, coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(concat_ws(' ', u.given_name, u.family_name)), '')) as closed_by, d.note
        from network.deal_closes d
        left join identity.user_profiles u on u.id = d.closed_by_user_id
       where d.relationship_id = ${party.relationshipId}`;
    const meetings =
      dependencies.meetings === undefined
        ? []
        : await dependencies
            .meetings(actor, party.relationshipId)
            .catch(() => []);
    const heldFromHistory = audience
      .filter((event) => event.eventType === "meeting_held")
      .map((event) => ({
        heldAt: event.occurredAt,
        title: null,
        summary: null,
      }));
    // The pass's private reason only ever reaches the investor's own report.
    const pass =
      visibility === "investor_private" && dependencies.outcomes !== undefined
        ? await dependencies.outcomes.latestPass({
            actor,
            relationshipId: party.relationshipId,
          })
        : null;
    const close = closes[0];
    return {
      companyName: names.company,
      investorName: names.investor,
      relationshipState: party.state,
      generatedAt: now().toISOString(),
      projection,
      history: audience.map((event) => ({
        sequence: event.sequence,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        actor: event.actor,
      })),
      meetings: meetings.length > 0 ? meetings : heldFromHistory,
      diligence: {
        requests: requests.map((row) => ({
          title: row.title,
          askedAt: row.created_at.toISOString(),
          askedBy: row.asked_by,
          fulfilledAt: row.fulfilled_at?.toISOString() ?? null,
          declinedAt: row.declined_at?.toISOString() ?? null,
        })),
        questions: questions.map((row) => ({
          question: row.question,
          askedAt: row.created_at.toISOString(),
          askedBy: row.asked_by,
          answer: row.answer,
          answeredAt: row.answered_at?.toISOString() ?? null,
          evidenceStatus: row.evidence_status,
        })),
      },
      commitment:
        commitment === null
          ? null
          : {
              amount: commitment.amount,
              currencyCode: commitment.currency_code,
              level: commitment.level,
              status: commitment.status,
              statedBy: commitment.stated_by,
              statedAt: commitment.created_at.toISOString(),
              confirmedBy: commitment.confirmed_by,
              confirmedAt: commitment.confirmed_at?.toISOString() ?? null,
              receivedBy: commitment.received_by,
              receivedAt: commitment.received_at?.toISOString() ?? null,
              roundName: null,
            },
      terms: terms.map((row) => ({
        version: row.version,
        status: row.status,
        instrument: row.instrument,
        amount: row.amount,
        currencyCode: row.currency_code,
        valuationCap: row.valuation_cap,
        valuationBasis: row.valuation_basis,
        preMoneyValuation: row.pre_money_valuation,
        discountPercent: row.discount_percent,
        proRata: row.pro_rata,
        otherTerms: row.other_terms,
        recordedBy: row.recorded_by,
        recordedAt: row.created_at.toISOString(),
        signedBy: row.signed_by,
        signedAt: row.signed_at?.toISOString() ?? null,
        signedDocumentId: row.signed_document_id,
        termsDocumentId: row.terms_document_id,
      })),
      close:
        close === undefined
          ? null
          : {
              closedOn: close.closed_on,
              closedBy: close.closed_by,
              note: close.note,
            },
      pass:
        pass === null
          ? null
          : {
              passedAt: pass.passedAt,
              reasonLabel: pass.reasonLabel,
              note: pass.note,
              sharedWithFounder: pass.sharedWithFounder,
            },
    };
  }
}

export type DealCloseService = ReturnType<typeof createDealCloseService>;
