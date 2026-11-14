import { z } from "zod";

import { createUuidIdSchema } from "@capital-q/contracts";

import {
  ApplicationDimensionSchema,
  ApplicationIdSchema,
  FactProvenanceSchema,
} from "./index.js";

/**
 * GateQ atomic statements (design 2026-11-14, slice 1).
 *
 *   a statement is what was said, once, with its exact words
 *   a link says how a newer statement relates to an older one
 *   the view is a deterministic projection over both, never stored text
 *
 * These mirror `gateq.application_statements`, `_statement_links`,
 * `_disagreement_events` and `_turn_readings` (migration 20261231540000).
 * The table stores `value_kind` beside a kind-less `value`; the contract
 * carries one discriminated `value` and the repository maps between them.
 * Nothing reads or writes these yet: this slice changes no runtime path.
 */

export const STATEMENTS_CONTRACT_VERSION = "gateq-statements.v1" as const;
export const DIMENSION_VIEW_VERSION = "gateq-dimension-view.v1" as const;

export const ApplicationStatementIdSchema = createUuidIdSchema(
  "GateQApplicationStatementId",
);
export type ApplicationStatementId = z.infer<
  typeof ApplicationStatementIdSchema
>;
export const StatementLinkIdSchema = createUuidIdSchema("GateQStatementLinkId");
export type StatementLinkId = z.infer<typeof StatementLinkIdSchema>;
export const DisagreementEventIdSchema = createUuidIdSchema(
  "GateQDisagreementEventId",
);
export type DisagreementEventId = z.infer<typeof DisagreementEventIdSchema>;
export const TurnReadingIdSchema = createUuidIdSchema("GateQTurnReadingId");
export type TurnReadingId = z.infer<typeof TurnReadingIdSchema>;
/** An `application_turns.id`. A server identifier, never a model handle. */
export const ApplicationTurnIdSchema = createUuidIdSchema(
  "GateQApplicationTurnId",
);
export type ApplicationTurnId = z.infer<typeof ApplicationTurnIdSchema>;

const InstantSchema = z.string().datetime({ offset: true });
const DateSchema = z.string().date();

/**
 * The closed metric keys a numeric statement may be about. Two numbers are
 * only ever compared when they name the same quantity, which is what keeps
 * "2,300 wallets" from contradicting "20% monthly growth" (live D10).
 */
export const STATEMENT_QUANTITIES = [
  "revenue",
  "mrr",
  "arr",
  "gmv",
  "paying_customers",
  "customers",
  "users",
  "daily_active_users",
  "weekly_active_users",
  "monthly_active_users",
  "wallets",
  "transactions",
  "pilots",
  "employees",
  "growth_rate_monthly",
  "churn_rate_monthly",
  "retention_rate",
  "gross_margin",
  "burn_monthly",
  "runway_months",
  "raise_amount",
  "pre_money_valuation",
] as const;
export const StatementQuantitySchema = z.enum(STATEMENT_QUANTITIES);
export type StatementQuantity = z.infer<typeof StatementQuantitySchema>;

const DecimalSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/, "expected a decimal");
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

/**
 * One bounded value. ZERO is a value ("nobody pays yet"), never an unknown;
 * UNKNOWN carries nothing, and `declined` tells "I'd rather not say" apart
 * from "I don't know".
 */
export const StatementValueSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("TEXT"), text: z.string().min(1).max(2000) })
    .strict(),
  z
    .object({
      kind: z.literal("CODE"),
      code: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("MONEY"),
      amount: DecimalSchema.refine(
        (amount) => !/^0(\.0{1,2})?$/.test(amount),
        "a stated zero is the ZERO kind",
      ),
      /** Null when the founder gave no currency: unknown, never defaulted. */
      currency: CurrencySchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("COUNT"),
      count: z.string().regex(/^[1-9][0-9]{0,15}$/, "a positive integer"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("PERCENT"),
      percent: z.string().regex(/^-?(0|[1-9][0-9]{0,5})(\.[0-9]{1,4})?$/),
    })
    .strict(),
  z
    .object({ kind: z.literal("ZERO"), currency: CurrencySchema.optional() })
    .strict(),
  z
    .object({
      kind: z.literal("UNKNOWN"),
      declined: z.literal(true).optional(),
    })
    .strict(),
]);
export type StatementValue = z.infer<typeof StatementValueSchema>;
export type StatementValueKind = StatementValue["kind"];

