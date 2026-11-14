import { z } from "zod";

import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { EvidenceService } from "../application/service.js";
import type { Claim, StructuredValue } from "../contracts/index.js";
import { excerptIsPresent } from "./policy.js";

/**
 * A figure a founder states about their own company in conversation with Q
 * ("we hit $120k MRR in October"), recorded as their dated claim (A8,
 * claim extraction in chat).
 *
 * The turn's own model run reads the figure into the typed shape below
 * (one tool call in the answer it was already writing: no extra model
 * call). Nothing is recorded from that reading. Q prepares a card with the
 * exact figure, the founder approves exactly it, and only then does this
 * module write, through the Evidence application services (each of which
 * authorises, audits and emits): a CONVERSATION source, a USER_CLAIM /
 * SELF_REPORTED claim, the founder's own words as its evidence item.
 *
 *   - Private by construction: `createClaim` keeps a claim inside the
 *     owning organisation, so no investor reads it. Publishing a figure is
 *     a separate disclosure decision.
 *   - Dated: a month's figure is that month's reading; several months of
 *     one metric are its history, never a contradiction.
 *   - A different value already recorded for the same metric and date is
 *     NOT overwritten and NOT superseded: both stay CURRENT and the new
 *     evidence is linked to the old claim as CONTRADICTS. A person settles
 *     it; the larger number is never preferred.
 *   - The same value for the same metric and date is recorded once.
 */

/**
 * The metrics a founder may state, each onto the claim key the figure
 * readers (read_company_figures, the chart builder) already know. A closed
 * list: structured-data mapping, never a reading of anyone's words.
 */
export const STATED_FIGURE_METRICS = {
  MRR: {
    claimKey: "financial.mrr",
    claimType: "financial",
    kind: "MONEY",
    label: "MRR",
  },
  ARR: {
    claimKey: "financial.arr",
    claimType: "financial",
    kind: "MONEY",
    label: "ARR",
  },
  REVENUE: {
    claimKey: "financial.revenue",
    claimType: "financial",
    kind: "MONEY",
    label: "revenue",
  },
  BURN: {
    claimKey: "financial.burn_rate",
    claimType: "financial",
    kind: "MONEY",
    label: "monthly burn",
  },
  CASH: {
    claimKey: "financial.cash_balance",
    claimType: "financial",
    kind: "MONEY",
    label: "cash in the bank",
  },
  RUNWAY: {
    claimKey: "financial.runway_months",
    claimType: "financial",
    kind: "COUNT",
    label: "runway (months)",
  },
  GROSS_MARGIN: {
    claimKey: "financial.gross_margin",
    claimType: "financial",
    kind: "PERCENT",
    label: "gross margin",
  },
  CUSTOMERS: {
    claimKey: "traction.customer_count",
    claimType: "traction",
    kind: "COUNT",
    label: "customers",
  },
  USERS: {
    claimKey: "traction.active_users",
    claimType: "traction",
    kind: "COUNT",
    label: "active users",
  },
  CHURN: {
    claimKey: "traction.churn_rate",
    claimType: "traction",
    kind: "PERCENT",
    label: "churn",
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly claimKey: string;
      readonly claimType: string;
      readonly kind: "MONEY" | "COUNT" | "PERCENT";
      readonly label: string;
    }
  >
>;
export type StatedFigureMetric = keyof typeof STATED_FIGURE_METRICS;
export const STATED_FIGURE_METRIC_CODES = Object.keys(
  STATED_FIGURE_METRICS,
) as [StatedFigureMetric, ...StatedFigureMetric[]];
export const StatedFigureMetricSchema = z.enum(STATED_FIGURE_METRIC_CODES);

/** Money as a decimal string with its own currency: never a float, never converted. */
const DECIMAL = /^\d{1,15}(?:\.\d{1,4})?$/u;

export const StatedFigureValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("MONEY"),
      amount: z.string().regex(DECIMAL),
      currency: z.string().regex(/^[A-Z]{3}$/u),
    })
    .strict(),
  z
    .object({
      kind: z.literal("COUNT"),
      value: z.number().int().min(0).max(1e12),
    })
    .strict(),
  z
    .object({
      kind: z.literal("PERCENT"),
      value: z.number().finite().min(-1000).max(1000),
    })
    .strict(),
]);
export type StatedFigureValue = z.infer<typeof StatedFigureValueSchema>;

