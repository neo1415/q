import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import {
  recordStatedFigure,
  saidByThem,
  STATED_FIGURE_METRIC_CODES,
  STATED_FIGURE_METRICS,
  statedFigureClashes,
  statedFigureAmountWords,
  statedFigureDateWords,
  StatedFigureSchema,
  statedFigureWords,
  type StatedFigure,
  type StatedFigureOutcome,
  type StatedFigureValue,
} from "@capital-q/evidence";

import {
  defineAppAction,
  portMissing,
  refusal,
  type AnyAppAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * A8, claim extraction in chat: a founder tells Q a figure about their own
 * company ("we hit $120k MRR in October", "ya tenemos 42 clientes de
 * pago") and Q proposes it as their dated claim on a card. Nothing is
 * recorded until they approve exactly that card (Prepare -> Recommend ->
 * Human Approval -> Execute); then the Evidence services record it as
 * USER_CLAIM / SELF_REPORTED, private to their company, with their own
 * words as the evidence.
 *
 * The figure is read from their words by the turn's own answer run, as
 * this tool's typed arguments (no extra model call, no keyword routing:
 * the run chooses the tool by meaning, in any language). Code then checks
 * what it can: the metric is a closed list, money keeps its own currency,
 * the quoted words must be the person's own words in this conversation,
 * and a date still ahead is not a figure reached. A different figure
 * already recorded for that metric and date is named on the card and kept
 * beside the new one, never replaced.
 */

const figures = (ports: AppActionPorts) =>
  ports.companyFigures ?? portMissing("companyFigures");

const RecordFigure = z
  .object({
    companyId: CompanyIdSchema,
    figure: StatedFigureSchema,
    /** What is already recorded for that metric and date, said on the card. */
    alongside: z.array(z.string().max(120)).max(5).default([]),
  })
  .strict();
type RecordInput = z.infer<typeof RecordFigure>;

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/u;

const RecordTool = z
  .object({
    metric: z
      .enum(STATED_FIGURE_METRIC_CODES)
      .describe(
        "Which figure they stated: MRR, ARR, REVENUE, BURN (monthly burn), CASH (cash in the bank), RUNWAY (months), GROSS_MARGIN (%), CUSTOMERS (paying customers), USERS (active users) or CHURN (%).",
      ),
    amount: z
      .number()
      .finite()
      .min(0)
      .max(1e15)
      .describe(
        "The figure as a plain number: 120000 for $120k, 42 for 42 customers, 3.5 for 3.5%.",
      ),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional()
      .describe(
        "ISO currency code for MRR, ARR, REVENUE, BURN and CASH, as they stated it ($ is USD unless they said otherwise). Omit for the others.",
      ),
    period: z
      .string()
      .regex(PERIOD)
      .nullable()
      .describe(
        "When the figure is for: YYYY-MM for a month ('in October' -> the most recent October), YYYY-MM-DD for a day, null when they gave no time at all.",
      ),
    said: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "Their own words that state it, copied exactly from their message (never your words, never translated).",
      ),
  })
  .strict();
type RecordToolInput = z.infer<typeof RecordTool>;

