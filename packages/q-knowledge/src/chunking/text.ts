import { createHash } from "node:crypto";

/**
 * Text helpers for the chunker. Deterministic and provider-neutral: the
 * token figure is an estimate for sizing and budgeting, never a provider's
 * billing count, and it is stored as such (CQ-RAG-001 §25).
 */

/** ~4 characters per token for Latin-script business prose; an estimate. */
export const CHARACTERS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Splits prose into sentences at terminal punctuation followed by
 * whitespace, or at line breaks. Abbreviations are not special-cased: a
 * boundary that is occasionally early is harmless, a boundary in the middle
 * of a word is not, and this never produces the latter.
 */
export function splitSentences(text: string): readonly string[] {
  const sentences: string[] = [];
  const pattern = /[^.!?\n]+[.!?]*(?:\s+|$)/g;
  for (const match of text.matchAll(pattern)) {
    const sentence = match[0].trim();
    if (sentence.length > 0) sentences.push(sentence);
  }
  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push(text.trim());
  }
  return sentences;
}

/**
 * Packs sentences into pieces whose estimated size stays under `maxTokens`,
 * never splitting a sentence unless a single sentence alone exceeds the
 * bound, in which case it is cut at the last whitespace before the bound.
 */
export function packSentences(
  text: string,
  maxTokens: number,
): readonly string[] {
  const maxCharacters = maxTokens * CHARACTERS_PER_TOKEN;
  const pieces: string[] = [];
  let current = "";
  const push = (): void => {
    if (current.length > 0) pieces.push(current);
    current = "";
  };
  for (const sentence of splitSentences(text)) {
    if (sentence.length > maxCharacters) {
      push();
      let rest = sentence;
      while (rest.length > maxCharacters) {
        const cut = rest.lastIndexOf(" ", maxCharacters);
        const at = cut > maxCharacters / 2 ? cut : maxCharacters;
        pieces.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      current = rest;
      continue;
    }
    const joined = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (joined.length > maxCharacters) {
      push();
      current = sentence;
    } else {
      current = joined;
    }
  }
  push();
  return pieces;
}

/** The trailing sentences of `text` that fit in `maxTokens`, for overlap. */
export function trailingSentences(text: string, maxTokens: number): string {
  const maxCharacters = maxTokens * CHARACTERS_PER_TOKEN;
  const sentences = splitSentences(text);
  let tail = "";
  for (let at = sentences.length - 1; at >= 0; at -= 1) {
    const sentence = sentences[at] ?? "";
    const candidate = tail.length === 0 ? sentence : `${sentence} ${tail}`;
    if (candidate.length > maxCharacters) break;
    tail = candidate;
  }
  return tail;
}
