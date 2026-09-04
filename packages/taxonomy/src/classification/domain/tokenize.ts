import { createHash } from "node:crypto";

import { normalizeTaxonomyAlias } from "../../domain/normalize-alias.js";
import type { TaxonomyClassificationPolicy } from "./policy.js";

/**
 * Lexical tokenisation for the deterministic classifier. Layered on the
 * one alias normaliser from CQ-TAX-001: no stemming, no synonym expansion,
 * no semantic rewriting -- "claims ops" stays "claims ops". Tokens are
 * [a-z0-9]+ runs (so quotes, SQL, tsquery operators and regex symbols are
 * simply not tokens), minus a bounded stop-word list, deduplicated, in
 * order of first appearance.
 */
export function tokenizeForLexicalSearch(
  normalizedText: string,
  policy: TaxonomyClassificationPolicy,
): readonly string[] {
  const stop = new Set(policy.stopWords);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of normalizedText.split(/[^a-z0-9]+/)) {
    if (
      raw.length < policy.lexical.minTokenLength ||
      stop.has(raw) ||
      seen.has(raw)
    ) {
      continue;
    }
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

/** The exact normalised form used by every exact generator. */
export function normalizeClassificationInput(text: string): string {
  return normalizeTaxonomyAlias(text);
}

/** SHA-256 of the raw input; a reproducibility/dedup diagnostic, never the source. */
export function hashClassificationInput(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
