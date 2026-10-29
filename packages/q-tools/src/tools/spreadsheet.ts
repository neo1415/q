import { z } from "zod";

import {
  FIT_BAND_LABELS,
  FIT_OUTCOME_LABELS,
  fitScoreOutOf10,
  MoneySchema,
  Q_TASK_CLASSES,
  QArtifactIdSchema,
  QArtifactStatusSchema,
  QArtifactTypeSchema,
  UuidSchema,
  type PermittedContextPlan,
  type QArtifactContent,
  type QResultBlock,
  type QSubjectRef,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
  type QToolAuthorization,
} from "../definition.js";
import { actorWideScope, scopesOfKind } from "../plan.js";
import type { QToolPorts } from "../ports.js";
import { createReadCompanyFiguresTool } from "./company-figures.js";
import { createGetInvestorMandateTool } from "./get-investor-mandate.js";
import {
  buildComparisonCardsSheet,
  buildComparisonSheet,
  buildFiguresSheet,
  buildPipelineSheet,
  buildRankedSheet,
  buildTableSheet,
  PIPELINE_FIT_COLUMNS,
  spreadsheetReceipt,
  spreadsheetSections,
  type BuiltSpreadsheet,
  type FigureInput,
  type PipelineFit,
  type PipelineFitJoin,
  type SheetChoice,
} from "./spreadsheet-build.js";

/**
 * make_spreadsheet (XLSX-001): "an Excel of my pipeline", "put that in a
 * spreadsheet", "a sheet of their figures".
 *
 * The turn's reader decides by meaning which typed data the person wants
 * (`source`) -- there is no phrase list here -- and code does the rest:
 * reads the records as the person (their relationships; a company's
 * figures exactly as read_company_figures admits them; or a table,
 * comparison or ranked list Q already showed them in this conversation),
 * writes every cell from typed fields (spreadsheet-build.ts), and files
 * the result as their own private SPREADSHEET document. Its card rides on
 * the answer through the same document-tool result as revise_my_document,
 * with Excel and CSV downloads. The model may only name the sheet and
 * pick among the builder's columns; it never supplies a value.
 *
 * Writing their own private document is INSTANT, like preparing one (ADR
 * 0013 puts the consequential boundary at share and send).
 */

export const MAKE_SPREADSHEET = "documents.own.spreadsheet" as const;
export const SPREADSHEET_ARTIFACT_TYPE = "SPREADSHEET" as const;

export const SPREADSHEET_SOURCES = [
  "PIPELINE",
  "COMPANY_FIGURES",
  "SHOWN_TABLE",
  "SHOWN_COMPARISON",
  "SHOWN_RANKED_LIST",
] as const;

/** One of Q's earlier answers in this conversation, newest first. */
export type ShownAnswer = {
  readonly messageId: string;
  readonly blocks: readonly QResultBlock[];
};

export type SpreadsheetPort = {
  /**
   * Q's answers in the conversation of this run, newest first, read as
   * the run's owner (another person's conversation is not found).
   */
  readonly shownAnswers: (
    actor: ActorContext,
    runId: string,
  ) => Promise<readonly ShownAnswer[]>;
  /** Names of record subjects as this reader may see them; absent ids are left out. */
  readonly subjectNames?:
    | ((
        actor: ActorContext,
        subjects: readonly QSubjectRef[],
      ) => Promise<ReadonlyMap<string, string>>)
    | undefined;
  /** File it as the person's own private document. */
  readonly file: (input: {
    readonly actor: ActorContext;
    readonly runId: string;
    readonly title: string;
    readonly summary: string;
    readonly content: QArtifactContent;
  }) => Promise<{
    readonly artifactId: string;
    readonly type: string;
    readonly status: string;
    readonly title: string;
    readonly currentVersion: number;
  }>;
  /** YYYY-MM-DD; absent: the server's UTC date. */
  readonly today?: (() => string) | undefined;
};