/** The exact figure the founder approves. Every field is on the card. */
export const StatedFigureSchema = z
  .object({
    metric: StatedFigureMetricSchema,
    value: StatedFigureValueSchema,
    /** The date the figure is for (a month's figure: its last day); null: undated. */
    asOf: z.iso.date().nullable(),
    /** Their own words, verbatim from the conversation: the evidence. */
    said: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    (figure) => figure.value.kind === STATED_FIGURE_METRICS[figure.metric].kind,
    { message: "the value's kind does not fit the metric", path: ["value"] },
  );
export type StatedFigure = z.infer<typeof StatedFigureSchema>;

const DAY = /^(\d{4}-\d{2}-\d{2})/u;
const dayOf = (raw: unknown): string | null =>
  typeof raw === "string" ? (DAY.exec(raw)?.[1] ?? null) : null;

/** The date a recorded figure is for: its value's own date, else the claim's. */
export function claimDate(claim: Claim): string | null {
  return dayOf(claim.structuredValue?.["asOf"]) ?? dayOf(claim.validFrom);
}

function sameValue(
  stored: StructuredValue | null,
  value: StatedFigureValue,
): boolean {
  if (stored === null || stored["kind"] !== value.kind) return false;
  if (value.kind === "MONEY") {
    const amount = stored["amount"];
    return (
      stored["currency"] === value.currency &&
      (typeof amount === "string" || typeof amount === "number") &&
      Number(amount) === Number(value.amount)
    );
  }
  const number = stored["value"];
  return (
    (typeof number === "number" || typeof number === "string") &&
    Number(number) === value.value
  );
}

/** The structured value stored on the claim, in the shape the chart reads. */
export function statedFigureStructuredValue(
  figure: StatedFigure,
): StructuredValue {
  return {
    ...figure.value,
    ...(figure.asOf === null ? {} : { asOf: figure.asOf }),
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "USD 120,000", "42", "3.5%": the value as the card and the claim say it. */
export function statedFigureAmountWords(value: StatedFigureValue): string {
  if (value.kind === "MONEY") {
    const [whole = "0", fraction] = value.amount.split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
    return `${value.currency} ${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
  }
  if (value.kind === "PERCENT") return `${String(value.value)}%`;
  return String(value.value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

const STATED_PERIOD = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/u;

/**
 * A stated period as the figure's date. A month (YYYY-MM) is dated its last
 * day, the convention every figure path uses ("in October" said in
 * conversation, "Oct 2026" read from a deck); a day (YYYY-MM-DD) is itself.
 * Nothing else is a date: anything unreadable, or a day no calendar has
 * (31 February), is null, never a guess. `starts` is the period's first day.
 */
export function statedFigurePeriod(period: string | null): {
  readonly asOf: string | null;
  readonly starts: string | null;
} {
  if (period === null) return { asOf: null, starts: null };
  const match = STATED_PERIOD.exec(period);
  if (match === null) return { asOf: null, starts: null };
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (match[3] !== undefined) {
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) return { asOf: null, starts: null };
    return { asOf: period, starts: period };
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return {
    asOf: `${String(year)}-${mm}-${String(last).padStart(2, "0")}`,
    starts: `${String(year)}-${mm}-01`,
  };
}

/** "for October 2026" (a month's last day), "on 3 October 2026", or "undated". */
export function statedFigureDateWords(asOf: string | null): string {
  if (asOf === null) return "undated";
  const [year, month, day] = asOf.split("-").map(Number);
  const name = MONTHS[(month ?? 1) - 1] ?? "";
  if (year === undefined || month === undefined || day === undefined) {
    return asOf;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day === lastDay
    ? `for ${name} ${String(year)}`
    : `on ${String(day)} ${name} ${String(year)}`;
}

/** "MRR of USD 120,000 for October 2026" */
export function statedFigureWords(figure: StatedFigure): string {
  const label = STATED_FIGURE_METRICS[figure.metric].label;
  const date = statedFigureDateWords(figure.asOf);
  return `${label} of ${statedFigureAmountWords(figure.value)}${date === "undated" ? "" : ` ${date}`}`;
}

/**
 * Whether the quoted words are the person's own: present, whitespace
 * normalised, in what they wrote in this conversation. The same rule as an
 * extraction's excerpt (a quote not in the source has no provenance), and
 * language-agnostic: it compares their words, it does not read them.
 */
export function saidByThem(
  said: string,
  theirWords: readonly string[],
): boolean {
  return theirWords.some((text) => excerptIsPresent(said, text));
}

export type StatedFigureEvidence = Pick<
  EvidenceService,
  | "listClaims"
  | "registerEvidenceSource"
  | "createClaim"
  | "createEvidenceItem"
  | "linkClaimEvidence"
>;

export type StatedFigureClash = {
  readonly claimId: string;
  readonly words: string;
};

/**
 * The CURRENT figures already recorded for the same metric and date with a
 * different value: what the new figure would sit beside, never replace.
 */
export async function statedFigureClashes(
  evidence: Pick<EvidenceService, "listClaims">,
  actor: ActorContext,
  companyId: string,
  figure: StatedFigure,
): Promise<{
  readonly same: Claim | null;
  readonly clashes: readonly Claim[];
}> {
  const metric = STATED_FIGURE_METRICS[figure.metric];
  const claims = await evidence.listClaims({
    actor,
    subject: { subjectType: "COMPANY", subjectId: companyId },
    claimKey: metric.claimKey,
  });
  const onDate = claims.filter(
    (claim) =>
      claim.lifecycleStatus === "CURRENT" && claimDate(claim) === figure.asOf,
  );
  return {
    same:
      onDate.find((c) => sameValue(c.structuredValue, figure.value)) ?? null,
    clashes: onDate.filter((c) => !sameValue(c.structuredValue, figure.value)),
  };
}

export type StatedFigureOutcome = {
  readonly outcome: "RECORDED" | "ALREADY_RECORDED";
  readonly claimId: string;
  /** Earlier figures for the same metric and date that disagree; both stay. */
  readonly conflicts: number;
};

/**
 * Records one approved figure. Called only with the approved payload; the
 * caller (the app action) has already bound the approval to it.
 */
export async function recordStatedFigure(
  evidence: StatedFigureEvidence,
  command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly figure: StatedFigure;
    readonly idempotencyKey: string;
    readonly correlationId: CorrelationId;
  },
): Promise<StatedFigureOutcome> {
  const { actor, companyId, correlationId } = command;
  const figure = StatedFigureSchema.parse(command.figure);
  const metric = STATED_FIGURE_METRICS[figure.metric];
  const subject = { subjectType: "COMPANY" as const, subjectId: companyId };
  const { same, clashes } = await statedFigureClashes(
    evidence,
    actor,
    companyId,
    figure,
  );
  if (same !== null) {
    // The same value for the same date: a retried approval, or the
    // founder saying it twice. Recorded once.
    return {
      outcome: "ALREADY_RECORDED",
      claimId: same.id,
      conflicts: clashes.length,
    };
  }
  const structuredValue = statedFigureStructuredValue(figure);
  const validFrom =
    figure.asOf === null ? null : `${figure.asOf}T00:00:00.000Z`;
  const source = await evidence.registerEvidenceSource({
    actor,
    correlationId,
    input: {
      sourceType: "CONVERSATION",
      subject,
      title: "Told to Q in conversation",
      reliabilityClass: "USER_STATEMENT",
      metadata: {
        via: "q_conversation",
        approvedCard: true,
        idempotencyKey: command.idempotencyKey.slice(0, 200),
      },
    },
  });
  const claim = await evidence.createClaim({
    actor,
    correlationId,
    input: {
      subject,
      claimType: metric.claimType,
      claimKey: metric.claimKey,
      statement: `The company's ${statedFigureWords(figure)}, as the founder told Q (self-reported).`,
      structuredValue,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      validFrom,
      sourceId: source.id,
    },
  });
  const item = await evidence.createEvidenceItem({
    actor,
    correlationId,
    input: {
      sourceId: source.id,
      evidenceType: `${metric.claimType}.stated`,
      summary: figure.said,
      structuredValue,
      locator: { kind: "statement" },
      validFrom,
      evidenceStatus: "SELF_REPORTED",
      reliabilityClass: "USER_STATEMENT",
    },
  });
  await evidence.linkClaimEvidence({
    actor,
    correlationId,
    input: {
      claimId: claim.id,
      evidenceItemId: item.id,
      relationship: "SUPPORTS",
    },
  });
  // Both readings stay; neither is chosen. The disagreement is recorded on
  // the earlier claim, where its evidence history already lives.
  for (const clash of clashes) {
    await evidence.linkClaimEvidence({
      actor,
      correlationId,
      input: {
        claimId: clash.id,
        evidenceItemId: item.id,
        relationship: "CONTRADICTS",
      },
    });
  }
  return { outcome: "RECORDED", claimId: claim.id, conflicts: clashes.length };
}
