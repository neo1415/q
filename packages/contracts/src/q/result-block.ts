import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";
import { QActionProposalSchema } from "./action.js";
import { QAnswerCardsBlockSchema, QMapSpecSchema } from "./answer-cards.js";
import { QArtifactStatusSchema, QArtifactTypeSchema } from "./artifact.js";
import { QArtifactIdSchema } from "./ids.js";
import { QUncertainConfidenceLevelSchema } from "./confidence.js";
import { QEvidenceRefsSchema } from "./evidence-ref.js";
import { QPublicFindingSchema } from "./finding.js";
import { QSubjectRefSchema } from "./subject.js";
import {
  Q_COMPARISON_SUBJECTS_MAX,
  Q_COMPARISON_SUBJECTS_MIN,
  QUiIntentSchema,
} from "./ui-intent.js";

/**
 * What Q returns: a bounded sequence of typed blocks, not one text blob
 * (doc 12 §44, §70; doc 22 §192).
 *
 * A block describes renderable meaning. It is never markup, never a
 * component, never code. TEXT is plain text: no HTML. A client may render
 * a safe Markdown subset as text nodes only (the web's `QMarkdown`: no
 * HTML, links only to http(s) or in-app paths), and a `<script>` inside it
 * is characters a client escapes like any other. Structured
 * meaning -- a company, a comparison, evidence, a finding, an action, a
 * navigation suggestion -- has its own kind with identifier or enum
 * parameters, so a client renders from types rather than parsing prose.
 *
 * Blocks carry references, not objects. A COMPANY_REFERENCE is an id the
 * client resolves under its own permissions; embedding the company here
 * would turn every Q response into a second, unguarded projection of the
 * company record.
 *
 * The union is closed and exhaustively discriminated. It evolves additively.
 */
export const Q_RESULT_BLOCK_KINDS = [
  "TEXT",
  "COMPANY_REFERENCE",
  "INVESTOR_REFERENCE",
  "COMPARISON",
  "COMPARISON_CARDS",
  "ANSWER_CARDS",
  "EVIDENCE",
  "FINDING",
  "UNCERTAINTY",
  "CLARIFICATION_REQUEST",
  "ACTION_PROPOSAL",
  "ARTIFACT_REFERENCE",
  "UI_INTENT",
  "PUBLIC_SOURCE",
  // RECOVERY-2026-10 E4: laid-out data, built by code from validated reads.
  "TABLE",
  "CHART",
  "MAP",
  "TIMELINE",
] as const;

export type QResultBlockKind = (typeof Q_RESULT_BLOCK_KINDS)[number];

export const QResultBlockKindSchema = z.enum(Q_RESULT_BLOCK_KINDS);

export const Q_TEXT_BLOCK_MAX_LENGTH = 16_000;

export const QTextBlockSchema = z
  .object({
    kind: z.literal("TEXT"),
    text: z.string().min(1).max(Q_TEXT_BLOCK_MAX_LENGTH),
  })
  .strict();

export const QCompanyReferenceBlockSchema = z
  .object({ kind: z.literal("COMPANY_REFERENCE"), companyId: UuidSchema })
  .strict();

export const QInvestorReferenceBlockSchema = z
  .object({
    kind: z.literal("INVESTOR_REFERENCE"),
    investorOrganisationId: UuidSchema,
  })
  .strict();

export const Q_COMPARISON_ROWS_MAX = 30;
export const Q_COMPARISON_LABEL_MAX_LENGTH = 120;
export const Q_COMPARISON_VALUE_MAX_LENGTH = 500;

/**
 * Subjects side by side across labelled rows. Every row has exactly one
 * plain-text value per subject, in subject order, so a client can lay the
 * grid out without interpreting anything. "Unknown" is a legitimate value;
 * an empty string is how a cell says so.
 */
export const QComparisonBlockSchema = z
  .object({
    kind: z.literal("COMPARISON"),
    subjects: z
      .array(QSubjectRefSchema)
      .min(Q_COMPARISON_SUBJECTS_MIN)
      .max(Q_COMPARISON_SUBJECTS_MAX),
    rows: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(Q_COMPARISON_LABEL_MAX_LENGTH),
            values: z.array(z.string().max(Q_COMPARISON_VALUE_MAX_LENGTH)),
          })
          .strict(),
      )
      .max(Q_COMPARISON_ROWS_MAX),
  })
  .strict()
  .refine(
    (block) =>
      block.rows.every((row) => row.values.length === block.subjects.length),
    {
      message: "every row carries exactly one value per subject",
      path: ["rows"],
    },
  );

