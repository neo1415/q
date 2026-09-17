import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * MEMORY_EXTRACTOR — what this conversation taught Q about the person
 * (doc 14 §55-§61; ADR 0012).
 *
 * Run after a conversation turn, never inside it. The model reads the
 * turns and proposes bounded memory items in a closed set of types, each
 * carrying the person's own words as its quote; and a title and a rolling
 * summary of the conversation. Everything it proposes goes to the memory
 * write gate, which verifies every quote against the recorded turns,
 * dedupes, supersedes and persists; nothing here is remembered by virtue
 * of having been proposed.
 *
 * The types are the memory kinds doc 14 names for a person: a preference
 * about how Q should behave, how a name is pronounced or spelled, a
 * correction of something Q got wrong, and a fact they stated about
 * themselves or their company. Working memory (the summary) is separate.
 */

export const MEMORY_EXTRACTOR_SCHEMA_NAME = "MemoryExtractorResult";
export const MEMORY_EXTRACTOR_SCHEMA_VERSION = 1;

export const MEMORY_EXTRACT_TYPES = [
  "PREFERENCE",
  "PRONUNCIATION",
  "CORRECTION",
  "FACT_ABOUT_PERSON",
  "FACT_ABOUT_COMPANY",
] as const;
export type MemoryExtractType = (typeof MEMORY_EXTRACT_TYPES)[number];

/** `preference.address_as`, `pronunciation.nem_salvage`: lowercase, dotted, bounded. */
export const MEMORY_KEY_PATTERN =
  /^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_-]*){0,3}$/;

export const MemoryExtractorVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What Capital Q calls the person, or null. UNTRUSTED. */
    personName: z.string().max(120).nullable(),
    /** The turns of this conversation, oldest first. UNTRUSTED. */
    transcript: z
      .array(
        z.object({
          role: z.enum(["USER", "Q"]),
          text: z.string().max(4_000),
        }),
      )
      .max(64),
    /** What is already remembered, so it is not proposed again. UNTRUSTED. */
    knownMemory: z.string().max(6_000),
    /** The conversation's summary so far, to roll forward. UNTRUSTED. */
    previousSummary: z.string().max(2_000),
  })
  .strict();
export type MemoryExtractorVariables = z.infer<
  typeof MemoryExtractorVariablesSchema
>;

export const MEMORY_EXTRACTOR_UNTRUSTED = [
  "personName",
  "transcript",
  "knownMemory",
  "previousSummary",
] as const;

export const MemoryExtractItemSchema = z
  .object({
    type: z.enum(MEMORY_EXTRACT_TYPES),
    /** A stable key for the thing remembered, so a later value supersedes it. */
    key: z.string().regex(MEMORY_KEY_PATTERN).max(96),
    /** The memory, as one plain sentence Q can act on. */
    content: z.string().trim().min(3).max(400),
    /** The person's own words this rests on, verbatim. */
    quote: z.string().trim().min(3).max(400),
  })
  .strict();
export type MemoryExtractItem = z.infer<typeof MemoryExtractItemSchema>;

export const MemoryExtractorResultSchema = z
  .object({
    /** A few words naming what the conversation was about. */
    title: z.string().trim().min(1).max(60),
    /** The conversation so far, rolled forward; what a colleague would need to pick it up. */
    summary: z.string().trim().max(1_200),
    items: z.array(MemoryExtractItemSchema).max(12).default([]),
  })
  .strict();
export type MemoryExtractorResult = z.infer<typeof MemoryExtractorResultSchema>;