export const STATEMENT_ORIGINS = [
  "TURN",
  "FORM",
  "DOCUMENT_CONFIRMED",
  "BACKFILL",
] as const;
export const StatementOriginSchema = z.enum(STATEMENT_ORIGINS);
export type StatementOrigin = z.infer<typeof StatementOriginSchema>;

const NUMERIC_KINDS: ReadonlySet<StatementValueKind> = new Set([
  "MONEY",
  "COUNT",
  "PERCENT",
  "ZERO",
  "UNKNOWN",
]);

export const ApplicationStatementSchema = z
  .object({
    id: ApplicationStatementIdSchema,
    applicationId: ApplicationIdSchema,
    dimension: ApplicationDimensionSchema,
    quantity: StatementQuantitySchema.nullable(),
    value: StatementValueSchema,
    /** The date the figure describes; null when not given. Never "today". */
    asOf: DateSchema.nullable(),
    /** The founder's exact words. */
    words: z.string().min(1).max(2000),
    provenance: FactProvenanceSchema,
    origin: StatementOriginSchema,
    sourceTurnId: ApplicationTurnIdSchema.nullable(),
    backfillKey: z
      .string()
      .regex(/^[A-Za-z0-9:._-]{1,200}$/)
      .nullable(),
    statedAt: InstantSchema,
    recordedAt: InstantSchema,
  })
  .strict()
  .superRefine((statement, context) => {
    // The same rules as the table's checks, so a bad row is refused before
    // it reaches the database and a row read back is known to hold them.
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    if (
      (statement.value.kind === "UNKNOWN") !==
      (statement.provenance === "UNKNOWN")
    )
      issue("provenance", "UNKNOWN provenance goes with an UNKNOWN value only");
    if (statement.quantity !== null && !NUMERIC_KINDS.has(statement.value.kind))
      issue("quantity", "a quantity is a number, a zero or an unknown");
    if (statement.origin === "TURN" && statement.sourceTurnId === null)
      issue("sourceTurnId", "a statement read from a turn names its turn");
    if (statement.origin === "FORM" && statement.sourceTurnId !== null)
      issue("sourceTurnId", "a form statement names no turn");
    if ((statement.origin === "BACKFILL") !== (statement.backfillKey !== null))
      issue("backfillKey", "only a backfilled statement has a backfill key");
  });
export type ApplicationStatement = z.infer<typeof ApplicationStatementSchema>;

export const STATEMENT_LINK_KINDS = ["CORRECTS", "DISAGREES"] as const;
export const StatementLinkKindSchema = z.enum(STATEMENT_LINK_KINDS);
export type StatementLinkKind = z.infer<typeof StatementLinkKindSchema>;

export const STATEMENT_LINK_ORIGINS = [
  "MODEL_READING",
  "CODE_DETECTED",
  "BACKFILL",
] as const;
export const StatementLinkOriginSchema = z.enum(STATEMENT_LINK_ORIGINS);
export type StatementLinkOrigin = z.infer<typeof StatementLinkOriginSchema>;

/** `from` is always the newer statement and `to` the older one. */
export const StatementLinkSchema = z
  .object({
    id: StatementLinkIdSchema,
    applicationId: ApplicationIdSchema,
    kind: StatementLinkKindSchema,
    fromStatementId: ApplicationStatementIdSchema,
    toStatementId: ApplicationStatementIdSchema,
    origin: StatementLinkOriginSchema,
    sourceTurnId: ApplicationTurnIdSchema.nullable(),
    createdAt: InstantSchema,
  })
  .strict()
  .superRefine((link, context) => {
    if (link.fromStatementId === link.toStatementId)
      context.addIssue({
        code: "custom",
        path: ["toStatementId"],
        message: "a statement never links to itself",
      });
    if (link.origin === "MODEL_READING" && link.sourceTurnId === null)
      context.addIssue({
        code: "custom",
        path: ["sourceTurnId"],
        message: "a model reading names its turn",
      });
  });
