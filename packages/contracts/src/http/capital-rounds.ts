import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema } from "../common/money.js";
import { LocalDateSchema, UtcTimestampSchema } from "../common/time.js";
import {
  CapitalTargetSchema,
  PositiveDecimalStringSchema,
} from "./capital-objectives.js";
import { CommitmentLevelSchema } from "./commitments.js";
import { COMPANIES_PATH } from "./companies.js";

/**
 * Capital rounds and the commitment book (founder direction 2026-10-04).
 *
 * A round is one financing instrument's book of money: a name, a target
 * (exact decimal string plus ISO currency), an instrument, dates and a
 * status; at most one is current. What it has raised is derived from
 * RECEIVED commitments, never typed. Commitments move DETECTED (Q heard
 * it) -> STATED (one side confirmed the amount) -> CONFIRMED (both) ->
 * TRANSFER_SENT (investor) -> RECEIVED (company).
 */

export const CAPITAL_ROUND_INSTRUMENTS = [
  "SAFE",
  "EQUITY",
  "CONVERTIBLE",
  /** UK Advance Subscription Agreement (SEIS/EIS friendly). */
  "ASA",
  "OTHER",
] as const;
export const CapitalRoundInstrumentSchema = z.enum(CAPITAL_ROUND_INSTRUMENTS);
export type CapitalRoundInstrument = z.infer<
  typeof CapitalRoundInstrumentSchema
>;

/**
 * PLANNED -> OPEN -> FIRST_CLOSED (money has closed, still raising) ->
 * CLOSED (final close); CANCELLED from PLANNED or OPEN. A closed round can
 * be reopened (an extension or a second close); a cancelled one too.
 */
export const CAPITAL_ROUND_STATUSES = [
  "PLANNED",
  "OPEN",
  "FIRST_CLOSED",
  "CLOSED",
  "CANCELLED",
] as const;
export const CapitalRoundStatusSchema = z.enum(CAPITAL_ROUND_STATUSES);
export type CapitalRoundStatus = z.infer<typeof CapitalRoundStatusSchema>;

export const CAPITAL_ROUNDS_SUFFIX = "/capital-rounds" as const;
export const CAPITAL_ROUND_CLOSE_SUFFIX = "/close" as const;
export const CAPITAL_ROUND_STEPS_SUFFIX = "/steps" as const;
export const CAPITAL_ROUND_HISTORY_SUFFIX = "/history" as const;
export const COMPANY_CAPITAL_ROUNDS_PATH =
  `${COMPANIES_PATH}/:companyId${CAPITAL_ROUNDS_SUFFIX}` as const;
export const COMPANY_CAPITAL_ROUND_CLOSE_PATH =
  `${COMPANY_CAPITAL_ROUNDS_PATH}/:roundId${CAPITAL_ROUND_CLOSE_SUFFIX}` as const;
export const COMPANY_CAPITAL_ROUND_PATH =
  `${COMPANY_CAPITAL_ROUNDS_PATH}/:roundId` as const;
export const COMPANY_CAPITAL_ROUND_STEPS_PATH =
  `${COMPANY_CAPITAL_ROUND_PATH}${CAPITAL_ROUND_STEPS_SUFFIX}` as const;
export const COMPANY_CAPITAL_ROUND_HISTORY_PATH =
  `${COMPANY_CAPITAL_ROUND_PATH}${CAPITAL_ROUND_HISTORY_SUFFIX}` as const;
export const COMPANY_CAPITAL_LEDGER_PATH =
  `${COMPANIES_PATH}/:companyId/capital-ledger` as const;
export const NETWORK_MY_COMMITMENTS_PATH =
  "/v1/network/commitments/mine" as const;
export const NETWORK_COMMITMENT_AMOUNT_CONFIRMATION_PATH =
  "/v1/network/commitments/:commitmentId/amount-confirmation" as const;
export const NETWORK_COMMITMENT_TRANSFER_PATH =
  "/v1/network/commitments/:commitmentId/transfer" as const;
export const NETWORK_COMMITMENT_RECEIPT_PATH =
  "/v1/network/commitments/:commitmentId/receipt" as const;

