import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import {
  COMPANY_CAPITAL_ROUND_CLOSE_PATH,
  COMPANY_CAPITAL_ROUNDS_PATH,
  CapitalRoundDtoSchema,
  CloseCapitalRoundRequestSchema,
  ConfirmCommitmentAmountRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MarkTransferSentRequestSchema,
  NETWORK_COMMITMENT_AMOUNT_CONFIRMATION_PATH,
  NETWORK_COMMITMENT_RECEIPT_PATH,
  NETWORK_COMMITMENT_TRANSFER_PATH,
  OpenCapitalRoundRequestSchema,
  RelationshipCommitmentsDtoSchema,
  UuidSchema,
  type CapitalRoundDto,
  type KnownErrorCode,
  type QSubjectRef,
  type QTaskClass,
} from "@capital-q/contracts";
import type { CommitmentOutcome, CommitmentService } from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import {
  defineAppAction,
  defineAppActionFamily,
  portMissing,
  refusal,
  relationshipTarget,
  type AnyAppAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Rounds and the money's steps (founder direction 2026-10-04; ADR 0040).
 *
 * Rounds: open and close, members of the raise's family (`change_my_raise`)
 * so Q's tool count does not grow. Commitments: confirm the amount (either
 * side; Q's detection or the other side's statement), mark it sent (the
 * investor's side), confirm it arrived (the company's side) -- one family,
 * one Q tool. Every step is money (ADR 0043): CONSEQUENTIAL for Q, never
 * delegated, the person approves exactly the card. Network decides the
 * party and the side; a commitment that is not theirs is the same 404.
 */

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();
const servicesDecide = () => Promise.resolve({ ok: true as const });
const rounds = (ports: AppActionPorts) =>
  ports.capitalRounds ?? portMissing("capitalRounds");
const commitments = (ports: AppActionPorts) =>
  ports.commitments ?? portMissing("commitments");

/** Exact money for a card: digits grouped, never through a float. */
export function moneyText(amount: string, currency: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents =
    fraction === undefined || /^0*$/.test(fraction)
      ? ""
      : `.${fraction.padEnd(2, "0").slice(0, 2)}`;
  return `${currency} ${grouped}${cents}`;
}

const INSTRUMENT_WORDS: Readonly<
  Record<CapitalRoundDto["instrument"], string>
> = {
  SAFE: "SAFE",
  EQUITY: "Equity",
  CONVERTIBLE: "Convertible note",
  OTHER: "Other instrument",
};

const onCompany = (input: {
  readonly companyId: string;
}): readonly QSubjectRef[] => [{ kind: "COMPANY", companyId: input.companyId }];

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

const OpenRound = z
  .object({
    companyId: CompanyIdSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: OpenCapitalRoundRequestSchema,
  })
  .strict();

const CloseRound = z
  .object({
    companyId: CompanyIdSchema,
    roundId: UuidSchema,
    input: CloseCapitalRoundRequestSchema,
  })
  .strict();

export const OPEN_ROUND = defineAppAction<
  z.infer<typeof OpenRound>,
  CapitalRoundDto
>({
  name: "capital.round.open",
  consequence: "TERMS",
  short: "open a round",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Opens (or plans) a funding round for their company, with its target and instrument, as the Capital page does; an open round becomes the current one.",
  input: OpenRound,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    rounds(ports).openRound({
      actor: context.actor,
      companyId: input.companyId,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary:
      input.input.status === "PLANNED"
        ? `Plan a ${input.input.name} round`
        : `Open a ${input.input.name} round`,
    preview: [
      `Target ${moneyText(input.input.target.amount, input.input.target.currency)}`,
      INSTRUMENT_WORDS[input.input.instrument],
      input.input.status === "PLANNED"
        ? "Planned"
        : "Becomes your current round",
    ].join(" · "),
  }),
  done: (out) =>
    `Done. ${out.name} is ${out.status === "PLANNED" ? "planned" : "open"}, targeting ${moneyText(out.target.amount, out.target.currency)}.`,
  http: {
    method: "POST",
    path: COMPANY_CAPITAL_ROUNDS_PATH,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      input: body,
    }),
    status: 201,
    respond: (out) => CapitalRoundDtoSchema.parse(out),
  },
});

export const CLOSE_ROUND = defineAppAction<
  z.infer<typeof CloseRound>,
  CapitalRoundDto
