import type { TaxonomyNode, TaxonomyQueryPort } from "@capital-q/taxonomy";

import { GEOGRAPHY_VOCABULARY } from "../candidates/structured.js";

/**
 * Everything a preference node stands over: its primary descendants and,
 * outside geography, the nodes it is declared `broader_than` in the
 * reference taxonomy with theirs (live 2026-10-29: a founder's Telehealth,
 * a product category, never met an investor's Healthcare, an industry, so
 * the sector read as a mismatch). Relations come from reference edges,
 * never from matching words in names.
 */
export async function nodesUnder(
  taxonomy: Pick<TaxonomyQueryPort, "listDescendants" | "listNarrower">,
  node: Pick<TaxonomyNode, "id" | "vocabularyCode">,
): Promise<readonly TaxonomyNode[]> {
  const [primary, narrower] = await Promise.all([
    taxonomy.listDescendants(node.id),
    node.vocabularyCode === GEOGRAPHY_VOCABULARY
      ? Promise.resolve([] as readonly TaxonomyNode[])
      : taxonomy.listNarrower(node.id),
  ]);
  const seen = new Set<string>();
  return [...primary, ...narrower].filter((one) => {
    if (one.id === node.id || seen.has(one.id)) return false;
    seen.add(one.id);
    return true;
  });
}
