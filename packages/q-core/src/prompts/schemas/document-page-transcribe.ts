import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * DOCUMENT_PAGE_TRANSCRIBE (deck reading 2026-10-28): the text on pages a
 * PDF's text layer does not carry (a scanned deck, a slide exported as one
 * picture) or on an uploaded PNG/JPEG. The page images ride on the
 * messages; the model writes down what is printed, verbatim, and nothing
 * else. What it writes is recorded as TRANSCRIBED text with that
 * provenance, never as the document's own text layer.
 */

export const DOCUMENT_PAGE_TRANSCRIBE_SCHEMA_NAME =
  "DocumentPageTranscribeResult";
export const DOCUMENT_PAGE_TRANSCRIBE_SCHEMA_VERSION = 1;
/** Pages in one request; the caller batches a document's pages. */
export const DOCUMENT_PAGE_TRANSCRIBE_PAGES_PER_REQUEST = 4;
/** One page's transcription, matching the extraction's block bound. */
export const DOCUMENT_PAGE_TRANSCRIBE_TEXT_MAX = 8_000;

export const DocumentPageTranscribeVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The page numbers of the attached images, in order. TRUSTED. */
    pageNumbers: z.string().min(1).max(400),
  })
  .strict();
export type DocumentPageTranscribeVariables = z.infer<
  typeof DocumentPageTranscribeVariablesSchema
>;

/** Nothing the variables carry comes from the document; the images do. */
export const DOCUMENT_PAGE_TRANSCRIBE_UNTRUSTED = [] as const;

export const DocumentPageTranscribeResultSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(10_000),
            /** Verbatim text, in reading order; empty when there is none. */
            text: z.string().max(DOCUMENT_PAGE_TRANSCRIBE_TEXT_MAX),
            /** False when the page has text that cannot be read reliably. */
            legible: z.boolean(),
            /** The main language's BCP 47 tag ("en", "fr", "ar"), if any. */
            language: z
              .string()
              .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/)
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .max(DOCUMENT_PAGE_TRANSCRIBE_PAGES_PER_REQUEST),
  })
  .strict();
export type DocumentPageTranscribeResult = z.infer<
  typeof DocumentPageTranscribeResultSchema
>;
