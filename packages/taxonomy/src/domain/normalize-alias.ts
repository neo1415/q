/**
 * The one deterministic alias normalisation.
 *
 *   Unicode NFKC -> trim -> lowercase -> collapse whitespace ->
 *   no spaces around "/" and "-" -> single spaces around "&" and ","
 *
 * Deliberately conservative: it makes formatting variants of the same
 * phrase match ("B2B  payment APIs" = "b2b payment apis", "AI / ML" =
 * "ai/ml") and nothing more. No stemming, no stop-word removal, no
 * semantic rewriting, so unrelated aliases do not collide. Exact lookup
 * only; fuzzy and semantic retrieval belong to CQ-TAX-002.
 */
export function normalizeTaxonomyAlias(input: string): string {
  return input
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([/-])\s*/g, "$1")
    .replace(/\s*([&,])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

export const TAXONOMY_ALIAS_MAX_LENGTH = 200;