export type StatementLink = z.infer<typeof StatementLinkSchema>;

/** What is stored. OPEN is never stored: it is the state with no event. */
export const DISAGREEMENT_EVENT_STATES = [
  "LEFT_OPEN",
  "REOPENED",
  "RESOLVED",
] as const;
export const DisagreementEventStateSchema = z.enum(DISAGREEMENT_EVENT_STATES);
export type DisagreementEventState = z.infer<
  typeof DisagreementEventStateSchema
>;

export const DisagreementEventSchema = z
  .object({
    id: DisagreementEventIdSchema,
    applicationId: ApplicationIdSchema,
    linkId: StatementLinkIdSchema,
    state: DisagreementEventStateSchema,
    resolvedByStatementId: ApplicationStatementIdSchema.nullable(),
    sourceTurnId: ApplicationTurnIdSchema.nullable(),
    recordedAt: InstantSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if ((event.state === "RESOLVED") !== (event.resolvedByStatementId !== null))
      context.addIssue({
        code: "custom",
        path: ["resolvedByStatementId"],
        message: "only a resolution names the statement that resolved it",
      });
  });
export type DisagreementEvent = z.infer<typeof DisagreementEventSchema>;

export const TURN_READING_OUTCOMES = [
  "READ",
  "NO_STATEMENTS",
  "REJECTED",
] as const;
export const TurnReadingOutcomeSchema = z.enum(TURN_READING_OUTCOMES);
export type TurnReadingOutcome = z.infer<typeof TurnReadingOutcomeSchema>;

export const STATEMENT_NOT_RECORDED_REASONS = [
  /** A worked-out figure said back for a yes before it is recorded. */
  "AMOUNT_READ_BACK",
  /** The reading named an S<n> or D<n> handle the server did not issue. */
  "UNKNOWN_HANDLE",
  /** The value did not fit its dimension's bounded shape. */
  "INVALID_VALUE",
  /** Not about any application dimension. */
  "OUT_OF_SCOPE",
] as const;
export const StatementNotRecordedReasonSchema = z.enum(
  STATEMENT_NOT_RECORDED_REASONS,
);

export const StatementNotRecordedSchema = z
  .object({
    dimension: ApplicationDimensionSchema.nullable(),
    words: z.string().min(1).max(600),
    reason: StatementNotRecordedReasonSchema,
  })
  .strict();
export type StatementNotRecorded = z.infer<typeof StatementNotRecordedSchema>;

/**
 * The authoritative result of reading one PERSON turn. Q may say "noted"
 * only for `recordedStatementIds`; a PERSON turn with no reading is unread.
 */
export const TurnReadingSchema = z
  .object({
    id: TurnReadingIdSchema,
    applicationId: ApplicationIdSchema,
    turnId: ApplicationTurnIdSchema,
    outcome: TurnReadingOutcomeSchema,
    recordedStatementIds: z.array(ApplicationStatementIdSchema).max(64),
    notRecorded: z.array(StatementNotRecordedSchema).max(32),
    readingVersion: z.number().int().min(1).max(99),
    recordedAt: InstantSchema,
  })
  .strict()
  .superRefine((reading, context) => {
    if (
      (reading.outcome === "READ") !==
      reading.recordedStatementIds.length > 0
    )
      context.addIssue({
        code: "custom",
        path: ["recordedStatementIds"],
        message: "READ records at least one statement; the others record none",
      });
  });
export type TurnReading = z.infer<typeof TurnReadingSchema>;

// ---------------------------------------------------------------------------
// The projected view (statement-view.ts)
// ---------------------------------------------------------------------------