/** A month's figure is dated its last day (the demo figures' convention). */
function asOfOf(period: string | null): {
  readonly asOf: string | null;
  readonly starts: string | null;
} {
  if (period === null) return { asOf: null, starts: null };
  const match = PERIOD.exec(period);
  if (match === null) return { asOf: null, starts: null };
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (match[3] !== undefined) {
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    // 31 February is no date at all.
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

function valueOf(
  tool: RecordToolInput,
  kind: "MONEY" | "COUNT" | "PERCENT",
): StatedFigureValue | null {
  if (kind === "MONEY") {
    if (tool.currency === undefined) return null;
    // A decimal string, never a float: at most four decimal places.
    const amount = Number(tool.amount.toFixed(4)).toString();
    return /e/iu.test(amount)
      ? null
      : { kind: "MONEY", amount, currency: tool.currency };
  }
  if (kind === "COUNT") {
    return Number.isInteger(tool.amount)
      ? { kind: "COUNT", value: tool.amount }
      : null;
  }
  return tool.amount <= 1000 ? { kind: "PERCENT", value: tool.amount } : null;
}

const PRIVATE_NOTE =
  "Kept as your own statement (self-reported), private to your company: investors don't see it.";

function alongsideWords(alongside: readonly string[]): string {
  return alongside.length === 0
    ? ""
    : ` You already have ${alongside.join(" and ")} recorded for that date: both are kept, marked as conflicting, until you settle it.`;
}

function outcomeWords(out: StatedFigureOutcome, input: RecordInput): string {
  const what = statedFigureWords(input.figure);
  const conflict =
    out.conflicts === 0
      ? ""
      : " A different figure is recorded for that date too: both are kept, marked as conflicting, until you settle it.";
  return out.outcome === "ALREADY_RECORDED"
    ? `Your ${what} was already recorded, so nothing changed.${conflict}`
    : `Recorded your ${what} as your own statement (self-reported). It's private to your company; investors don't see it.${conflict}`;
}

async function ownCompany(
  ports: AppActionPorts,
  context: AppActionContext,
): Promise<string | null> {
  return ports.ownCompanyId === undefined
    ? null
    : await ports.ownCompanyId(context.actor).catch(() => null);
}

const RECORD = defineAppAction<
  RecordInput,
  StatedFigureOutcome,
  RecordToolInput
>({
  name: "company.figure.record",
  short: "record a company figure",
  area: "records",
  classification: "CONSEQUENTIAL",
  does: "Records a figure they tell Q about their own company (MRR, revenue, customers, burn...) as their dated, self-reported claim, private to their company, once they approve it.",
  input: RecordFigure,
  output: z.custom<StatedFigureOutcome>(),
  // Evidence decides: the subject must be the actor's own organisation's
  // company and the actor must hold evidence.record on it. Anyone else's
  // company is "not found" there, whatever the payload names.
  authorize: async (ports, context, input) =>
    (await ownCompany(ports, context)) === input.companyId
      ? { ok: true }
      : { ok: false, reason: "Figures are recorded for your own company." },
  run: (ports, context, input) =>
    recordStatedFigure(figures(ports), {
      actor: context.actor,
      companyId: input.companyId,
      figure: input.figure,
      idempotencyKey: context.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: (input) => ({
    summary: `Record your ${statedFigureWords(input.figure)}`,
    preview: `You said: "${input.figure.said}". ${PRIVATE_NOTE}${alongsideWords(input.alongside)}`,
  }),
  done: (out, input) => outcomeWords(out, input),
  tool: {
    name: "propose_company_figure",
    description:
      "For a founder: when they tell you a figure about their own company -- MRR, ARR, revenue, burn, cash, runway, gross margin, customers, active users or churn, in any words or language -- prepare it for their approval as their dated, self-reported figure, in this same turn. One figure per turn: when they stated several, prepare the first and say you'll record the next once they answer. Never for a figure you read in a document or found yourself, a target or a forecast, or another company's figure. Nothing is recorded until they approve exactly it.",
    input: RecordTool,
    references: {},
    scopes: ["COMPANY_PROFILE"],
    // Their own company's turn; on any other the reader names it (focus).
    purposes: ["OWN_COMPANY_QUESTION"],
    eval: {
      say: ["We hit $120k MRR in October.", "We have 42 paying customers now."],
    },
    toCanonical: async (tool, context, ports) => {
      const companyId = await ownCompany(ports, context);
      if (companyId === null) return null;
      const metric = STATED_FIGURE_METRICS[tool.metric];
      const words = context.theirWords ?? [];
      if (!saidByThem(tool.said, words)) {
        // A quote not in their messages has no provenance: what they said
        // is the only evidence this claim will ever have.
        return refusal(
          "Only a figure in their own words is recorded: `said` must be copied exactly from their message.",
          { forModel: true },
        );
      }
      const { asOf, starts } = asOfOf(tool.period);
      if (tool.period !== null && asOf === null) {
        return refusal("I couldn't place that date. Which month is it for?");
      }
      const today = new Date().toISOString().slice(0, 10);
      if (starts !== null && starts > today) {
        return refusal(
          "That date is still ahead, so I haven't recorded it as a figure you've reached. Tell me again once it's in.",
        );
      }
      const value = valueOf(tool, metric.kind);
      if (value === null) {
        return refusal(
          metric.kind === "MONEY"
            ? "Which currency is that figure in?"
            : "I couldn't place that figure. Give it as a number on its own.",
        );
      }
      const parsed = StatedFigureSchema.safeParse({
        metric: tool.metric,
        value,
        asOf,
        said: tool.said.trim(),
      });
      if (!parsed.success) return null;
      const figure: StatedFigure = parsed.data;
      const { clashes } = await statedFigureClashes(
        figures(ports),
        context.actor,
        companyId,
        figure,
      ).catch(() => ({ clashes: [] }));
      return {
        companyId: CompanyIdSchema.parse(companyId),
        figure,
        alongside: clashes.slice(0, 5).flatMap((claim) => {
          const stored = claim.structuredValue;
          const known = stored === null ? null : valueWords(stored);
          return known === null
            ? []
            : [`${known} ${statedFigureDateWords(asOf)}`.slice(0, 120)];
        }),
      };
    },
  },
});

function valueWords(stored: {
  readonly [key: string]: unknown;
}): string | null {
  const kind = stored["kind"];
  if (kind === "MONEY") {
    const amount = stored["amount"];
    const currency = stored["currency"];
    if (
      (typeof amount !== "string" && typeof amount !== "number") ||
      typeof currency !== "string"
    ) {
      return null;
    }
    const parsed = Number(amount);
    return Number.isFinite(parsed)
      ? statedFigureAmountWords({
          kind: "MONEY",
          amount: parsed.toString(),
          currency,
        })
      : null;
  }
  const value = stored["value"];
  if (typeof value !== "number") return null;
  return kind === "PERCENT"
    ? statedFigureAmountWords({ kind: "PERCENT", value })
    : kind === "COUNT"
      ? statedFigureAmountWords({ kind: "COUNT", value })
      : null;
}

export const COMPANY_FIGURE_ACTIONS: readonly AnyAppAction[] = [RECORD];
