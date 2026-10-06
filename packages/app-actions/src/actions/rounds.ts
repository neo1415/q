import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import {
  COMPANY_CAPITAL_ROUND_PATH,
  COMPANY_CAPITAL_ROUND_STEPS_PATH,
  CapitalRoundDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  RecordCapitalRoundStepRequestSchema,
  ReviseCapitalRoundRequestSchema,
  UuidSchema,
  type CapitalRoundDto,
  type CapitalRoundStep,
  type QSubjectRef,
  type RecordCapitalRoundStepRequest,
  type ReviseCapitalRoundRequest,
} from "@capital-q/contracts";

import { defineAppAction, portMissing } from "../define.js";
import type { AppActionPorts } from "../ports.js";
import { INSTRUMENT_WORDS, moneyText } from "./commitments.js";

/**
 * Round lifecycle and corrections (plan P8, 2026-10-06): record a close, a
 * tranche, the final close, reopen, cancel or open a planned round; correct
 * a round's terms. Members of the raise's family (`change_my_raise`), so Q
 * prepares them and the person approves exactly the card; the Capital page
 * calls the same routes. Every step is TERMS-consequential and never
 * delegated. The service decides the company, the status and the revision.
 */

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();
const servicesDecide = () => Promise.resolve({ ok: true as const });
const rounds = (ports: AppActionPorts) =>
  ports.capitalRounds ?? portMissing("capitalRounds");
const onCompany = (input: {
  readonly companyId: string;
}): readonly QSubjectRef[] => [{ kind: "COMPANY", companyId: input.companyId }];

const STEP_WORDS: Readonly<Record<CapitalRoundStep, string>> = {
  OPEN: "Start raising",
  CLOSE: "Record a close",
  TRANCHE: "Record a tranche",
  FINAL_CLOSE: "Final close",
  REOPEN: "Reopen",
  CANCEL: "Cancel",
};

const FIELD_WORDS: Readonly<Record<string, string>> = {
  targetCloseOn: "target close date",
  valuation: "valuation",
  valuationCap: "valuation cap",
  discountPercent: "discount",
  hardCap: "hard cap",
  proRataRights: "pro-rata rights",
  lead: "lead investor",
  extendsRoundId: "the round it extends",
  reportedRaised: "amount raised outside Capital Q",
};

/** What a correction changes, in words, for the approval card. */
export function revisionPreview(input: ReviseCapitalRoundRequest): string {
  const parts: string[] = [];
  if (input.name !== undefined) parts.push(`name ${input.name}`);
  if (input.target !== undefined) {
    parts.push(
      `target ${moneyText(input.target.amount, input.target.currency)}`,
    );
  }
  if (input.instrument !== undefined) {
    parts.push(INSTRUMENT_WORDS[input.instrument]);
  }
  if (input.openedOn !== undefined) parts.push(`opened ${input.openedOn}`);
  for (const [field, value] of Object.entries(input.terms ?? {})) {
    if (value === undefined) continue;
    const words = FIELD_WORDS[field] ?? field;
    parts.push(value === null ? `clear ${words}` : `${words} set`);
  }
  return parts.join(" · ");
}

export function stepPreview(input: RecordCapitalRoundStepRequest): string {
  return [
    input.on === undefined ? "Today" : `On ${input.on}`,
    input.amount === undefined ? null : `amount ${input.amount}`,
    input.label ?? null,
    input.note ?? null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

const ReviseRound = z
  .object({
    companyId: CompanyIdSchema,
    roundId: UuidSchema,
    input: ReviseCapitalRoundRequestSchema,
  })
  .strict();

const RoundStep = z
  .object({
    companyId: CompanyIdSchema,
    roundId: UuidSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: RecordCapitalRoundStepRequestSchema,
  })
  .strict();

export const REVISE_ROUND = defineAppAction<
  z.infer<typeof ReviseRound>,
  CapitalRoundDto
>({
  name: "capital.round.revise",
  consequence: "TERMS",
  short: "correct a round",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Corrects one of their company's rounds (name, target, instrument, opening date, valuation, cap, discount, hard cap, pro-rata rights, lead, target close date, what it raised outside Capital Q), as the Capital page does; the previous values stay in the round's history.",
  input: ReviseRound,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    rounds(ports).reviseRound({
      actor: context.actor,
      companyId: input.companyId,
      roundId: input.roundId,
      input: input.input,
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: "Correct this round",
    preview: `${revisionPreview(input.input)}. The previous values stay in its history.`,
  }),
  done: (out) => `Done. ${out.name} is updated; its history keeps what it was.`,
  http: {
    method: "PATCH",
    path: COMPANY_CAPITAL_ROUND_PATH,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      roundId: params["roundId"],
      input: body,
    }),
    respond: (out) => CapitalRoundDtoSchema.parse(out),
  },
});

export const ROUND_STEP = defineAppAction<
  z.infer<typeof RoundStep>,
  CapitalRoundDto
>({
  name: "capital.round.step",
  consequence: "TERMS",
  short: "record a round step",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Records a step in one of their company's rounds, as the Capital page does: start raising a planned round, a close (first or later), a tranche, the final close, reopening (an extension or second close) or cancelling a round no money closed in.",
  input: RoundStep,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    rounds(ports).recordStep({
      actor: context.actor,
      companyId: input.companyId,
      roundId: input.roundId,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: STEP_WORDS[input.input.step],
    preview: stepPreview(input.input),
  }),
  done: (out) =>
    `Done. ${out.name} is now ${out.status.toLowerCase().replaceAll("_", " ")}.`,
  http: {
    method: "POST",
    path: COMPANY_CAPITAL_ROUND_STEPS_PATH,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      roundId: params["roundId"],
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      input: body,
    }),
    respond: (out) => CapitalRoundDtoSchema.parse(out),
  },
});