export const MakeSpreadsheetInputSchema = z
  .object({
    source: z
      .enum(SPREADSHEET_SOURCES)
      .describe(
        "Which data, by what they mean: PIPELINE = their own relationships (and saved/passed companies); COMPANY_FIGURES = one company's stated figures (needs companyId); SHOWN_TABLE / SHOWN_COMPARISON / SHOWN_RANKED_LIST = the table, side-by-side comparison or ranked list you already showed them in this conversation ('put that in Excel').",
      ),
    companyId: UuidSchema.optional().describe(
      "COMPANY_FIGURES only: the company's id, as given in the conversation context.",
    ),
    sheetName: z
      .string()
      .trim()
      .max(31)
      .optional()
      .describe("Optional name for the sheet, in their words."),
    withFit: z
      .boolean()
      .optional()
      .describe(
        "PIPELINE only: true when they want how each company fits their mandate in it (mandate fit, cheque fit, stage fit, the round against their cheque), by what they mean in any words. Capital Q joins the fit it computes; you never write a fit.",
      ),
    columns: z
      .array(z.string().trim().min(1).max(40))
      .max(24)
      .optional()
      .describe(
        "Optional: keep only these columns. PIPELINE: counterparty, kind, stage, since, nextStep, lastMessageFrom, lastMessageOn, and with fit: fitScore, fitBand, chequeFit, chequeFitWhy, stageFit, round, chequeFrom, chequeTo, fitReasons. COMPANY_FIGURES: figure, statement, amount, number, percent, asOf, truthClass, evidence. SHOWN_RANKED_LIST: rank, name, line, raise, fit, measured, reasons, view. Omit for all.",
      ),
  })
  .strict()
  .refine(
    (input) =>
      (input.source === "COMPANY_FIGURES") === (input.companyId !== undefined),
    { message: "companyId is for COMPANY_FIGURES, and only for it" },
  )
  .refine((input) => input.withFit !== true || input.source === "PIPELINE", {
    message: "withFit is for PIPELINE",
  });
export type MakeSpreadsheetInput = z.infer<typeof MakeSpreadsheetInputSchema>;

const SpreadsheetDocumentSchema = z
  .object({
    artifactId: QArtifactIdSchema,
    type: QArtifactTypeSchema,
    status: QArtifactStatusSchema,
    title: z.string().trim().min(1).max(160),
    currentVersion: z.number().int().min(1),
  })
  .strict();

/**
 * `says`: Capital Q's own line for the reply, written by code from what
 * was built (live 2026-10-28: the reply was only an offer). The answer
 * path says it whatever the model writes; the model adds at most one offer.
 */
const SaysSchema = z.string().trim().min(1).max(900);

export const MakeSpreadsheetOutputSchema = z.discriminatedUnion("status", [
  // The same shape as revise_my_document's, so the answer carries the
  // spreadsheet's card (QDocumentToolResultSchema).
  z
    .object({
      status: z.literal("DOCUMENT_UPDATED"),
      document: SpreadsheetDocumentSchema,
      says: SaysSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.enum(["NOTHING_TO_PUT_IN_IT", "FAILED"]),
      says: SaysSchema.optional(),
    })
    .strict(),
]);

/** The fit reads whose call in this turn means the ask is about fit. */
const FIT_READS: ReadonlySet<string> = new Set([
  "fit_profile",
  "fit_top_candidates",
  "fit_compare",
]);
const FIT_KEYS: ReadonlySet<string> = new Set(
  PIPELINE_FIT_COLUMNS.map((column) => column.key),
);

export const SPREADSHEET_NOTHING_LINE =
  "There's nothing of that kind on your record to put in a spreadsheet, so I haven't made one.";
export const SPREADSHEET_FAILED_LINE =
  "I couldn't file the spreadsheet just now. Ask me again in a moment and I'll make it.";

/** get_investor_mandate's own output, as far as the sheet reads it. */
const ChequeReadSchema = z.object({
  mandates: z.array(
    z.object({
      cheque: z
        .object({
          currency: z.string(),
          min: z.string().optional(),
          max: z.string().optional(),
        })
        .nullable(),
    }),
  ),
});

/** The fit service reads at most FIT_IDS_MAX companies a call. */
const FIT_BATCH = 50;

const FIT_NOT_AVAILABLE: Readonly<Record<string, string>> = {
  NOT_INVESTOR: "fit with a mandate is for investors",
  NO_MANDATE: "there is no active mandate to measure fit against yet",
  NOT_AVAILABLE: "fit could not be read just now",
};
export type MakeSpreadsheetOutput = z.infer<typeof MakeSpreadsheetOutputSchema>;

