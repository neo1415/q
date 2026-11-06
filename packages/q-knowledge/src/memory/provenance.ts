import { quoteOccursIn } from "../q/statement-recorder.js";
import type { MemoryItem } from "./contracts.js";

/**
 * Who said it (Q intelligence step 9; ADR-001 truth axes).
 *
 * A memory's content is written by whoever proposed it. When the memory
 * extractor or a tool proposed it, the content is the MODEL's sentence;
 * the Write Gate only proves that the quote beside it is the person's own
 * words. "Invests in B2B SaaS" with the quote "we back B2B companies with
 * recurring revenue" is Q's reading of what they said, not what they said
 * (HANDOFF-2026-11-01 defect 1: Q's mapping recalled as their stated
 * preference).
 *
 * So the truth class is derived by code from what the row holds, never
 * from what a model says about it:
 *
 *   USER_CLAIM   the person said yes to exactly this content
 *                (USER_CONFIRMED), a deterministic platform write of what
 *                they typed (AUTOMATIC_SYSTEM), an administrator's
 *                verified entry, or content that is itself in their quoted
 *                words;
 *   Q_INFERENCE  everything else: Q's reading of their words.
 *
 * Nothing here reads a person's words for meaning: it only checks whether
 * Q's sentence occurs in theirs.
 */
export type MemoryTruthClass = "USER_CLAIM" | "Q_INFERENCE";

/** The text of a sentence without its closing punctuation or wrapping quotes. */
function bare(text: string): string {
  return text
    .trim()
    .replace(/^["“'‘]+|["”'’]+$/gu, "")
    .replace(/[.!?;:,]+$/u, "")
    .trim();
}

export function memoryTruthClass(
  item: Pick<MemoryItem, "writeMode" | "content" | "quote">,
): MemoryTruthClass {
  switch (item.writeMode) {
    case "USER_CONFIRMED":
    case "AUTOMATIC_SYSTEM":
    case "ADMIN_VERIFIED":
      return "USER_CLAIM";
    case "Q_PROPOSED":
    case "DERIVED":
      return item.quote !== null &&
        quoteOccursIn(bare(item.content), item.quote)
        ? "USER_CLAIM"
        : "Q_INFERENCE";
  }
}

/**
 * The label a rendered memory line starts with when it is Q's reading.
 * Exported so a consumer that types recalled lines (the situation's
 * memory section) can tell them apart by Capital Q's own label, never by
 * reading the person's words.
 */
export const Q_READING_LABEL = "Q's reading";
export const Q_READING_SUFFIX = "not their words";

/**
 * Wording that presents something as the person's own statement. Used only
 * by the deterministic check below, over Capital Q's own text (rendered
 * memory and Q's replies), never over what a person wrote.
 */
const STATED_FRAMES = [
  "they said",
  "you said",
  "you told me",
  "you told q",
  "your preference",
  "your stated",
  "you prefer",
  "their stated",
  "they prefer",
  "preference (",
] as const;

const normal = (text: string) =>
  text.toLowerCase().replace(/[’‘]/gu, "'").replace(/\s+/gu, " ");

/**
 * The deterministic step-9 check: every Q_INFERENCE memory whose content
 * appears in `text` inside a sentence that frames it as stated (by the
 * person) is a violation. Returns the offending memory contents; empty
 * means no inferred memory is presented as stated.
 */
export function inferredPresentedAsStated(
  text: string,
  items: readonly Pick<MemoryItem, "writeMode" | "content" | "quote">[],
): readonly string[] {
  const sentences = normal(text)
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: string[] = [];
  for (const item of items) {
    if (memoryTruthClass(item) !== "Q_INFERENCE") continue;
    const content = normal(bare(item.content));
    if (content.length < 3) continue;
    const framed = sentences.some(
      (sentence) =>
        sentence.includes(content) &&
        !sentence.includes(normal(Q_READING_LABEL)) &&
        STATED_FRAMES.some((frame) => sentence.includes(frame)),
    );
    if (framed) out.push(item.content);
  }
  return out;
}