>({
  name: "capital.round.close",
  consequence: "TERMS",
  short: "close a round",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Closes one of their company's rounds, as the Capital page does; what it raised stays on record.",
  input: CloseRound,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    rounds(ports).closeRound({
      actor: context.actor,
      companyId: input.companyId,
      roundId: input.roundId,
      input: input.input,
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: () => ({
    summary: "Close this round",
    preview: "What it raised stays on record.",
  }),
  done: (out) => `Done. ${out.name} is closed.`,
  http: {
    method: "POST",
    path: COMPANY_CAPITAL_ROUND_CLOSE_PATH,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      roundId: params["roundId"],
      input: body ?? {},
    }),
    respond: (out) => CapitalRoundDtoSchema.parse(out),
  },
});

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

type View = NonNullable<Awaited<ReturnType<CommitmentService["view"]>>>;
type StepOut = CommitmentOutcome<View>;

const REFUSALS: Readonly<
  Record<
    Exclude<StepOut, { outcome: "OK" }>["code"],
    { readonly code: KnownErrorCode; readonly detail: string }
  >
> = {
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_CONNECTED: {
    code: "RESOURCE_CONFLICT",
    detail: "Commitments open once you're connected.",
  },
  NOT_ALLOWED: {
    code: "RESOURCE_CONFLICT",
    detail: "That step isn't yours to take on this commitment right now.",
  },
};

const stepHttp = {
  problem: (out: StepOut) =>
    out.outcome === "OK" || out.code === "NOT_FOUND"
      ? null
      : REFUSALS[out.code],
  notFound: (out: StepOut) =>
    out.outcome === "REFUSED" && out.code === "NOT_FOUND",
  respond: (out: StepOut) =>
    out.outcome === "OK"
      ? RelationshipCommitmentsDtoSchema.parse(out.value)
      : undefined,
};

const succeeded = (out: StepOut) => out.outcome === "OK";

/**
 * The company's current round, for a step the company's side takes: money
 * counts toward the current round by default. An investor's step never
 * reads the company's rounds; the company's own step attaches it.
 */
async function currentRoundFor(
  ports: AppActionPorts,
  actor: ActorContext,
  commitmentId: string,
  given: string | undefined,
): Promise<string | null> {
  if (given !== undefined) return given;
  const found = await commitments(ports).commitmentFor(actor, commitmentId);
  if (found === null || found.side !== "COMPANY") return null;
  const companyId = await ports.ownCompanyId?.(actor).catch(() => null);
  if (
    companyId === null ||
    companyId === undefined ||
    ports.capitalRounds === undefined
  ) {
    return null;
  }
  const current = await ports.capitalRounds
    .currentRound({ actor, companyId: CompanyIdSchema.parse(companyId) })
    .catch(() => null);
  return current?.id ?? null;
}

const ConfirmAmount = z
  .object({
    commitmentId: UuidSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: ConfirmCommitmentAmountRequestSchema,
    /** For the card only: what is being confirmed, as Q found it. */
    shown: z.string().max(120).optional(),
    relationshipId: UuidSchema.optional(),
  })
  .strict();

const MarkSent = z
  .object({
    commitmentId: UuidSchema,
    input: MarkTransferSentRequestSchema,
    shown: z.string().max(120).optional(),
    relationshipId: UuidSchema.optional(),
  })
  .strict();

const ConfirmReceived = z
  .object({
    commitmentId: UuidSchema,
    input: ConfirmCommitmentAmountRequestSchema,
    shown: z.string().max(120).optional(),
    relationshipId: UuidSchema.optional(),
  })
  .strict();

const targetOf = (input: { readonly relationshipId?: string | undefined }) =>
  input.relationshipId === undefined
    ? []
    : relationshipTarget(input.relationshipId);

const commitmentKey = (params: Record<string, string>) =>
  params["commitmentId"];

export const CONFIRM_AMOUNT = defineAppAction<
  z.infer<typeof ConfirmAmount>,
  StepOut
>({
  name: "capital.commitment.confirm_amount",
  consequence: "MONEY",
  short: "confirm a commitment's amount",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Confirms the amount of a commitment -- money Q heard in a call or the other side recorded -- as the Capital page's Confirm amount does; it counts once both sides have confirmed.",
  input: ConfirmAmount,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) =>
    commitments(ports).confirmAmount(
      context.actor,
      input.commitmentId,
      input.idempotencyKey,
      await currentRoundFor(
        ports,
        context.actor,
        input.commitmentId,
        input.input.roundId,
      ),
    ),
  targets: targetOf,
  card: (input, names) => ({
    summary: `Confirm ${input.shown ?? "this amount"}${names?.counterpart ? ` with ${names.counterpart}` : ""}`,
    preview:
      "Counts once both sides have confirmed it. Nothing moves any money.",
  }),
  succeeded,
  done: (out) =>
    out.outcome === "OK"
      ? "Done. The amount is confirmed on your side."
      : (REFUSALS[out.code]?.detail ?? "That didn't go through."),
  http: {
    method: "POST",
    path: NETWORK_COMMITMENT_AMOUNT_CONFIRMATION_PATH,
    fromRequest: (params, body, headers) => ({
      commitmentId: commitmentKey(params),
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      input: body ?? {},
    }),
    ...stepHttp,
  },
});

