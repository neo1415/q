import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import {
  DocumentFigureSourceSchema,
  documentFigureWords,
  recordDocumentFigure,
  recordStatedFigure,
  recordWebFigure,
  saidByThem,
  STATED_FIGURE_METRIC_CODES,
  STATED_FIGURE_METRICS,
  statedFigureClashes,
  statedFigureAmountWords,
  statedFigureDateWords,
  statedFigurePeriod,
  StatedFigureSchema,
  statedFigureWords,
  WebFigureSourceSchema,
  webFigureWords,
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
    /**
     * A8: set only by the document-claims job (code, never the model: the
     * tool's input has no such field), when the figure was read from their
     * own document. `said` is then the document's own words.
     */
    document: DocumentFigureSourceSchema.optional(),
    /**
     * A8: set only by the research-claims job (code, never the model), when
     * the figure was read from a public page about their company. `said` is
     * then the page's own words; the record step checks them again.
     */
    web: WebFigureSourceSchema.optional(),
  })
  .strict()
  .refine((input) => input.document === undefined || input.web === undefined, {
    message: "A figure has one source.",
  });
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

/** A month's figure is dated its last day (one rule for every figure path). */
const asOfOf = statedFigurePeriod;

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

const DOCUMENT_NOTE =
  "Kept as your company's own figure, supported by that document, private to your company: investors don't see it. If it's wrong, dismiss this card and tell me the right figure.";

const WEB_NOTE =
  "If you confirm it, it's kept as your company's own figure (self-reported), with this page as its source, private to your company: investors don't see it. A public article is not verification. If it's wrong or out of date, dismiss this card.";