/**
 * Named things side by side as cards (founder design 2026-09-28): a name,
 * a line under it, and the few points that matter for what was asked. The
 * names are the analyst's words, not resolved entities, so this is not a
 * COMPARISON over subject references. Never ordered, scored or ranked: the
 * cards are laid out in the order written and carry no verdict.
 */
export const QComparisonCardsBlockSchema = z
  .object({
    kind: z.literal("COMPARISON_CARDS"),
    title: z.string().trim().max(120).nullable(),
    items: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            subtitle: z.string().trim().max(120).nullable(),
            points: z.array(z.string().trim().min(1).max(160)).min(1).max(4),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();

export const QEvidenceBlockSchema = z
  .object({
    kind: z.literal("EVIDENCE"),
    evidenceRefs: QEvidenceRefsSchema.min(1),
  })
  .strict();

export const QFindingBlockSchema = z
  .object({ kind: z.literal("FINDING"), finding: QPublicFindingSchema })
  .strict();

export const Q_UNCERTAINTY_STATEMENT_MAX_LENGTH = 2000;
export const Q_UNCERTAINTY_MISSING_MAX = 10;
export const Q_UNCERTAINTY_MISSING_ITEM_MAX_LENGTH = 200;

/**
 * Q saying what it could not establish, and why. Confidence here can only
 * be an uncertain level; an uncertainty block claiming HIGH confidence would
 * be a contradiction the schema refuses. Absence of information is reported
 * as absence, never as a low score for the subject.
 */
export const QUncertaintyBlockSchema = z
  .object({
    kind: z.literal("UNCERTAINTY"),
    statement: z.string().trim().min(1).max(Q_UNCERTAINTY_STATEMENT_MAX_LENGTH),
    confidence: QUncertainConfidenceLevelSchema,
    /** What would resolve it, in plain terms: "a recent bank statement". */
    missing: z
      .array(
        z.string().trim().min(1).max(Q_UNCERTAINTY_MISSING_ITEM_MAX_LENGTH),
      )
      .max(Q_UNCERTAINTY_MISSING_MAX)
      .optional(),
  })
  .strict();

export const Q_CLARIFICATION_QUESTION_MAX_LENGTH = 1000;
export const Q_CLARIFICATION_OPTIONS_MIN = 2;
export const Q_CLARIFICATION_OPTIONS_MAX = 6;
export const Q_CLARIFICATION_OPTION_MAX_LENGTH = 200;

/** Q asking the person before proceeding (doc 12 §8.2; doc 22 §77). */
export const QClarificationRequestBlockSchema = z
  .object({
    kind: z.literal("CLARIFICATION_REQUEST"),
    question: z.string().trim().min(1).max(Q_CLARIFICATION_QUESTION_MAX_LENGTH),
    options: z
      .array(z.string().trim().min(1).max(Q_CLARIFICATION_OPTION_MAX_LENGTH))
      .min(Q_CLARIFICATION_OPTIONS_MIN)
      .max(Q_CLARIFICATION_OPTIONS_MAX)
      .optional(),
  })
  .strict();

export const QActionProposalBlockSchema = z
  .object({
    kind: z.literal("ACTION_PROPOSAL"),
    proposal: QActionProposalSchema,
  })
  .strict();

/**
 * Something Q composed, referred to from the answer that composed it.
 *
 * A reference and a label, like every other reference block: enough to
 * render a card and open it, never the content. The status is here because
 * a card for an artifact still being prepared has to say so, and the
 * browser must not have to guess from an absence.
 */
export const QArtifactReferenceBlockSchema = z
  .object({
    kind: z.literal("ARTIFACT_REFERENCE"),
    artifactId: QArtifactIdSchema,
    type: QArtifactTypeSchema,
    status: QArtifactStatusSchema,
    title: z.string().trim().min(1).max(160),
  })
  .strict();

/**
 * A document tool's own result when it filed a new version of one of the
 * person's documents (`revise_my_document`). The answer path turns exactly
 * this -- a tool's authorised result, never a model's words -- into the
 * document's card on the answer, so the new version is one tap away.
 */
export const QDocumentToolResultSchema = z
  .object({
    status: z.literal("DOCUMENT_UPDATED"),
    document: z
      .object({
        artifactId: QArtifactIdSchema,
        type: QArtifactTypeSchema,
        status: QArtifactStatusSchema,
        title: z.string().trim().min(1).max(160),
        currentVersion: z.number().int().min(1),
      })
      .strict(),
    /**
     * Q room W5: the slide `edit_my_document` changed (1-based), so the
     * room's viewer goes to it; and whether this was the same edit again
     * (the version it already made, nothing new written).
     */
    slide: z.number().int().min(1).max(24).optional(),
    replayed: z.boolean().optional(),
  })
  .strict();
export type QDocumentToolResult = z.infer<typeof QDocumentToolResultSchema>;

export const QUiIntentBlockSchema = z
  .object({ kind: z.literal("UI_INTENT"), intent: QUiIntentSchema })
  .strict();

/**
 * A public web page Q read for this answer (R23, R38). The answer is said
 * first; the page sits behind the Sources disclosure with the only fields
 * a person needs to judge and follow it. Unlike the reference blocks this
 * carries the page's public fields rather than an id: it is a public URL,
 * not a guarded record, and there is nothing for a client to resolve. It
 * is unverified by definition -- a public source is never a verified fact.
 */
export const QPublicSourceBlockSchema = z
  .object({
    kind: z.literal("PUBLIC_SOURCE"),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value), {
        message: "a public source is an http(s) page",
      }),
    domain: z.string().trim().min(1).max(253),
    /** The page title, or the domain when the page had none. */
    title: z.string().trim().min(1).max(160),
    /** YYYY-MM-DD when the page was dated; otherwise null. */
    publishedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    /** YYYY-MM-DD when Capital Q read it. */
    retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

// ---------------------------------------------------------------------------
// RECOVERY-2026-10 E4: tables, charts, maps and timelines.
//
// The model may choose that an answer is best shown as one of these; what
// goes in one is never the model's words. Producers build them from the
// run's authorised reads (tool results, platform records), and these
// schemas refuse what must never be drawn: a chart of inferred numbers, a
// place that is not a country code, a timeline out of time order.

export const Q_TABLE_COLUMNS_MAX = 8;
export const Q_TABLE_ROWS_MAX = 30;
/**
 * Rows of plain-text cells under named columns. A column may carry the
 * record it is about, so its header opens it. An empty cell is how the
 * contract says "not known" (never a zero, never a dash).
 */
export const QTableBlockSchema = z
  .object({
    kind: z.literal("TABLE"),
    title: z.string().trim().min(1).max(120),
    columns: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(80),
            subject: QSubjectRefSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(Q_TABLE_COLUMNS_MAX),
    rows: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(Q_COMPARISON_LABEL_MAX_LENGTH),
            cells: z.array(z.string().max(Q_COMPARISON_VALUE_MAX_LENGTH)),
          })
          .strict(),
      )
      .min(1)
      .max(Q_TABLE_ROWS_MAX),
  })
  .strict()
  .refine(
    (block) =>
      block.rows.every((row) => row.cells.length === block.columns.length),
    {
      message: "every row carries exactly one cell per column",
      path: ["rows"],
    },
  );