const fill = (path: string, values: Readonly<Record<string, string>>) =>
  Object.entries(values).reduce(
    (out, [key, value]) => out.replace(`:${key}`, encodeURIComponent(value)),
    path,
  );
export const companyCapitalRoundsPath = (companyId: string) =>
  fill(COMPANY_CAPITAL_ROUNDS_PATH, { companyId });
export const companyCapitalRoundClosePath = (
  companyId: string,
  roundId: string,
) => fill(COMPANY_CAPITAL_ROUND_CLOSE_PATH, { companyId, roundId });
export const companyCapitalRoundPath = (companyId: string, roundId: string) =>
  fill(COMPANY_CAPITAL_ROUND_PATH, { companyId, roundId });
export const companyCapitalRoundStepsPath = (
  companyId: string,
  roundId: string,
) => fill(COMPANY_CAPITAL_ROUND_STEPS_PATH, { companyId, roundId });
export const companyCapitalRoundHistoryPath = (
  companyId: string,
  roundId: string,
) => fill(COMPANY_CAPITAL_ROUND_HISTORY_PATH, { companyId, roundId });
export const companyCapitalLedgerPath = (companyId: string) =>
  fill(COMPANY_CAPITAL_LEDGER_PATH, { companyId });
export const networkCommitmentAmountConfirmationPath = (commitmentId: string) =>
  fill(NETWORK_COMMITMENT_AMOUNT_CONFIRMATION_PATH, { commitmentId });
export const networkCommitmentTransferPath = (commitmentId: string) =>
  fill(NETWORK_COMMITMENT_TRANSFER_PATH, { commitmentId });
export const networkCommitmentReceiptPath = (commitmentId: string) =>
  fill(NETWORK_COMMITMENT_RECEIPT_PATH, { commitmentId });

const RoundNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}]+$/u);

export const PRO_RATA_RIGHTS = ["NONE", "MAJOR_INVESTORS", "ALL"] as const;
export const ProRataRightsSchema = z.enum(PRO_RATA_RIGHTS);
export type ProRataRights = z.infer<typeof ProRataRightsSchema>;

export const VALUATION_BASES = ["PRE_MONEY", "POST_MONEY"] as const;
export const ValuationBasisSchema = z.enum(VALUATION_BASES);
export type ValuationBasis = z.infer<typeof ValuationBasisSchema>;

/** An amount in the round's own currency: exact, positive, under 10^15. */
const RoundAmountSchema = PositiveDecimalStringSchema.refine(
  (value) => (value.split(".")[0] ?? "").length <= 15,
  { message: "expected an amount under 10^15" },
);
/** A reported amount may be zero (a round that raised nothing). */
const ReportedAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/, "expected an exact amount");
/** A discount: above 0, below 100, at most two decimals. */
const DiscountPercentSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$/, "expected a percent such as 20")
  .refine((value) => /[1-9]/.test(value), {
    message: "expected a discount above zero",
  });

const roundText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]+$/u);

/** The lead: the canonical relationship, or a name for a lead not on Capital Q. */
export const CapitalRoundLeadSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("RELATIONSHIP"), relationshipId: UuidSchema })
    .strict(),
  z.object({ kind: z.literal("NAMED"), name: roundText(120) }).strict(),
]);
export type CapitalRoundLead = z.infer<typeof CapitalRoundLeadSchema>;

/**
 * A round's terms. Every amount is in the round's own currency (one currency
 * per round, so terms cannot mix currencies). null means "not said", never
 * zero: an unknown cap stays unknown.
 */
export const CapitalRoundTermsSchema = z
  .object({
    targetCloseOn: LocalDateSchema.nullable(),
    valuation: z
      .object({ amount: RoundAmountSchema, basis: ValuationBasisSchema })
      .strict()
      .nullable(),
    valuationCap: RoundAmountSchema.nullable(),
    discountPercent: DiscountPercentSchema.nullable(),
    hardCap: RoundAmountSchema.nullable(),
    proRataRights: ProRataRightsSchema.nullable(),
    lead: CapitalRoundLeadSchema.nullable(),
    /** A bridge or extension of this company's earlier round. */
    extendsRoundId: UuidSchema.nullable(),
    /** What it raised outside Capital Q, as the company says (USER_CLAIM). */
    reportedRaised: ReportedAmountSchema.nullable(),
  })
  .strict();
