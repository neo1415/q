import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema } from "../common/money.js";
import { LocalDateSchema, UtcTimestampSchema } from "../common/time.js";
import { CapitalTargetSchema } from "./capital-objectives.js";
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
  "OTHER",
] as const;
export const CapitalRoundInstrumentSchema = z.enum(CAPITAL_ROUND_INSTRUMENTS);
export type CapitalRoundInstrument = z.infer<
  typeof CapitalRoundInstrumentSchema
>;

export const CAPITAL_ROUND_STATUSES = ["PLANNED", "OPEN", "CLOSED"] as const;
export const CapitalRoundStatusSchema = z.enum(CAPITAL_ROUND_STATUSES);
export type CapitalRoundStatus = z.infer<typeof CapitalRoundStatusSchema>;

export const CAPITAL_ROUNDS_SUFFIX = "/capital-rounds" as const;
export const CAPITAL_ROUND_CLOSE_SUFFIX = "/close" as const;
export const COMPANY_CAPITAL_ROUNDS_PATH =
  `${COMPANIES_PATH}/:companyId${CAPITAL_ROUNDS_SUFFIX}` as const;
export const COMPANY_CAPITAL_ROUND_CLOSE_PATH =
  `${COMPANY_CAPITAL_ROUNDS_PATH}/:roundId${CAPITAL_ROUND_CLOSE_SUFFIX}` as const;
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

export const OpenCapitalRoundRequestSchema = z
  .object({
    name: RoundNameSchema,
    target: CapitalTargetSchema,
    instrument: CapitalRoundInstrumentSchema,
    /** PLANNED: not raising yet. OPEN (default): raising now; it becomes current. */
    status: z.enum(["PLANNED", "OPEN"]).optional(),
    /** Defaults to today for an open round. */
    openedOn: LocalDateSchema.optional(),
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

export const CapitalRoundDtoSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    target: z.object({ amount: z.string(), currency: CurrencyCodeSchema }),
    instrument: CapitalRoundInstrumentSchema,
    status: CapitalRoundStatusSchema,
    isCurrent: z.boolean(),
    openedOn: LocalDateSchema.nullable(),
    closedOn: LocalDateSchema.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type CapitalRoundDto = z.infer<typeof CapitalRoundDtoSchema>;

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
  })
  .strict();
export type LedgerCommitmentDto = z.infer<typeof LedgerCommitmentDtoSchema>;

/** The founder's Capital page: rounds with derived sums, all-time totals, the book. */
export const CapitalLedgerDtoSchema = z
  .object({
    rounds: z
      .array(
        CapitalRoundDtoSchema.extend({ sums: CapitalSumsDtoSchema }).strict(),
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
