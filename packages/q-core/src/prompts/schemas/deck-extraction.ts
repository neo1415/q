import { z } from "zod";

import { DeckSectionReadingSchema, DECK_SECTIONS } from "@capital-q/contracts";

import { TaskFrameSchema } from "./common.js";

/**
 * DECK_EXTRACTION — Q reads a founder's pitch deck into the twelve standard
 * sections, with slide citations (overnight plan A5; research
 * pitch-deck.md §3-§4).
 *
 * The Context Firewall for this reading is the input: the deck version's
 * own extracted text, slide by slide, and nothing else -- no company
 * record, no private numbers, no other document. What Q reads is a
 * proposal: the founder confirms it before any investor sees it (Write
 * Gate), and every figure stays the deck's claim.
 */

export const DECK_EXTRACTION_SCHEMA_NAME = "DeckExtractionResult";
export const DECK_EXTRACTION_SCHEMA_VERSION = 1;

export const DeckExtractionVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The file's title as the founder named it. UNTRUSTED. */
    title: z.string().max(200),
    /** Slides counted by the document reader. Trusted. */
    pages: z.number().int().min(0).max(10_000).nullable(),
    /** The deck's text with "[Slide N]" markers, in order. UNTRUSTED. */
    text: z.string().max(40_000),
  })
  .strict();
export type DeckExtractionVariables = z.infer<
  typeof DeckExtractionVariablesSchema
>;

export const DECK_EXTRACTION_UNTRUSTED = ["title", "text"] as const;

export const DeckExtractionResultSchema = z
  .object({
    /** The twelve sections; the reader normalises order and fills gaps. */
    sections: z.array(DeckSectionReadingSchema).max(DECK_SECTIONS.length),
  })
  .strict();
export type DeckExtractionResult = z.infer<typeof DeckExtractionResultSchema>;
