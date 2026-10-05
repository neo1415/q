import type { MandateVocabularyNode } from "@capital-q/gateq";
import {
  REFERENCE_TAXONOMY,
  type ReferenceTaxonomy,
} from "@capital-q/taxonomy";

/**
 * The reference taxonomy, shaped for GateQ's mandate reader (P7).
 *
 * Composition only: GateQ owns no taxonomy and does not depend on the
 * taxonomy package. The node ids are the same stable ids the reference
 * migration seeds, so a criterion the reader proposes names canonical rows.
 */
const VOCABULARIES = new Set(["company_stage", "geography", "industry"]);

export function mandateVocabularyFrom(
  reference: ReferenceTaxonomy = REFERENCE_TAXONOMY,
): readonly MandateVocabularyNode[] {
  const aliases = new Map<string, string[]>();
  for (const alias of reference.aliases) {
    const list = aliases.get(alias.nodeId) ?? [];
    list.push(alias.alias);
    aliases.set(alias.nodeId, list);
  }
  return reference.nodes
    .filter(
      (node) =>
        node.status === "ACTIVE" && VOCABULARIES.has(node.vocabularyCode),
    )
    .map((node) => {
      const iso = (node.metadata as { iso3166Alpha2?: unknown }).iso3166Alpha2;
      return {
        id: node.id,
        vocabularyCode: node.vocabularyCode,
        canonicalCode: node.canonicalCode,
        displayName: node.displayName,
        parentNodeId: node.parentNodeId,
        iso2: typeof iso === "string" ? iso : null,
        aliases: aliases.get(node.id) ?? [],
      };
    });
}