/** Where a view item came from, as the reader labels it. */
export const VIEW_SOURCE_KINDS = [
  "APPLICATION_STATEMENT",
  "FORM",
  "DOCUMENT",
] as const;
export const ViewSourceKindSchema = z.enum(VIEW_SOURCE_KINDS);
export type ViewSourceKind = z.infer<typeof ViewSourceKindSchema>;

export const DISAGREEMENT_STATES = ["OPEN", "LEFT_OPEN", "RESOLVED"] as const;
export const DisagreementStateSchema = z.enum(DISAGREEMENT_STATES);
export type DisagreementState = z.infer<typeof DisagreementStateSchema>;

export const DIMENSION_STATUSES = [
  "SETTLED",
  "ZERO",
  "UNKNOWN",
  "DECLINED",
  "DISAGREEMENT_OPEN",
  "DISAGREEMENT_LEFT_OPEN",
  "UNANSWERED",
] as const;
export const DimensionStatusSchema = z.enum(DIMENSION_STATUSES);
export type DimensionStatus = z.infer<typeof DimensionStatusSchema>;

export const DimensionViewItemSchema = z
  .object({
    statementId: ApplicationStatementIdSchema,
    sourceKind: ViewSourceKindSchema,
    origin: StatementOriginSchema,
    /** True for a statement recovered from a legacy fact, said honestly. */
    backfilled: z.boolean(),
    quantity: StatementQuantitySchema.nullable(),
    value: StatementValueSchema,
    asOf: DateSchema.nullable(),
    words: z.string().min(1).max(2000),
    provenance: FactProvenanceSchema,
    sourceTurnId: ApplicationTurnIdSchema.nullable(),
    statedAt: InstantSchema,
  })
  .strict();
export type DimensionViewItem = z.infer<typeof DimensionViewItemSchema>;

export const SupersededItemSchema = z
  .object({
    item: DimensionViewItemSchema,
    /** The statement that corrected or resolved it away. */
    supersededBy: ApplicationStatementIdSchema,
    via: z.enum(["CORRECTION", "RESOLUTION"]),
  })
  .strict();
export type SupersededItem = z.infer<typeof SupersededItemSchema>;

export const DimensionDisagreementSchema = z
  .object({
    /**
     * Stable key: the link id, or `code:<older>:<newer>` for a disagreement
     * the projector detected that has no stored link yet.
     */
    key: z.string().min(1).max(120),
    linkId: StatementLinkIdSchema.nullable(),
    origin: StatementLinkOriginSchema,
    olderStatementId: ApplicationStatementIdSchema,
    newerStatementId: ApplicationStatementIdSchema,
    state: DisagreementStateSchema,
    resolvedByStatementId: ApplicationStatementIdSchema.nullable(),
    /**
     * False once it is resolved, or either side was corrected or resolved
     * away by another statement: the pair no longer stands,
     * so it no longer decides the dimension's status. Kept for history.
     */
    active: z.boolean(),
  })
  .strict();
export type DimensionDisagreement = z.infer<typeof DimensionDisagreementSchema>;

export const DimensionViewSchema = z
  .object({
    version: z.literal(DIMENSION_VIEW_VERSION),
    dimension: ApplicationDimensionSchema,
    status: DimensionStatusSchema,
    /** Every current statement, oldest first; UNKNOWNs included. */
    items: z.array(DimensionViewItemSchema),
    superseded: z.array(SupersededItemSchema),
    disagreements: z.array(DimensionDisagreementSchema),
  })
  .strict();
export type DimensionView = z.infer<typeof DimensionViewSchema>;

export const ApplicationStatementViewSchema = z
  .object({
    version: z.literal(DIMENSION_VIEW_VERSION),
    /** One per application dimension, in vocabulary order. */
    dimensions: z.array(DimensionViewSchema),
  })
  .strict();
export type ApplicationStatementView = z.infer<
  typeof ApplicationStatementViewSchema
>;