type FitItem = Extract<
  Awaited<ReturnType<NonNullable<QToolPorts["fit"]>["profiles"]>>,
  { kind: "OK" }
>["items"][number];

/** One company's fit, in the words every fit surface uses. */
function pipelineFitOf(item: FitItem): PipelineFit {
  const profile = item.assessment.profile;
  const row = (parameter: "CHEQUE_SIZE" | "STAGE") => {
    const found = profile.parameters.find((one) => one.parameter === parameter);
    if (found === undefined) return null;
    return {
      // UNKNOWN is blank (not known), never a word that reads as a verdict.
      outcome:
        found.outcome === "UNKNOWN" ? null : FIT_OUTCOME_LABELS[found.outcome],
      reason: found.reason,
    };
  };
  const round = MoneySchema.safeParse(item.raise ?? null);
  return {
    score: fitScoreOutOf10(profile),
    band: FIT_BAND_LABELS[profile.band],
    cheque: row("CHEQUE_SIZE"),
    stage: row("STAGE"),
    reasons: profile.topReasons.map((reason) => reason.reason),
    round: round.success ? round.data : null,
  };
}

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

/** The newest block of `kind` Q showed, with the answer it was in. */
function newestShown<K extends QResultBlock["kind"]>(
  answers: readonly ShownAnswer[],
  kind: K,
): { block: Extract<QResultBlock, { kind: K }>; messageId: string } | null {
  for (const answer of answers) {
    const block = answer.blocks.find(
      (one): one is Extract<QResultBlock, { kind: K }> => one.kind === kind,
    );
    if (block !== undefined) return { block, messageId: answer.messageId };
  }
  return null;
}

type Grant = { readonly figures: unknown } | null;

/** read_company_figures' own output, as far as the sheet reads it. */
const FiguresReadSchema = z.object({
  figures: z.array(
    z.object({
      key: z.string(),
      statement: z.string(),
      value: z.record(z.string(), z.unknown()).nullable(),
      asOf: z.string().nullable(),
      truthClass: z.string(),
      evidenceStatus: z.string(),
    }),
  ),
}) satisfies z.ZodType<{ readonly figures: readonly FigureInput[] }>;