export const MARK_SENT = defineAppAction<z.infer<typeof MarkSent>, StepOut>({
  name: "capital.commitment.mark_sent",
  consequence: "MONEY",
  short: "mark money as sent",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Marks a confirmed commitment's money as sent (the investor's side), with a transfer reference if given, as the Capital page's Mark as sent does; the company is told to confirm receipt.",
  input: MarkSent,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    commitments(ports).markSent(
      context.actor,
      input.commitmentId,
      input.input.reference ?? null,
    ),
  targets: targetOf,
  card: (input, names) => ({
    summary: `Mark ${input.shown ?? "this commitment"} as sent${names?.counterpart ? ` to ${names.counterpart}` : ""}`,
    preview:
      input.input.reference === undefined
        ? "They'll be asked to confirm it arrived."
        : `Reference ${input.input.reference} · They'll be asked to confirm it arrived.`,
  }),
  succeeded,
  done: (out) =>
    out.outcome === "OK"
      ? "Done. Marked as sent; they'll confirm when it arrives."
      : (REFUSALS[out.code]?.detail ?? "That didn't go through."),
  http: {
    method: "POST",
    path: NETWORK_COMMITMENT_TRANSFER_PATH,
    fromRequest: (params, body) => ({
      commitmentId: commitmentKey(params),
      input: body ?? {},
    }),
    ...stepHttp,
  },
});

export const CONFIRM_RECEIVED = defineAppAction<
  z.infer<typeof ConfirmReceived>,
  StepOut
>({
  name: "capital.commitment.confirm_received",
  consequence: "MONEY",
  short: "confirm money received",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Confirms a commitment's money arrived (the company's side), as the Capital page's Confirm received does; it then counts as raised in its round.",
  input: ConfirmReceived,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) =>
    commitments(ports).confirmReceived(
      context.actor,
      input.commitmentId,
      await currentRoundFor(
        ports,
        context.actor,
        input.commitmentId,
        input.input.roundId,
      ),
    ),
  targets: targetOf,
  card: (input, names) => ({
    summary: `Confirm you received ${input.shown ?? "this money"}${names?.counterpart ? ` from ${names.counterpart}` : ""}`,
    preview: "It counts as raised in its round.",
  }),
  succeeded,
  done: (out) =>
    out.outcome === "OK"
      ? "Done. Received, and counted as raised."
      : (REFUSALS[out.code]?.detail ?? "That didn't go through."),
  http: {
    method: "POST",
    path: NETWORK_COMMITMENT_RECEIPT_PATH,
    fromRequest: (params, body) => ({
      commitmentId: commitmentKey(params),
      input: body ?? {},
    }),
    ...stepHttp,
  },
});

// OWN_COMPANY_QUESTION's offer is full (MODEL_TOOLS_MAX); the turn reader
// names this tool from its action list on any purpose, as join_call does.
const PURPOSES: readonly QTaskClass[] = ["RELATIONSHIP_QUESTION"];

const STEP_FOR = {
  CONFIRM_AMOUNT: "CONFIRM_AMOUNT",
  MARK_SENT: "MARK_SENT",
  CONFIRM_RECEIVED: "CONFIRM_RECEIVED",
} as const;

const STEP_WORDS: Readonly<Record<keyof typeof STEP_FOR, string>> = {
  CONFIRM_AMOUNT: "an amount to confirm",
  MARK_SENT: "confirmed money to mark as sent",
  CONFIRM_RECEIVED: "money to confirm as received",
};

/** Same money, however it was written ("1000000", "1,000,000.00"). */
function sameAmount(said: string, stored: string): boolean {
  const norm = (value: string) => {
    const [whole = "", fraction = ""] = value.replace(/[,\s]/g, "").split(".");
    return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
  };
  return norm(said) === norm(stored);
}

