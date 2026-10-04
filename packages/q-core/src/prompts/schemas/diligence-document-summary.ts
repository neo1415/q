import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * DILIGENCE_DOCUMENT_SUMMARY — Q's one line on a document a founder shared
 * in diligence, for the investor who asked for it (founder critique
 * 2026-10-04: "Q is even supposed to be able to read the content of
 * whatever was uploaded so it can easily tell the requester").
 *
 * The Context Firewall for this line is the input: the shared version's own
 * extracted text and nothing else -- no company record, no private numbers,
 * no other document -- because the reader may see exactly that file and no
 * more. Figures are the document's claims, said as such.
 */

export const DILIGENCE_DOCUMENT_SUMMARY_SCHEMA_NAME =
  "DiligenceDocumentSummaryResult";
export const DILIGENCE_DOCUMENT_SUMMARY_SCHEMA_VERSION = 1;

export const DiligenceDocumentSummaryVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The file's title as the founder named it. UNTRUSTED. */
    title: z.string().max(200),
    /** Pages or slides read, when the reader counted them. Trusted. */
    pages: z.number().int().min(0).max(10_000).nullable(),
    /** The version's extracted text, in reading order. UNTRUSTED. */
    text: z.string().max(24_000),
  })
  .strict();
export type DiligenceDocumentSummaryVariables = z.infer<
  typeof DiligenceDocumentSummaryVariablesSchema
>;

export const DILIGENCE_DOCUMENT_SUMMARY_UNTRUSTED = ["title", "text"] as const;

export const DiligenceDocumentSummaryResultSchema = z
  .object({
    /** One line, at most ~160 characters, " · " between parts; null: unreadable. */
    summary: z.string().trim().min(3).max(200).nullable(),
  })
  .strict();
export type DiligenceDocumentSummaryResult = z.infer<
  typeof DiligenceDocumentSummaryResultSchema
>;