export function createMakeSpreadsheetTool(
  ports: QToolPorts,
  spreadsheet: SpreadsheetPort,
): AnyQToolDefinition {
  // Company figures are admitted exactly as read_company_figures admits
  // them: its own authorize step decides, and its own execute reads.
  const figuresTool =
    ports.companyFigures === undefined
      ? undefined
      : createReadCompanyFiguresTool({
          ...ports,
          companyFigures: ports.companyFigures,
        });
  const today = () =>
    spreadsheet.today?.() ?? new Date().toISOString().slice(0, 10);
  // Their cheque range is read exactly as get_investor_mandate reads it:
  // its own authorize step (their own organisation only) decides.
  const mandateTool = createGetInvestorMandateTool(ports);

  /** Their declared cheque range, as money; null when not readable. */
  const chequeOf = async (
    context: Parameters<AnyQToolDefinition["execute"]>[1],
  ): Promise<Extract<PipelineFitJoin, { kind: "JOINED" }>["cheque"]> => {
    const scope = scopesOfKind(context.plan, "INVESTOR_MANDATE").find(
      (one) =>
        one.subject?.kind === "INVESTOR_ORGANISATION" &&
        one.filter.investorOrganisationId !== undefined,
    );
    const investorOrganisationId = scope?.filter.investorOrganisationId;
    if (investorOrganisationId === undefined) return null;
    const args = { investorOrganisationId };
    const decided = await mandateTool.authorize(args, context);
    if (decided.outcome !== "ALLOW") return null;
    const read = ChequeReadSchema.safeParse(
      await mandateTool.execute(args, context, decided.grant),
    );
    const cheque = read.success ? read.data.mandates[0]?.cheque : null;
    if (cheque === null || cheque === undefined) return null;
    const asMoney = (amount: string | undefined) => {
      const parsed = MoneySchema.safeParse({
        amount,
        currency: cheque.currency,
      });
      return parsed.success ? parsed.data : null;
    };
    return { from: asMoney(cheque.min), to: asMoney(cheque.max) };
  };

  /**
   * Fit with their mandate for the companies in their pipeline, joined on
   * the company id (live 2026-10-28: "cheque fit" was asked for and left
   * out). Read through the fit service as this actor, under the same
   * network scope the fit tools need; what it cannot read is said, never
   * guessed.
   */
  const fitJoin = async (
    context: Parameters<AnyQToolDefinition["execute"]>[1],
    side: "INVESTOR" | "COMPANY" | "NONE",
    companyIds: readonly string[],
  ): Promise<PipelineFitJoin> => {
    const fit = ports.fit;
    if (side === "COMPANY") {
      return {
        kind: "NOT_AVAILABLE",
        detail: FIT_NOT_AVAILABLE.NOT_INVESTOR ?? "",
      };
    }
    if (
      fit === undefined ||
      actorWideScope(context.plan, "NETWORK_VISIBLE_DATA") === undefined
    ) {
      return {
        kind: "NOT_AVAILABLE",
        detail: FIT_NOT_AVAILABLE.NOT_AVAILABLE ?? "",
      };
    }
    const byCompany = new Map<string, PipelineFit>();
    for (let at = 0; at < companyIds.length; at += FIT_BATCH) {
      const result = await fit
        .profiles(context.actor, companyIds.slice(at, at + FIT_BATCH))
        .catch(() => null);
      if (result === null || result.kind !== "OK") {
        return {
          kind: "NOT_AVAILABLE",
          detail:
            FIT_NOT_AVAILABLE[result?.kind ?? "NOT_AVAILABLE"] ??
            FIT_NOT_AVAILABLE.NOT_AVAILABLE ??
            "",
        };
      }
      for (const item of result.items) {
        byCompany.set(item.assessment.profile.companyId, pipelineFitOf(item));
      }
    }
    return {
      kind: "JOINED",
      byCompany,
      cheque: await chequeOf(context).catch(() => null),
    };
  };

  return defineQTool<MakeSpreadsheetInput, MakeSpreadsheetOutput, Grant>({
    id: MAKE_SPREADSHEET,
    version: 1,
    status: "ACTIVE",
    // Not core (the always-on set is at the model's tool bound): offered
    // where the turn is about documents, and whenever the reader names it.
    providerName: "make_spreadsheet",
    description:
      "Makes a real Excel spreadsheet (.xlsx, also CSV) of their data and files it as their own private document with a download card: their pipeline, one company's stated figures, or a table, comparison or ranked list you already showed them in this conversation. Call it whenever they ask for a spreadsheet, an Excel, a sheet or a CSV of something. Code writes every cell from their records; you choose only the source, an optional sheet name and columns (and withFit for a pipeline with mandate or cheque fit). The result's `says` is Capital Q's own line -- what was made and what could not be filled -- and is said to them as written: do not repeat or restate it; add at most one short offer, or nothing. NOTHING_TO_PUT_IN_IT: there is no such data (never invent rows).",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    // Every purpose but ACTION_PREPARATION, whose unfocused offer is at the
    // model's bound; named by the turn's reader, it is offered on any.
    supportedPurposes: Q_TASK_CLASSES.filter(
      (purpose) => purpose !== "ACTION_PREPARATION",
    ),
    eligibleWhenNamed: true,
    // Offered after each purpose's own tools: unfocused, it is the one the
    // model's bound cuts; named, or in the documents area, it leads.
    offerLast: true,
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "PREPARING_DOCUMENT",
    input: MakeSpreadsheetInputSchema,
    output: MakeSpreadsheetOutputSchema,
    authorize: async (input, context): Promise<QToolAuthorization<Grant>> => {
      if (!ownConversation(context.actor, context.plan)) {
        return deny("NOT_AVAILABLE");
      }
      if (input.source !== "COMPANY_FIGURES") {
        return allow("CONFIDENTIAL", null);
      }
      if (figuresTool === undefined || input.companyId === undefined) {
        return deny("NOT_AVAILABLE");
      }
      const decided = await figuresTool.authorize(
        { companyId: input.companyId },
        context,
      );
      return decided.outcome === "ALLOW"
        ? allow(decided.sensitivity, { figures: decided.grant })
        : deny(decided.code, decided.safeMessage);
    },
    execute: async (input, context, grant) => {
      const choice: SheetChoice = {
        sheetName: input.sheetName,
        columns: input.columns,
      };
      const day = today();
      const built = await (async (): Promise<BuiltSpreadsheet | null> => {
        switch (input.source) {
          case "PIPELINE": {
            const own = await ports.relationships?.ownRelationships?.(
              context.actor,
            );
            const decisions =
              own?.side === "COMPANY" || ports.investorFeed === undefined
                ? []
                : await ports.investorFeed
                    .decisions(context.actor, 100)
                    .catch(() => []);
            // Fit is joined when they asked for it (the reader's call, or
            // a fit column named) or this turn read fit already.
            const wantFit =
              input.withFit === true ||
              (input.columns ?? []).some((key) => FIT_KEYS.has(key)) ||
              (context.focus?.tools ?? []).some((name) => FIT_READS.has(name));
            const items = own?.items ?? [];
            const fit = wantFit
              ? await fitJoin(context, own?.side ?? "NONE", [
                  ...new Set(
                    items
                      .filter((item) => item.counterpart.kind === "COMPANY")
                      .map((item) => item.counterpart.id),
                  ),
                ])
              : undefined;
            return buildPipelineSheet(
              {
                side: own?.side ?? "NONE",
                relationships: items,
                decisions,
                today: day,
                fit,
              },
              choice,
            );
          }
          case "COMPANY_FIGURES": {
            if (
              figuresTool === undefined ||
              input.companyId === undefined ||
              grant === null
            ) {
              return null;
            }
            const read = FiguresReadSchema.parse(
              await figuresTool.execute(
                { companyId: input.companyId },
                context,
                grant.figures,
              ),
            );
            const profile = await ports.companies.findCanonicalCompanyProfile(
              CompanyIdSchema.parse(input.companyId),
            );
            return buildFiguresSheet(
              {
                companyId: input.companyId,
                companyName: profile?.canonicalName ?? "The company",
                figures: read.figures,
                today: day,
              },
              choice,
            );
          }
          case "SHOWN_TABLE":
          case "SHOWN_COMPARISON":
          case "SHOWN_RANKED_LIST": {
            const answers = await spreadsheet.shownAnswers(
              context.actor,
              context.runId,
            );
            if (input.source === "SHOWN_TABLE") {
              const shown = newestShown(answers, "TABLE");
              return shown === null
                ? null
                : buildTableSheet(
                    shown.block,
                    { messageId: shown.messageId, today: day },
                    choice,
                  );
            }
            if (input.source === "SHOWN_RANKED_LIST") {
              const shown = newestShown(answers, "ANSWER_CARDS");
              return shown === null
                ? null
                : buildRankedSheet(
                    shown.block,
                    { messageId: shown.messageId, today: day },
                    choice,
                  );
            }
            const shown = newestShown(answers, "COMPARISON");
            if (shown === null) {
              // Named things set side by side as cards are a comparison too.
              const cards = newestShown(answers, "COMPARISON_CARDS");
              return cards === null
                ? null
                : buildComparisonCardsSheet(
                    cards.block,
                    { messageId: cards.messageId, today: day },
                    choice,
                  );
            }
            const names =
              (await spreadsheet
                .subjectNames?.(context.actor, shown.block.subjects)
                .catch(() => undefined)) ?? new Map<string, string>();
            return buildComparisonSheet(
              shown.block,
              { names, messageId: shown.messageId, today: day },
              choice,
            );
          }
        }
      })();
      if (built === null) {
        return {
          status: "NOTHING_TO_PUT_IN_IT",
          says: SPREADSHEET_NOTHING_LINE,
        };
      }
      const filed = await spreadsheet.file({
        actor: context.actor,
        runId: context.runId,
        title: built.title,
        summary: built.summary,
        content: {
          sections: spreadsheetSections(built),
          gaps: [...built.gaps],
          workbook: built.workbook,
        },
      });
      const document = SpreadsheetDocumentSchema.safeParse({
        ...filed,
        title: filed.title.slice(0, 160),
      });
      return document.success
        ? {
            status: "DOCUMENT_UPDATED",
            document: document.data,
            says: spreadsheetReceipt(built),
          }
        : { status: "FAILED", says: SPREADSHEET_FAILED_LINE };
    },
  });
}