export type CapitalRoundTerms = z.infer<typeof CapitalRoundTermsSchema>;

export const CapitalRoundTermsInputSchema = CapitalRoundTermsSchema.partial();
export type CapitalRoundTermsInput = z.infer<
  typeof CapitalRoundTermsInputSchema
>;

export const OpenCapitalRoundRequestSchema = z
  .object({
    name: RoundNameSchema,
    target: CapitalTargetSchema,
    instrument: CapitalRoundInstrumentSchema,
    /**
     * PLANNED: not raising yet. OPEN (default): raising now; it becomes
     * current. CLOSED: a past round, recorded for the history, never current.
     */
    status: z.enum(["PLANNED", "OPEN", "CLOSED"]).optional(),
    /** Defaults to today for an open round. */
    openedOn: LocalDateSchema.optional(),
    /** A past round's final close; defaults to today. */
    closedOn: LocalDateSchema.optional(),
    terms: CapitalRoundTermsInputSchema.optional(),
  })
  .strict();
export type OpenCapitalRoundRequest = z.infer<
  typeof OpenCapitalRoundRequestSchema
>;

export const CloseCapitalRoundRequestSchema = z
  .object({ closedOn: LocalDateSchema.optional() })
  .strict();
export type CloseCapitalRoundRequest = z.infer<
  typeof CloseCapitalRoundRequestSchema
>;

/**
 * A correction or change to a round: only the fields given change; the
 * previous values are kept in the round's history. Carries the revision it
 * read, so two people editing at once never silently overwrite each other.
 */
export const ReviseCapitalRoundRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: RoundNameSchema.optional(),
    target: CapitalTargetSchema.optional(),
    instrument: CapitalRoundInstrumentSchema.optional(),
    openedOn: LocalDateSchema.optional(),
    terms: CapitalRoundTermsInputSchema.optional(),
    note: roundText(500).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.target !== undefined ||
      value.instrument !== undefined ||
      value.openedOn !== undefined ||
      (value.terms !== undefined && Object.keys(value.terms).length > 0),
    { message: "expected at least one change" },
  );
export type ReviseCapitalRoundRequest = z.infer<
  typeof ReviseCapitalRoundRequestSchema
>;

/**
 * One lifecycle step. OPEN: a planned round starts raising. CLOSE: a close
 * (the first moves OPEN to FIRST_CLOSED). TRANCHE: a tranche arrived.
 * FINAL_CLOSE: the round is done. REOPEN: a closed round reopens (an
 * extension or a second close) or a cancelled one restarts. CANCEL: it is
 * not happening.
 */
export const CAPITAL_ROUND_STEPS = [
  "OPEN",
  "CLOSE",
  "TRANCHE",
  "FINAL_CLOSE",
  "REOPEN",
  "CANCEL",
] as const;
export const CapitalRoundStepSchema = z.enum(CAPITAL_ROUND_STEPS);
export type CapitalRoundStep = z.infer<typeof CapitalRoundStepSchema>;

export const RecordCapitalRoundStepRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    step: CapitalRoundStepSchema,
    /** When it happened; defaults to today. */
    on: LocalDateSchema.optional(),
    /** CLOSE / TRANCHE / FINAL_CLOSE: the amount, in the round's currency. */
    amount: RoundAmountSchema.optional(),
    /** e.g. "Second close", "Tranche 2: 1,000 paying customers". */
    label: roundText(120).optional(),
    /** Why: a reopen or a cancel says why. */
    note: roundText(300).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.amount === undefined ||
      value.step === "CLOSE" ||
      value.step === "TRANCHE" ||
      value.step === "FINAL_CLOSE",
    { message: "only a close or a tranche carries an amount" },
  );
export type RecordCapitalRoundStepRequest = z.infer<
  typeof RecordCapitalRoundStepRequestSchema
>;

export const CapitalRoundCloseDtoSchema = z
  .object({
    kind: z.enum(["CLOSE", "TRANCHE", "FINAL_CLOSE"]),
    on: LocalDateSchema,
    amount: z.string().nullable(),
    label: z.string().nullable(),
  })
  .strict();
