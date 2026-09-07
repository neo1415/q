import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { QActionProposalSchema } from "./action.js";
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
 * component, never code. TEXT is plain text: no HTML, no Markdown contract
 * (no sanitising renderer exists yet, so none is promised), and a `<script>`
 * inside it is characters a client escapes like any other. Structured
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
  "EVIDENCE",
  "FINDING",
  "UNCERTAINTY",
  "CLARIFICATION_REQUEST",
  "ACTION_PROPOSAL",
  "UI_INTENT",
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

export const QUiIntentBlockSchema = z
  .object({ kind: z.literal("UI_INTENT"), intent: QUiIntentSchema })
  .strict();

export const QResultBlockSchema = z.discriminatedUnion("kind", [
  QTextBlockSchema,
  QCompanyReferenceBlockSchema,
  QInvestorReferenceBlockSchema,
  QComparisonBlockSchema,
  QEvidenceBlockSchema,
  QFindingBlockSchema,
  QUncertaintyBlockSchema,
  QClarificationRequestBlockSchema,
  QActionProposalBlockSchema,
  QUiIntentBlockSchema,
]);

export type QResultBlock = z.infer<typeof QResultBlockSchema>;

/** Blocks per message or run summary. A V1 technical bound. */
export const Q_RESULT_BLOCKS_MAX = 50;

export const QResultBlocksSchema = z
  .array(QResultBlockSchema)
  .max(Q_RESULT_BLOCKS_MAX);