const CHARTABLE_CLAIM_EVIDENCE: ReadonlySet<string> = new Set([
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
]);

/**
 * Whether a series may be drawn: verified figures, or a claim backed by a
 * document or better (shown labelled as the claim it is). Never an
 * inference, an estimate, an unknown, or a bare self-report: a line on a
 * chart reads as fact, so only what is evidenced earns one.
 */
export function chartableSeries(series: {
  readonly truthClass: string;
  readonly evidenceStatus: string;
}): boolean {
  if (series.evidenceStatus === "NO_EVIDENCE") return false;
  if (series.truthClass === "VERIFIED") return true;
  return (
    series.truthClass === "USER_CLAIM" &&
    CHARTABLE_CLAIM_EVIDENCE.has(series.evidenceStatus)
  );
}

export const Q_RESULT_CHART_SERIES_MAX = 4;
export const Q_RESULT_CHART_POINTS_MAX = 24;
export const QChartBlockSchema = z
  .object({
    kind: z.literal("CHART"),
    chart: z.enum(["BAR", "LINE"]),
    title: z.string().trim().min(1).max(120),
    /** What the numbers count ("customers", "a month"). */
    unit: z.string().trim().min(1).max(40),
    /** ISO 4217 when the values are money; null otherwise. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable(),
    series: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(60),
            truthClass: TruthClassSchema,
            evidenceStatus: EvidenceStatusSchema,
            /** Where the figures come from, said under the chart. */
            source: z.string().trim().min(1).max(160),
            points: z
              .array(
                z
                  .object({
                    label: z.string().trim().min(1).max(40),
                    value: z.number().finite(),
                  })
                  .strict(),
              )
              .min(1)
              .max(Q_RESULT_CHART_POINTS_MAX),
          })
          .strict()
          .refine(chartableSeries, {
            message:
              "only verified figures, or claims backed by a document or better, are charted",
          }),
      )
      .min(1)
      .max(Q_RESULT_CHART_SERIES_MAX),
  })
  .strict();