function outcomeWords(out: StatedFigureOutcome, input: RecordInput): string {
  const what = statedFigureWords(input.figure);
  const conflict =
    out.conflicts === 0
      ? ""
      : " A different figure is recorded for that date too: both are kept, marked as conflicting, until you settle it.";
  if (out.outcome === "ALREADY_RECORDED") {
    return `Your ${what} was already recorded, so nothing changed.${conflict}`;
  }
  if (input.web !== undefined) {
    return `Recorded your ${what} as your company's own figure (self-reported), with "${input.web.title}" kept as its source. It's private to your company; investors don't see it.${conflict}`;
  }
  return input.document === undefined
    ? `Recorded your ${what} as your own statement (self-reported). It's private to your company; investors don't see it.${conflict}`
    : `Recorded your ${what} as your company's figure, supported by "${input.document.title}". It's private to your company; investors don't see it.${conflict}`;
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
    input.web !== undefined
      ? recordWebFigure(ports.webFigures ?? portMissing("webFigures"), {
          actor: context.actor,
          companyId: input.companyId,
          figure: input.figure,
          web: input.web,
          correlationId: context.correlationId,
        })
      : input.document === undefined
        ? recordStatedFigure(figures(ports), {
            actor: context.actor,
            companyId: input.companyId,
            figure: input.figure,
            idempotencyKey: context.idempotencyKey,
            correlationId: context.correlationId,
          })
        : recordDocumentFigure(
            ports.documentFigures ?? portMissing("documentFigures"),
            {
              actor: context.actor,
              companyId: input.companyId,
              figure: input.figure,
              document: input.document,
              correlationId: context.correlationId,
            },
          ),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: (input) =>
    input.web !== undefined
      ? {
          summary: `Keep your ${webFigureWords(input.figure, input.web)}`,
          preview: `A public page (${input.web.url}) says: "${input.figure.said}". ${WEB_NOTE}${alongsideWords(input.alongside)}`,
        }
      : input.document === undefined
        ? {
            summary: `Record your ${statedFigureWords(input.figure)}`,
            preview: `You said: "${input.figure.said}". ${PRIVATE_NOTE}${alongsideWords(input.alongside)}`,
          }
        : {
            summary: `Keep your ${documentFigureWords(input.figure, input.document)}`,
            preview: `Your document says: "${input.figure.said}". ${DOCUMENT_NOTE}${alongsideWords(input.alongside)}`,
          },
  done: (out, input) => outcomeWords(out, input),
  tool: {
    name: "propose_company_figure",
    description:
      'For a founder, about their own company: whenever their message states a figure the company has reached -- MRR, ARR, revenue, burn, cash, runway, gross margin, customers, active users or churn, in any words or language, even in passing, as news, a reply or inside a question ("Good news: we hit $120k MRR in October") -- call this in that same turn to prepare it for their approval as their dated, self-reported figure. A correction ("Actually October MRR was $110k") is prepared the same way, even with another figure on record for that date: the card names it. Remembering what they said does not record it; only this card does. One figure per turn: prepare the first and say you\'ll record the next once they answer. Never for a figure you read in a document or found yourself, a target, a forecast or another company\'s figure. Nothing is recorded until they approve exactly this card: until then never say or imply it is recorded, corrected, kept or on file.',
    input: RecordTool,
    references: {},
    scopes: ["COMPANY_PROFILE"],
    // Their own company's turn; on any other the reader names it (focus).
    purposes: ["OWN_COMPANY_QUESTION"],
    // A figure they tell Q can come with any turn (live 13 Nov: news read
    // as an answer to Q): in reach on every turn that holds their company.
    offeredOnOwnTurns: true,
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

/** The approval type of a figure card: `app.<name>`. */
export const COMPANY_FIGURE_ACTION_TYPE = "app.company.figure.record";

/**
 * A8: the card input for a figure read from their own document, as the
 * document-claims job proposes it (code, after the extraction's checks).
 * What is already recorded for that metric and date is named on the card,
 * as in conversation. Null when it does not fit the declaration.
 */
async function alongsideFor(
  ports: AppActionPorts,
  actor: AppActionContext["actor"],
  companyId: string,
  figure: StatedFigure,
): Promise<string[]> {
  const { clashes } = await statedFigureClashes(
    figures(ports),
    actor,
    companyId,
    figure,
  ).catch(() => ({ clashes: [] }));
  return clashes.slice(0, 5).flatMap((claim) => {
    const stored = claim.structuredValue;
    const known = stored === null ? null : valueWords(stored);
    return known === null
      ? []
      : [`${known} ${statedFigureDateWords(figure.asOf)}`.slice(0, 120)];
  });
}

/**
 * A8: the card input for a figure read from a public page about their own
 * company, as the research-claims job proposes it (code, after the quote
 * check against the fetched page). Null when it does not fit.
 */
export async function webFigureCardInput(
  ports: AppActionPorts,
  actor: AppActionContext["actor"],
  proposal: {
    readonly companyId: string;
    readonly figure: StatedFigure;
    readonly web: z.input<typeof WebFigureSourceSchema>;
  },
): Promise<RecordInput | null> {
  const parsed = RecordFigure.safeParse({
    companyId: proposal.companyId,
    figure: proposal.figure,
    web: proposal.web,
    alongside: await alongsideFor(
      ports,
      actor,
      proposal.companyId,
      proposal.figure,
    ),
  });
  return parsed.success ? parsed.data : null;
}

export async function documentFigureCardInput(
  ports: AppActionPorts,
  actor: AppActionContext["actor"],
  proposal: {
    readonly companyId: string;
    readonly figure: StatedFigure;
    readonly document: z.input<typeof DocumentFigureSourceSchema>;
  },
): Promise<RecordInput | null> {
  const { clashes } = await statedFigureClashes(
    figures(ports),
    actor,
    proposal.companyId,
    proposal.figure,
  ).catch(() => ({ clashes: [] }));
  const parsed = RecordFigure.safeParse({
    companyId: proposal.companyId,
    figure: proposal.figure,
    document: proposal.document,
    alongside: clashes.slice(0, 5).flatMap((claim) => {
      const stored = claim.structuredValue;
      const known = stored === null ? null : valueWords(stored);
      return known === null
        ? []
        : [
            `${known} ${statedFigureDateWords(proposal.figure.asOf)}`.slice(
              0,
              120,
            ),
          ];
    }),
  });
  return parsed.success ? parsed.data : null;
}
