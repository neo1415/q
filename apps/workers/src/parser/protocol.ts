import { z } from "zod";

/**
 * The wire between the orchestrator and the parser sandbox (doc 15 §28).
 *
 * Deliberately tiny. The parent hands the child a directory it created and
 * nothing else; the child answers with one JSON line. Nothing in either
 * direction is interpolated into a command line, so no filename, MIME type or
 * document byte ever reaches a shell.
 *
 * The child is told about a file. It is never told about a tenant, a document,
 * a source, a user or a bucket — it cannot leak an identifier it was never
 * given.
 */

export const PARSER_REQUEST_FILE = "request.json" as const;
export const PARSER_INPUT_FILE = "input.bin" as const;

export const ParserLimitsSchema = z
  .object({
    maxEntries: z.number().int().min(1),
    maxEntryBytes: z.number().int().min(1),
    maxExpandedBytes: z.number().int().min(1),
    maxExpansionRatio: z.number().min(1),
    maxBlocks: z.number().int().min(1),
    maxBlockCharacters: z.number().int().min(1),
    maxTotalCharacters: z.number().int().min(1),
    maxPages: z.number().int().min(1),
    maxSlides: z.number().int().min(1),
    maxXmlNodes: z.number().int().min(1),
    maxXmlDepth: z.number().int().min(1),
  })
  .strict();
export type ParserLimits = z.infer<typeof ParserLimitsSchema>;

export const ParserRequestSchema = z
  .object({
    mimeType: z.string().min(1).max(255),
    /** Sanitised already; used only to choose an extractor, never executed. */
    filename: z.string().max(512),
    sizeBytes: z.number().int().min(0),
    limits: ParserLimitsSchema,
  })
  .strict();
export type ParserRequest = z.infer<typeof ParserRequestSchema>;

/**
 * Refusal codes. Bounded and enumerated so a failure can be logged, counted
 * and dead-lettered without ever putting parser or document text in a log.
 */
export const PARSER_REFUSAL_CODES = [
  "UNSUPPORTED_MEDIA_TYPE",
  "MALFORMED_PACKAGE",
  "ARCHIVE_ENTRY_LIMIT",
  "ARCHIVE_UNSAFE_ENTRY",
  "ARCHIVE_ENTRY_TOO_LARGE",
  "ARCHIVE_EXPANSION_LIMIT",
  "XML_NODE_LIMIT",
  "XML_DEPTH_LIMIT",
  "PARSER_FAILED",
  "PARSER_TIMEOUT",
  "PARSER_CRASHED",
  "PARSER_OUTPUT_TOO_LARGE",
  "PARSER_INVALID_OUTPUT",
  "INPUT_TOO_LARGE",
] as const;
export const ParserRefusalCodeSchema = z.enum(PARSER_REFUSAL_CODES);
export type ParserRefusalCode = z.infer<typeof ParserRefusalCodeSchema>;

/** True when the code says "this document cannot be parsed", not "try again". */
export function isPermanentRefusal(code: ParserRefusalCode): boolean {
  return code !== "PARSER_TIMEOUT" && code !== "PARSER_CRASHED";
}