const StepTool = z
  .object({
    operation: z
      .enum(["CONFIRM_AMOUNT", "MARK_SENT", "CONFIRM_RECEIVED"])
      .describe(
        "CONFIRM_AMOUNT: either side confirms an amount (money Q heard in a call, or the other side recorded). MARK_SENT: the investor says they sent confirmed money. CONFIRM_RECEIVED: the founder says the money arrived.",
      ),
    relationship: z
      .string()
      .min(1)
      .max(200)
      .describe("The investor (or company) as the person named it."),
    amount: z
      .string()
      .max(32)
      .optional()
      .describe(
        "Only if they said an amount: digits, e.g. 1000000 for $1M. Picks one commitment when there are several.",
      ),
    reference: z
      .string()
      .max(120)
      .optional()
      .describe("MARK_SENT only: a transfer reference, if they gave one."),
  })
  .strict();

export const COMMITMENT_ACTIONS: readonly AnyAppAction[] =
  defineAppActionFamily<z.infer<typeof StepTool>>({
    name: "capital.commitment.step",
    consequence: "MONEY",
    short: "commitments: confirm, sent, received",
    area: "capital",
    does: "Moves one of their commitments a step, as the Capital page does: confirm the amount, mark it sent (investor), or confirm it was received (founder).",
    members: {
      CONFIRM_AMOUNT,
      MARK_SENT,
      CONFIRM_RECEIVED,
    },
    tool: {
      name: "commitment_step",
      description:
        'Use when the person says money with one of their investors (or companies) moved a step: the amount is right ("yes, Ada is in for $500K"), they sent it ("I\'ve sent the $1M to Nixo"), or it arrived ("I\'ve received Zino\'s money"). Prepares that step on their own commitment for their approval; nothing moves money. Name the other side as they said it, and the amount if they said one.',
      input: StepTool,
      references: { relationship: "RELATIONSHIP" },
      purposes: PURPOSES,
      eval: {
        say: [
          "I've received {name}'s money.",
          "The amount with {name} is right, confirm it.",
        ],
        names: "RELATIONSHIP",
        orSays: "confirm|nothing|isn't|not yet|waiting",
      },
      toCanonical: async (tool, context, ports) => {
        if (ports.commitments === undefined) return null;
        const own = await ports.ownCompanyId?.(context.actor).catch(() => null);
        const ledger =
          own !== null && own !== undefined
            ? await ports.commitments.ledger({
                actor: context.actor,
                side: "COMPANY",
                companyId: own,
              })
            : await ports.commitments.ledger({
                actor: context.actor,
                side: "INVESTOR",
              });
        const theirs = ledger.commitments.filter(
          (item) => item.relationshipId === tool.relationship,
        );
        const name = theirs[0]?.counterpartName ?? "them";
        const ready = theirs.filter(
          (item) =>
            item.next === STEP_FOR[tool.operation] &&
            (tool.amount === undefined || sameAmount(tool.amount, item.amount)),
        );
        if (ready.length === 0) {
          const waiting = theirs.find((item) => item.next !== null);
          return refusal(
            waiting === undefined
              ? `Nothing with ${name} is waiting on you for that.`
              : `Not yet: ${moneyText(waiting.amount, waiting.currencyCode)} with ${name} needs ${waiting.next === "CONFIRM_AMOUNT" ? "the amount confirmed by both sides first" : waiting.next === "MARK_SENT" ? "to be marked as sent" : "receipt confirmed"}.`,
          );
        }
        if (ready.length > 1) {
          return refusal(
            `${name} has ${STEP_WORDS[tool.operation]} more than once: ${ready
              .map((item) => moneyText(item.amount, item.currencyCode))
              .join(" or ")}. Which one?`,
          );
        }
        const [item] = ready;
        if (item === undefined) return null;
        const shown = moneyText(item.amount, item.currencyCode);
        switch (tool.operation) {
          case "CONFIRM_AMOUNT":
            return {
              operation: "CONFIRM_AMOUNT",
              input: {
                commitmentId: item.id,
                idempotencyKey: context.idempotencyKey,
                input: {},
                shown,
                relationshipId: item.relationshipId,
              },
            };
          case "MARK_SENT":
            return {
              operation: "MARK_SENT",
              input: {
                commitmentId: item.id,
                input:
                  tool.reference === undefined || tool.reference.trim() === ""
                    ? {}
                    : { reference: tool.reference.trim() },
                shown,
                relationshipId: item.relationshipId,
              },
            };
          case "CONFIRM_RECEIVED":
            return {
              operation: "CONFIRM_RECEIVED",
              input: {
                commitmentId: item.id,
                input: {},
                shown,
                relationshipId: item.relationshipId,
              },
            };
        }
      },
    },
  });