export type CapitalRoundCloseDto = z.infer<typeof CapitalRoundCloseDtoSchema>;

export const CapitalRoundDtoSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    target: z.object({ amount: z.string(), currency: CurrencyCodeSchema }),
    instrument: CapitalRoundInstrumentSchema,
    status: CapitalRoundStatusSchema,
    isCurrent: z.boolean(),
    openedOn: LocalDateSchema.nullable(),
    firstClosedOn: LocalDateSchema.nullable(),
    closedOn: LocalDateSchema.nullable(),
    cancelledOn: LocalDateSchema.nullable(),
    cancelledReason: z.string().nullable(),
    terms: CapitalRoundTermsSchema,
    /** Closes and tranches recorded, oldest first. */
    closes: z.array(CapitalRoundCloseDtoSchema).max(50),
    /** How many times it was corrected (TERMS_REVISED entries). */
    corrections: z.number().int().min(0),
    revision: z.number().int().min(1),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type CapitalRoundDto = z.infer<typeof CapitalRoundDtoSchema>;

export const CAPITAL_ROUND_EVENT_TYPES = [
  "CREATED",
  "TERMS_REVISED",
  "OPENED",
  "CLOSE_RECORDED",
  "TRANCHE_RECORDED",
  "FINAL_CLOSED",
  "REOPENED",
  "CANCELLED",
] as const;
export type CapitalRoundEventType = (typeof CAPITAL_ROUND_EVENT_TYPES)[number];

/** One entry of a round's history; `changes` names each field's before and after. */
export const CapitalRoundEventDtoSchema = z
  .object({
    revision: z.number().int().min(1),
    type: z.enum(CAPITAL_ROUND_EVENT_TYPES),
    on: LocalDateSchema,
    amount: z.string().nullable(),
    currencyCode: CurrencyCodeSchema.nullable(),
    label: z.string().nullable(),
    note: z.string().nullable(),
    changes: z
      .array(
        z
          .object({
            field: z.string(),
            from: z.string().nullable(),
            to: z.string().nullable(),
          })
          .strict(),
      )
      .max(20),
    byYou: z.boolean(),
    at: UtcTimestampSchema,
  })
  .strict();
export type CapitalRoundEventDto = z.infer<typeof CapitalRoundEventDtoSchema>;

export const CapitalRoundHistoryDtoSchema = z
  .object({ events: z.array(CapitalRoundEventDtoSchema).max(200) })
  .strict();
export type CapitalRoundHistoryDto = z.infer<
  typeof CapitalRoundHistoryDtoSchema
>;

/**
 * What the Capital page should say about a round (codes; the page words
 * them): oversubscribed, past the hard cap, another round open at the same
 * time, commitments in another currency (never converted), final-closed
 * with nothing received or reported, past its target close date.
 */
export const CAPITAL_ROUND_NOTICES = [
  "OVER_TARGET",
  "OVER_HARD_CAP",
  "OVERLAPS_OPEN_ROUND",
  "OTHER_CURRENCY",
  "CLOSED_EMPTY",
  "PAST_TARGET_CLOSE",
] as const;
export const CapitalRoundNoticeSchema = z.enum(CAPITAL_ROUND_NOTICES);
export type CapitalRoundNotice = z.infer<typeof CapitalRoundNoticeSchema>;

/**
 * An investor's view of a round they are in. The ownership estimate is
 * their amount over the post-money valuation (or the cap, for a SAFE or
 * ASA), in basis points: an ESTIMATE before later dilution and conversion
 * mechanics, never a cap-table fact. null: not enough is known.
 */
export const InvestorRoundViewDtoSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    instrument: CapitalRoundInstrumentSchema,
    status: CapitalRoundStatusSchema,
    valuation: z
      .object({ amount: z.string(), basis: ValuationBasisSchema })
      .strict()
      .nullable(),
    valuationCap: z.string().nullable(),
    discountPercent: z.string().nullable(),
    proRataRights: ProRataRightsSchema.nullable(),
    ownershipEstimate: z
      .object({
        basisPoints: z.number().int().min(0).max(10000),
        from: z.enum(["POST_MONEY", "CAP"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type InvestorRoundViewDto = z.infer<typeof InvestorRoundViewDtoSchema>;

/** Exact sums for one round (in its own currency) or one currency overall. */
export const CapitalSumsDtoSchema = z
  .object({
    /** RECEIVED: arrived, confirmed by the company's side. */
    raised: z.string(),
    /** Both sides confirmed (or marked sent), not yet received. */
    confirmed: z.string(),
    /** Stated by one side, waiting for the other. */
    pledged: z.string(),
  })
  .strict();
export type CapitalSumsDto = z.infer<typeof CapitalSumsDtoSchema>;

export const COMMITMENT_NEXT_STEPS = [
  "CONFIRM_AMOUNT",
  "MARK_SENT",
  "CONFIRM_RECEIVED",
] as const;
export const CommitmentNextStepSchema = z.enum(COMMITMENT_NEXT_STEPS);
export type CommitmentNextStep = z.infer<typeof CommitmentNextStepSchema>;

export const LedgerCommitmentDtoSchema = z
  .object({
    id: UuidSchema,
    relationshipId: UuidSchema,
    /** The investor organisation (company view) or the company (investor view). */
    counterpartId: UuidSchema,
    counterpartName: z.string(),
    amount: z.string(),
    currencyCode: CurrencyCodeSchema,
    level: CommitmentLevelSchema,
    status: z.enum([
      "DETECTED",
      "STATED",
      "CONFIRMED",
      "TRANSFER_SENT",
      "RECEIVED",
    ]),
    source: z.enum(["PERSON", "Q_MEETING"]),
    quote: z.string().nullable(),
    roundId: UuidSchema.nullable(),
    statedByYourSide: z.boolean(),
    transferReference: z.string().nullable(),
    at: UtcTimestampSchema,
    /** What the viewing side does next; null: nothing, or waiting on the other side. */
    next: CommitmentNextStepSchema.nullable(),
    /**
     * Investor view only: the round this commitment counts toward, once both
     * sides confirmed it. Terms they agreed to; never the target, totals or
     * other investors.
     */
    round: InvestorRoundViewDtoSchema.optional(),
  })
  .strict();
export type LedgerCommitmentDto = z.infer<typeof LedgerCommitmentDtoSchema>;

/** The founder's Capital page: rounds with derived sums, all-time totals, the book. */
export const CapitalLedgerDtoSchema = z
  .object({
    rounds: z
      .array(
        CapitalRoundDtoSchema.extend({
          sums: CapitalSumsDtoSchema,
          /** Commitments in this round in another currency: never converted. */
          otherCurrencies: z
            .array(
              CapitalSumsDtoSchema.extend({ currencyCode: CurrencyCodeSchema }),
            )
            .max(20),
          notices: z.array(CapitalRoundNoticeSchema).max(6),
        }).strict(),
      )
      .max(50),
    currentRoundId: UuidSchema.nullable(),
    /** All-time, per currency: never converted. */
    totals: z
      .array(CapitalSumsDtoSchema.extend({ currencyCode: CurrencyCodeSchema }))
      .max(20),
    commitments: z.array(LedgerCommitmentDtoSchema).max(200),
  })
  .strict();
export type CapitalLedgerDto = z.infer<typeof CapitalLedgerDtoSchema>;

/** An investor's own commitments across companies, with their totals. */
export const MyCommitmentsDtoSchema = z
  .object({
    totals: z
      .array(CapitalSumsDtoSchema.extend({ currencyCode: CurrencyCodeSchema }))
      .max(20),
    commitments: z.array(LedgerCommitmentDtoSchema).max(200),
  })
  .strict();
export type MyCommitmentsDto = z.infer<typeof MyCommitmentsDtoSchema>;

export const MarkTransferSentRequestSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\p{Cc}]+$/u)
      .optional(),
  })
  .strict();
export type MarkTransferSentRequest = z.infer<
  typeof MarkTransferSentRequestSchema
>;

export const ConfirmCommitmentAmountRequestSchema = z
  .object({
    /** The round it counts toward; default: the company's current round. */
    roundId: UuidSchema.optional(),
  })
  .strict();
export type ConfirmCommitmentAmountRequest = z.infer<
  typeof ConfirmCommitmentAmountRequestSchema
>;