/** Where the answer's subjects are, at country level (QMapSpec). */
export const QMapBlockSchema = z
  .object({ kind: z.literal("MAP"), ...QMapSpecSchema.shape })
  .strict();

export const Q_TIMELINE_EVENTS_MAX = 20;
const TIMELINE_AT = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  z.string().datetime({ offset: true }),
]);
/**
 * Dated events, oldest first. Code orders them (the schema refuses any
 * other order), so a timeline never misstates what came first.
 */
export const QTimelineBlockSchema = z
  .object({
    kind: z.literal("TIMELINE"),
    title: z.string().trim().min(1).max(120),
    events: z
      .array(
        z
          .object({
            at: TIMELINE_AT,
            label: z.string().trim().min(1).max(120),
            detail: z.string().trim().max(240).nullable(),
            subject: QSubjectRefSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(Q_TIMELINE_EVENTS_MAX),
  })
  .strict()
  .refine(
    (block) =>
      block.events.every((event, index) => {
        const before = block.events[index - 1];
        return (
          before === undefined || Date.parse(before.at) <= Date.parse(event.at)
        );
      }),
    { message: "events are in time order, oldest first", path: ["events"] },
  );

export const QResultBlockSchema = z.discriminatedUnion("kind", [
  QTextBlockSchema,
  QCompanyReferenceBlockSchema,
  QInvestorReferenceBlockSchema,
  QComparisonBlockSchema,
  QComparisonCardsBlockSchema,
  QAnswerCardsBlockSchema,
  QEvidenceBlockSchema,
  QFindingBlockSchema,
  QUncertaintyBlockSchema,
  QClarificationRequestBlockSchema,
  QActionProposalBlockSchema,
  QArtifactReferenceBlockSchema,
  QUiIntentBlockSchema,
  QPublicSourceBlockSchema,
  QTableBlockSchema,
  QChartBlockSchema,
  QMapBlockSchema,
  QTimelineBlockSchema,
]);

export type QResultBlock = z.infer<typeof QResultBlockSchema>;

/** Blocks per message or run summary. A V1 technical bound. */
export const Q_RESULT_BLOCKS_MAX = 50;

export const QResultBlocksSchema = z
  .array(QResultBlockSchema)
  .max(Q_RESULT_BLOCKS_MAX);

/** One block that did not satisfy the contract, and why (never its content). */
export type QResultBlockDrop = {
  readonly index: number;
  /** The kind it claimed, when it named a known one. */
  readonly kind: QResultBlockKind | null;
  readonly issue: string;
};

function claimedKind(candidate: unknown): QResultBlockKind | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const known = QResultBlockKindSchema.safeParse(
    (candidate as { readonly kind?: unknown }).kind,
  );
  return known.success ? known.data : null;
}

/**
 * RECOVERY-2026-10 E3 (audit E-07): blocks are validated one by one. An
 * invalid block is dropped on its own and reported, so one bad card never
 * takes an answer's findings, references and other cards with it. What is
 * kept is exactly what the closed union accepts; nothing is repaired.
 */
export function parseQResultBlocks(value: unknown): {
  readonly blocks: QResultBlock[];
  readonly dropped: readonly QResultBlockDrop[];
} {
  if (value === null || value === undefined) return { blocks: [], dropped: [] };
  if (!Array.isArray(value)) {
    return {
      blocks: [],
      dropped: [{ index: -1, kind: null, issue: "not a list of blocks" }],
    };
  }
  const blocks: QResultBlock[] = [];
  const dropped: QResultBlockDrop[] = [];
  value.forEach((candidate: unknown, index) => {
    if (blocks.length >= Q_RESULT_BLOCKS_MAX) {
      dropped.push({
        index,
        kind: claimedKind(candidate),
        issue: "over the block limit",
      });
      return;
    }
    const parsed = QResultBlockSchema.safeParse(candidate);
    if (parsed.success) {
      blocks.push(parsed.data);
      return;
    }
    const first = parsed.error.issues[0];
    const where = first?.path.map(String).join(".") ?? "";
    dropped.push({
      index,
      kind: claimedKind(candidate),
      issue: (first === undefined
        ? "invalid"
        : `${where.length > 0 ? where : "(block)"}: ${first.message}`
      ).slice(0, 200),
    });
  });
  return { blocks, dropped };
}
